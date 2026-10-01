# URDF Studio 简体中文界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Studio 界面增加和繁体并列的简体中文；主站 `?lang=zh-CN` 在 UI store 回填之后覆盖已保存语言，检查和对话走已有简体提示词。

**Architecture:** `zh-CN` 进入 `Language`。简体文案由一次性 OpenCC 脚本从繁体生成后作为源文件提交，不进构建。语言归一在 `normalizeLanguage`。主站 `lang` 由 `applyLanguageAfterHydration` 在 persist 完成后再 `setLang`。界面语言 `zh-CN` 选择已有的 `inspection.zh-CN` / `conversation.zh-CN` 模板。

**Tech Stack:** TypeScript、Zustand persist、node:test、`opencc-js`（仅开发依赖，`from: 'tw'`，`to: 'cn'`）。

## Global Constraints

- `Language` 增加 `'zh-CN'`，与 `'zh-Hant'` 并列。日语仍留在类型里，选择器里不出现，`ja` 仍归一成 `en`。
- 选择器顺序：English、简体中文（短标签「简」）、繁體中文（「繁」）、Français、Deutsch、Español、한국어。
- `normalizeLanguage` 先匹配繁体：`zh-Hant`、以 `zh-Hant` 开头（含 `zh-Hant-TW` / `zh-Hant-HK` / `zh-Hant-MO`）、`zh-TW`、`zh-HK` → `zh-Hant`。然后 `zh-CN`、`zh-Hans`、`zh-Hans-CN`、单独的 `zh`、其余 `zh-*` → `zh-CN`。
- 保存的界面语言是 `urdf-studio-ui` 里的 `lang`。已经存成 `zh-Hant` 的继续繁体，不批量改写，也不迁移。松散的 `localStorage.language` 只在持久化里没有 `lang` 时作为回退，这次不新增对它的写入。
- 主站 `?lang=` 在 rehydrate 之后 `setLang`。归一结果是 `null` 时不调用 `setLang`。写完后从地址栏去掉 `lang`。
- `getLanguageFromPath` 不增加 `/zh-CN`。不改 `scripts/generate/seo_prerender.mjs`，不新增简体营销页，不改 sitemap。
- 生成脚本是 `scripts/generate/zh_cn_locale.mjs`，入口 `npm run i18n:zh-cn`。不加入 `build`、`verify:fast`、`verify:full` 或任何 prebuild。
- 脚本用 `opencc-js` 的 `from: 'tw'`、`to: 'cn'`。`src/` 不引用 `opencc-js`。转换失败退出非零，不替换已有简体文件。再跑脚本会盖掉手改。
- 不把 `zh-CN.ts` / `zhCnWorkflow.ts` 拆小来回避行数。`zh-CN.ts` 超过 800 行时，只把 `file-too-long` 的 exact count 加 1，并写明所有者、原因和退出条件。
- 运行时不因缺键回退到繁体。`resolveDocumentLocale('zh-CN')` 与 `resolveDateLocale('zh-CN')` 都返回 `zh-CN`。`isChineseLanguage` 对 `zh-CN` 和 `zh-Hant` 都为真。
- 检查配置的 `nameZh` / `descriptionZh` 继续简繁共用。不用 OpenCC 改提示词或检查项。
- 两处 `localeFromLang` 对 `zh-CN` 返回 `zh-CN`，不落到 `en`。询价地址是 `{主站}/zh-CN/orders?...`。
- 不改 robots 仓库，也不改主站 `prompt_builder.py`。
- `npm run typecheck:quality` 今天已经失败：`studioModificationTools.ts` 四个 `Record<Language, string>` 缺 `ko`，以及 `AIConversationModal.tsx` 的 TS18049。本计划不修这两处。任务结束时不得再出现缺 `zh-CN` 的类型错误。

---

### Task 1: 一次性生成简体文案源

**Files:**
- Create: `scripts/generate/zh_cn_locale.mjs`
- Create: `scripts/generate/zh_cn_locale.test.mjs`
- Create: `src/shared/i18n/locales/zhCnWorkflow.ts`
- Create: `src/shared/i18n/locales/zh-CN.ts`
- Create: `src/shared/i18n/locales/zh-CN.test.ts`
- Modify: `package.json`（`scripts` 里、`ai-prompts:generate` 旁边）
- Modify: `package-lock.json`
- Modify: `scripts/tools/google_style_baseline.json`（只动 `file-too-long`）

**Interfaces:**
- Consumes: `src/shared/i18n/locales/zh-Hant.ts`、`src/shared/i18n/locales/zhHantWorkflow.ts`
- Produces: `convertTraditionalToSimplified(text: string): string`；`zhCn: TranslationKeys`；`zhCnWorkflow: TranslationWorkflowKeys`

- [ ] **Step 1: Write the failing tests**

`scripts/generate/zh_cn_locale.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { convertTraditionalToSimplified } from './zh_cn_locale.mjs';

test('convertTraditionalToSimplified turns the collapsed-lines phrase into simplified Chinese', () => {
  assert.equal(
    convertTraditionalToSimplified('{count} 行未變更（已摺疊）'),
    '{count} 行未变更（已折叠）',
  );
});
```

`src/shared/i18n/locales/zh-CN.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { zhCn } from './zh-CN.ts';
import { zhCnWorkflow } from './zhCnWorkflow.ts';
import { zhHant } from './zh-Hant.ts';

test('zh-CN locale keeps workflow copy from the workflow source of truth', () => {
  for (const key of Object.keys(zhCnWorkflow) as Array<keyof typeof zhCnWorkflow>) {
    assert.equal(zhCn[key], zhCnWorkflow[key], `workflow key drifted: ${String(key)}`);
  }
});

test('zh-CN and zh-Hant expose the same translation keys', () => {
  assert.deepEqual(Object.keys(zhCn).sort(), Object.keys(zhHant).sort());
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- scripts/generate/zh_cn_locale.test.mjs src/shared/i18n/locales/zh-CN.test.ts`

Expected: FAIL. 转换函数和 `zh-CN.ts` 尚不存在。

- [ ] **Step 3: Add the generator and the npm script**

Run: `npm install -D opencc-js`

在 `package.json` 的 `scripts` 中，紧接 `ai-prompts:generate` 增加：

```json
"i18n:zh-cn": "node scripts/generate/zh_cn_locale.mjs"
```

不要把 `i18n:zh-cn` 加进 `build`、`verify:fast`、`verify:full`。

`scripts/generate/zh_cn_locale.mjs`:

```js
/**
 * One-shot reset: generate simplified locale sources from Traditional Chinese.
 * Not a daily step. Running this overwrites hand edits in zh-CN.ts and zhCnWorkflow.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as OpenCC from 'opencc-js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const localesDir = path.join(repoRoot, 'src/shared/i18n/locales');

const converter = OpenCC.Converter({ from: 'tw', to: 'cn' });

export function convertTraditionalToSimplified(text) {
  return converter(text);
}

function convertLocaleSource(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) {
        throw new Error('Unclosed block comment in locale source');
      }
      out += converter(source.slice(i, end + 2));
      i = end + 2;
      continue;
    }
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += converter(source.slice(i, stop));
      i = stop;
      continue;
    }
    const quote = source[i];
    if (quote === "'" || quote === '"') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      if (j > source.length || source[j - 1] !== quote) {
        throw new Error('Unclosed string literal in locale source');
      }
      const inner = source.slice(i + 1, j - 1);
      out += quote + converter(inner) + quote;
      i = j;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

function renameWorkflow(source) {
  return source.replaceAll('zhHantWorkflow', 'zhCnWorkflow');
}

function renameMain(source) {
  return source
    .replaceAll('zhHantWorkflow', 'zhCnWorkflow')
    .replaceAll('zhHant', 'zhCn')
    .replace(
      'Traditional Chinese (zh-Hant) translations',
      'Simplified Chinese (zh-CN) translations.\n * Generated once from zh-Hant by scripts/generate/zh_cn_locale.mjs.\n * This file is now the source. Re-running the script overwrites hand edits.',
    );
}

function writeAtomic(filePath, contents) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, filePath);
}

function generate() {
  const workflowSource = fs.readFileSync(path.join(localesDir, 'zhHantWorkflow.ts'), 'utf8');
  const mainSource = fs.readFileSync(path.join(localesDir, 'zh-Hant.ts'), 'utf8');
  const workflowOut = renameWorkflow(convertLocaleSource(workflowSource));
  const mainOut = renameMain(convertLocaleSource(mainSource));
  writeAtomic(path.join(localesDir, 'zhCnWorkflow.ts'), workflowOut);
  writeAtomic(path.join(localesDir, 'zh-CN.ts'), mainOut);
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    generate();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run the converter test**

Run: `npm run test:unit -- scripts/generate/zh_cn_locale.test.mjs`

Expected: PASS

- [ ] **Step 5: Generate the locale files and run the key test**

Run: `npm run i18n:zh-cn`

然后：`npm run test:unit -- src/shared/i18n/locales/zh-CN.test.ts`

Expected: PASS。`zh-CN.ts` 以 `export const zhCn` 导出，并 `...zhCnWorkflow`。不要手拆这两个文件。

- [ ] **Step 6: Raise the file-length baseline by this one file**

Run: `npm run google-style:audit`

Expected: `file-too-long` 比当前 max 32 多 1，新增路径只有 `src/shared/i18n/locales/zh-CN.ts`。把 `scripts/tools/google_style_baseline.json` 里 `file-too-long.max` 改为 33，并在该规则的 `note` 末尾追加：

```text
2026-10-01: max 32 → 33 for src/shared/i18n/locales/zh-CN.ts, the simplified twin of the already-counted zh-Hant.ts. OWNER: i18n. REASON: the simplified locale file is one cohesive copy table and must not be split to satisfy the line budget. EXIT: when zh-Hant.ts drops under 800 code lines, remove this extra count in the same change. Do not raise this for any other new file.
```

若新增超长文件不是只有这一份，停下来，不要继续加大 max。

Run: `npm run google-style:check`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/generate/zh_cn_locale.mjs scripts/generate/zh_cn_locale.test.mjs src/shared/i18n/locales/zh-CN.ts src/shared/i18n/locales/zh-CN.test.ts src/shared/i18n/locales/zhCnWorkflow.ts scripts/tools/google_style_baseline.json
git commit -m "$(cat <<'EOF'
feat: generate simplified Chinese locale source

EOF
)"
```

### Task 2: 把 zh-CN 接成界面语言

**Files:**
- Modify: `src/shared/i18n/types.ts`（`Language` 联合）
- Modify: `src/shared/i18n/runtimeLanguage.ts`
- Modify: `src/shared/i18n/runtimeLanguage.test.ts`
- Modify: `src/shared/i18n/languageUtils.ts`
- Modify: `src/shared/i18n/translations.ts`
- Modify: `src/shared/i18n/locales/index.ts`
- Modify: `src/app/utils/initialLanguage.test.ts`（只改 `?lang=zh-CN` 的期望）
- Create: `src/shared/i18n/languageUtils.test.ts`
- Modify: `src/integrations/robots-studio/requirementsSectionLabels.ts`
- Modify: `src/integrations/robots-studio/studioModificationTools.ts`
- Create: `src/integrations/robots-studio/requirementsSectionLabels.test.ts`
- Create: `src/integrations/robots-studio/studioModificationTools.locale.test.ts`
- Modify: `src/integrations/agile-robot/inquireHandoff.test.ts`

**Interfaces:**
- Consumes: `zhCn` from Task 1
- Produces: `Language` includes `'zh-CN'`；`normalizeLanguage('zh-CN')` returns `'zh-CN'`；`translations['zh-CN']`；`localeFromLang(lang: Language): string` exported from both robots-studio modules；`isChineseLanguage('zh-CN') === true`

- [ ] **Step 1: Write the failing language tests**

在 `runtimeLanguage.test.ts` 的区域标签测试里，把中文断言换成：

```ts
assert.equal(normalizeLanguage('zh-CN'), 'zh-CN');
assert.equal(normalizeLanguage('zh-Hans'), 'zh-CN');
assert.equal(normalizeLanguage('zh-Hans-CN'), 'zh-CN');
assert.equal(normalizeLanguage('zh'), 'zh-CN');
assert.equal(normalizeLanguage('zh-Hant'), 'zh-Hant');
assert.equal(normalizeLanguage('zh-Hant-TW'), 'zh-Hant');
assert.equal(normalizeLanguage('zh-TW'), 'zh-Hant');
assert.equal(normalizeLanguage('zh-HK'), 'zh-Hant');
```

把 `localStorage language=zh-CN` 那个测试的期望从 `'zh-Hant'` 改成 `'zh-CN'`。

`src/shared/i18n/languageUtils.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLanguageShortLabel,
  isChineseLanguage,
  LANGUAGE_OPTIONS,
  resolveDateLocale,
  resolveDocumentLocale,
} from './languageUtils.ts';

test('simplified Chinese is the switcher entry after English', () => {
  assert.equal(LANGUAGE_OPTIONS[1]?.value, 'zh-CN');
  assert.equal(LANGUAGE_OPTIONS[1]?.label, '简体中文');
  assert.equal(getLanguageShortLabel('zh-CN'), '简');
  assert.equal(LANGUAGE_OPTIONS[2]?.value, 'zh-Hant');
});

test('simplified Chinese document and date locales stay zh-CN', () => {
  assert.equal(resolveDocumentLocale('zh-CN'), 'zh-CN');
  assert.equal(resolveDateLocale('zh-CN'), 'zh-CN');
  assert.equal(isChineseLanguage('zh-CN'), true);
  assert.equal(isChineseLanguage('zh-Hant'), true);
  assert.equal(isChineseLanguage('en'), false);
});
```

在 `initialLanguage.test.ts` 把这一行改成：

```ts
assert.equal(getLanguageFromRobotsHandoffSearch('?lang=zh-CN'), 'zh-CN');
```

`src/integrations/robots-studio/requirementsSectionLabels.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatProposeRevisionSectionSummary,
  localeFromLang,
} from './requirementsSectionLabels.ts';

test('requirements localeFromLang keeps simplified Chinese', () => {
  assert.equal(localeFromLang('zh-CN'), 'zh-CN');
  assert.equal(localeFromLang('zh-Hant'), 'zh-Hant');
});

test('simplified requirements summary uses simplified labels and fullwidth parentheses', () => {
  assert.equal(
    formatProposeRevisionSectionSummary('已更新', ['機型'], 'zh-CN'),
    '已更新（机型）',
  );
});
```

`src/integrations/robots-studio/studioModificationTools.locale.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { localeFromLang } from './studioModificationTools.ts';

test('mesh tool localeFromLang keeps simplified Chinese', () => {
  assert.equal(localeFromLang('zh-CN'), 'zh-CN');
});
```

在 `inquireHandoff.test.ts` 的 `studioLangToOrdersLocale` 测试末尾增加：

```ts
assert.equal(studioLangToOrdersLocale('zh-CN'), 'zh-CN');
```

并增加：

```ts
test('buildStudioInquireOrdersUrl uses zh-CN path prefix', () => {
  const url = buildStudioInquireOrdersUrl({
    mainSiteOrigin: 'https://robots.test',
    lang: 'zh-CN',
    orderId: ORDER_ID,
  });
  assert.equal(
    url,
    `https://robots.test/zh-CN/orders?order=${ORDER_ID}&action=inquire`,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- src/shared/i18n/runtimeLanguage.test.ts src/shared/i18n/languageUtils.test.ts src/app/utils/initialLanguage.test.ts src/integrations/robots-studio/requirementsSectionLabels.test.ts src/integrations/robots-studio/studioModificationTools.locale.test.ts`

Expected: FAIL。`normalizeLanguage('zh-CN')` 仍是 `zh-Hant`；`resolveDocumentLocale('zh-CN')` 落到 `en`；`localeFromLang` 尚未导出，或对 `zh-CN` 落到 `en`。

`studioLangToOrdersLocale` 会把参数原样返回，所以询价测试在这一步就可以通过。不要为了让它失败去改那个函数。

- [ ] **Step 3: Add zh-CN to the language type and maps**

`src/shared/i18n/types.ts` 的 `Language` 改为：

```ts
export type Language = 'en' | 'zh-CN' | 'zh-Hant' | 'ja' | 'fr' | 'de' | 'es' | 'ko';
```

`languageUtils.ts` 的 `LANGUAGE_OPTIONS` 在 English 之后插入简体，繁体留在它后面：

```ts
{ value: 'zh-CN' as const, label: '简体中文', shortLabel: '简' },
{ value: 'zh-Hant' as const, label: '繁體中文', shortLabel: '繁' },
```

`resolveDocumentLocale` 在 `zh-Hant` 分支前增加：

```ts
case 'zh-CN':
  return 'zh-CN';
```

`resolveDateLocale` 在 `zh-Hant` 分支前增加：

```ts
case 'zh-CN':
  return 'zh-CN';
```

`isChineseLanguage` 改为：

```ts
export function isChineseLanguage(lang: Language): boolean {
  return lang === 'zh-CN' || lang === 'zh-Hant';
}
```

`runtimeLanguage.ts` 里替换现在的中文分支（先繁体，再简体）：

```ts
if (
  normalized.startsWith('zh-hant') ||
  normalized === 'zh-tw' ||
  normalized === 'zh-hk'
) {
  return 'zh-Hant';
}
if (
  normalized === 'zh' ||
  normalized === 'zh-cn' ||
  normalized === 'zh-hans' ||
  normalized.startsWith('zh-')
) {
  return 'zh-CN';
}
```

日语分支保持返回 `'en'`。不要改 `uiStore` 的 migrate，它已经调用 `normalizeLanguage`。不要把已存的 `zh-Hant` 写成 `zh-CN`。

`translations.ts`:

```ts
import { zhCn } from './locales/zh-CN';
```

并在表中放 `'zh-CN': zhCn`，紧挨 `'zh-Hant'`。

`locales/index.ts` 增加 `export { zhCn } from './zh-CN';`。

`requirementsSectionLabels.ts`：导出 `localeFromLang`，在 `zh-Hant` 分支前增加 `case 'zh-CN': return 'zh-CN';`。给 `REQUIREMENTS_SECTION_LABELS` 增加：

```ts
'zh-CN': {
  背景: '背景',
  機型: '机型',
  性能參數: '性能参数',
  其他約束: '其他约束',
},
```

`formatProposeRevisionSectionSummary` 的标点条件改为：

```ts
if (lang === 'zh-CN' || lang === 'zh-Hant' || lang === 'ja') {
  return `${baseSummary}（${formattedList}）`;
}
```

`studioModificationTools.ts`：导出 `localeFromLang`，增加同样的 `case 'zh-CN': return 'zh-CN';`。不要补 `ko`。四个消息表各加一条简体：

```ts
'zh-CN': '需求确认书已在别处更新，请刷新后重试。',
```

```ts
'zh-CN': '本次修订与现有需求内容重复，请改写变更后重试。',
```

```ts
'zh-CN': '提议的修订包含无效的需求章节。',
```

```ts
'zh-CN': '需求确认书格式无效，请联系运营处理。',
```

分别放进 `REVISION_CONFLICT_MESSAGES`、`DUPLICATE_CONTENT_MESSAGES`、`INVALID_SECTION_MESSAGES`、`INVALID_DOCUMENT_SCHEMA_MESSAGES`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- src/shared/i18n/runtimeLanguage.test.ts src/shared/i18n/languageUtils.test.ts src/shared/i18n/locales/zh-CN.test.ts src/app/utils/initialLanguage.test.ts src/integrations/robots-studio/requirementsSectionLabels.test.ts src/integrations/robots-studio/studioModificationTools.locale.test.ts src/integrations/agile-robot/inquireHandoff.test.ts`

Expected: PASS

Run: `npm run typecheck:quality`

Expected: 仍可能因缺 `ko` 和 `AIConversationModal.tsx` TS18049 失败。输出里不得再出现缺 `zh-CN`。

- [ ] **Step 5: Commit**

```bash
git add src/shared/i18n/types.ts src/shared/i18n/runtimeLanguage.ts src/shared/i18n/runtimeLanguage.test.ts src/shared/i18n/languageUtils.ts src/shared/i18n/languageUtils.test.ts src/shared/i18n/translations.ts src/shared/i18n/locales/index.ts src/app/utils/initialLanguage.test.ts src/integrations/robots-studio/requirementsSectionLabels.ts src/integrations/robots-studio/requirementsSectionLabels.test.ts src/integrations/robots-studio/studioModificationTools.ts src/integrations/robots-studio/studioModificationTools.locale.test.ts src/integrations/agile-robot/inquireHandoff.test.ts
git commit -m "$(cat <<'EOF'
feat: add zh-CN as a Studio UI language

EOF
)"
```

### Task 3: 主站语言在回填之后写入

**Files:**
- Modify: `src/app/utils/initialLanguage.ts`
- Modify: `src/app/utils/initialLanguage.test.ts`
- Modify: `src/main.tsx`（约 60–71 行的 URL 语言启动块）

**Interfaces:**
- Consumes: `Language`、`getLanguageFromRobotsHandoffSearch`、`useUIStore.persist.hasHydrated`、`useUIStore.persist.onFinishHydration`、`useUIStore.getState().setLang`
- Produces:

```ts
export interface LanguageHydration {
  hasHydrated: () => boolean;
  onFinishHydration: (fn: () => void) => void;
  setLang: (lang: Language) => void;
}

export function applyLanguageAfterHydration(
  lang: Language | null,
  hydration: LanguageHydration,
  afterApply: () => void,
): void;
```

- [ ] **Step 1: Write the failing test**

在 `initialLanguage.test.ts` 增加导入 `applyLanguageAfterHydration`，并增加：

```ts
test('applyLanguageAfterHydration waits until persist hydration before writing zh-CN', () => {
  const writes: string[] = [];
  let hydrated = false;
  let listener: (() => void) | null = null;
  let hidden = false;

  applyLanguageAfterHydration(
    'zh-CN',
    {
      hasHydrated: () => hydrated,
      onFinishHydration: (fn) => {
        listener = fn;
      },
      setLang: (lang) => {
        writes.push(lang);
      },
    },
    () => {
      hidden = true;
    },
  );

  assert.deepEqual(writes, []);
  assert.equal(hidden, false);
  listener?.();
  assert.deepEqual(writes, ['zh-CN']);
  assert.equal(hidden, true);
});

test('applyLanguageAfterHydration writes immediately when hydration already finished', () => {
  const writes: string[] = [];
  applyLanguageAfterHydration(
    'zh-CN',
    {
      hasHydrated: () => true,
      onFinishHydration: () => {
        throw new Error('listener should not be registered');
      },
      setLang: (lang) => {
        writes.push(lang);
      },
    },
    () => {},
  );
  assert.deepEqual(writes, ['zh-CN']);
});

test('applyLanguageAfterHydration ignores an unrecognized handoff language', () => {
  let called = false;
  applyLanguageAfterHydration(
    null,
    {
      hasHydrated: () => true,
      onFinishHydration: () => {
        throw new Error('listener should not be registered');
      },
      setLang: () => {
        called = true;
      },
    },
    () => {
      called = true;
    },
  );
  assert.equal(called, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/app/utils/initialLanguage.test.ts`

Expected: FAIL，`applyLanguageAfterHydration` 未定义。

- [ ] **Step 3: Implement the hydration gate and use it from startup**

在 `initialLanguage.ts` 增加：

```ts
export interface LanguageHydration {
  hasHydrated: () => boolean;
  onFinishHydration: (fn: () => void) => void;
  setLang: (lang: Language) => void;
}

export function applyLanguageAfterHydration(
  lang: Language | null,
  hydration: LanguageHydration,
  afterApply: () => void,
): void {
  if (lang === null) {
    return;
  }
  const apply = () => {
    hydration.setLang(lang);
    afterApply();
  };
  if (hydration.hasHydrated()) {
    apply();
    return;
  }
  hydration.onFinishHydration(apply);
}
```

把 `main.tsx` 里现有的 URL 语言块换成：

```ts
const handoffLanguage = getLanguageFromRobotsHandoffSearch(window.location.search);
const urlLanguage = getInitialLanguageFromUrl();
if (handoffLanguage !== null) {
  applyLanguageAfterHydration(
    handoffLanguage,
    {
      hasHydrated: () => useUIStore.persist.hasHydrated(),
      onFinishHydration: (fn) => {
        useUIStore.persist.onFinishHydration(fn);
      },
      setLang: (lang) => {
        useUIStore.getState().setLang(lang);
      },
    },
    hideRobotsHandoffLangFromUserUrl,
  );
} else if (urlLanguage !== null) {
  useUIStore.getState().setLang(urlLanguage);
  hideSeoLanguagePathFromUserUrl();
}
```

从 `initialLanguage.ts` 的导入里加上 `applyLanguageAfterHydration`。SEO 路径仍立刻 `setLang`。没有 `lang` 时不写保存。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/app/utils/initialLanguage.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/utils/initialLanguage.ts src/app/utils/initialLanguage.test.ts src/main.tsx
git commit -m "$(cat <<'EOF'
fix: apply robots handoff language after UI store hydration

EOF
)"
```

### Task 4: 界面语言为简体时使用简体提示词

**Files:**
- Modify: `src/features/ai-assistant/config/prompts.ts`
- Modify: `src/features/ai-assistant/config/prompts.test.ts`（现有 raw `zh-CN` 测试改名，不改断言）

**Interfaces:**
- Consumes: `Language` 含 `'zh-CN'`；已有模板 `AI_PROMPT_TEMPLATES.inspection['zh-CN']` 与 `conversation['zh-CN']`
- Produces: `getInspectionSystemPrompt('zh-CN', ...)` 与 `getConversationSystemPrompt('zh-CN', ...)` 含简体指令，不含繁体指令。`zh-Hant` 仍是繁体。

- [ ] **Step 1: Put zh-CN on the chrome language set so the current test fails**

把 `CHROME_LANGUAGES` 改为：

```ts
const CHROME_LANGUAGES = new Set<Language>(['en', 'zh-CN', 'zh-Hant', 'ja', 'fr', 'de', 'es', 'ko'])
```

先不要改 `resolvePromptTemplateLanguage` 和两条指令函数。

Run: `npm run test:unit -- src/features/ai-assistant/config/prompts.test.ts`

Expected: FAIL。名为 raw `zh-CN` 的测试会匹配到繁体指令，因为 `zh-CN` 现在算界面语言，而 `isChineseLanguage` 会把它送进繁体分支。

- [ ] **Step 2: Select the simplified template and instructions for zh-CN**

`resolvePromptTemplateLanguage` 改为：

```ts
function resolvePromptTemplateLanguage(lang: string): PromptTemplateLanguage {
  if (lang === 'zh-CN') return 'zh-CN'
  if (isChromeLanguage(lang)) {
    return lang === 'zh-Hant' ? 'zh-Hant' : 'en'
  }
  return resolveRequestPromptLanguage(lang)
}
```

`inspectionLanguageInstruction` 在函数开头、现有 `isChromeLanguage` 判断之前增加：

```ts
if (lang === 'zh-CN') {
  return '请使用简体中文生成所有报告内容，包括总结、问题标题和描述。'
}
```

并把后面的 `if (isChineseLanguage(lang))` 改成 `if (lang === 'zh-Hant')`，繁体句子保持原样。

`conversationLanguageInstruction` 同样在开头增加：

```ts
if (lang === 'zh-CN') {
  return '请使用简体中文回复，简洁准确。'
}
```

并把 `if (isChineseLanguage(lang))` 改成 `if (lang === 'zh-Hant')`。法、德、西、韩、日的句子不动。生成机器人的英文模板不动。

若 `isChineseLanguage` 不再被此文件使用，删掉该导入。

把 `prompts.test.ts` 里测试名 `raw zh-CN locale fills simplified prompt language instructions` 改成 `zh-CN chrome language fills simplified prompt language instructions`。断言不改。

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm run test:unit -- src/features/ai-assistant/config/prompts.test.ts`

Expected: PASS。简体测试匹配「请使用简体中文生成所有报告内容，包括总结、问题标题和描述。」和「请使用简体中文回复，简洁准确。」，且不匹配繁体指令。

- [ ] **Step 4: Commit**

```bash
git add src/features/ai-assistant/config/prompts.ts src/features/ai-assistant/config/prompts.test.ts
git commit -m "$(cat <<'EOF'
fix: keep simplified prompts when the Studio UI language is zh-CN

EOF
)"
```
