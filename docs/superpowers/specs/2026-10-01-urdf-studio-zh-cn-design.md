# URDF Studio 简体中文界面

> 状态：已审阅 | 2026-10-01
> 实现计划：[2026-10-01-urdf-studio-zh-cn.md](../plans/2026-10-01-urdf-studio-zh-cn.md)

Studio 界面增加简体中文，和繁体并列。主站用 `?lang=zh-CN` 打开时，界面显示简体，并覆盖 Studio 已保存的语言。检查和对话使用已有的简体提示词。

robots 主站不用改。它已经把账户语言原样放进 `?lang=`。后端 `prompt_builder.py` 已经把 `zh-CN` 配到简体模板。

## 1. 语言身份

`Language` 增加 `'zh-CN'`，与 `'zh-Hant'` 并列。日语仍留在类型里，选择器里不出现，`ja` 仍归一成 `en`。

选择器顺序：English、简体中文（短标签「简」）、繁體中文（「繁」）、Français、Deutsch、Español、한국어。

`normalizeLanguage` 按下面顺序匹配，不再把所有中文收成繁体：

| 输入 | 结果 |
| --- | --- |
| `zh-Hant`、以 `zh-Hant` 开头（含 `zh-Hant-TW` / `zh-Hant-HK` / `zh-Hant-MO`）、`zh-TW`、`zh-HK` | `zh-Hant` |
| `zh-CN`、`zh-Hans`、`zh-Hans-CN`、单独的 `zh`、其余 `zh-*` | `zh-CN` |
| `ja` 及 `ja-*` | `en` |
| 英、法、德、西、韩 | 现有规则不变 |
| 空串、非字符串、无法识别的标签 | `null` |

`getLanguageFromPath` 不增加 `/zh-CN`。旧路径 `/zh` 和 `/zh-Hant` 仍是繁体。这次不改 `scripts/generate/seo_prerender.mjs`，不新增简体营销页，不改 sitemap。

## 2. 直接打开与主站交接

保存的界面语言是 UI store 持久化键 `urdf-studio-ui` 里的 `lang`。`setLang` 写的是这份状态。松散的 `localStorage.language` 只在持久化里没有 `lang` 时作为回退，这次不新增对它的写入。

直接打开（地址上没有主站 `lang`）：

1. 持久化的 `lang`。已经存成 `zh-Hant` 的继续繁体，不批量改写，也不迁移。
2. 没有这份保存时，读 `localStorage.language`，用第 1 节的标签规则。
3. 再没有，用 `navigator.language`，同一套规则。
4. 都没有，英语。

主站交接：

- 查询参数名仍是 `lang`（`ROBOTS_HANDOFF_LANG_QUERY_PARAM`）。
- 归一结果不是 `null` 时，在 UI store 完成 rehydrate **之后** 调用 `setLang`。因此交接覆盖本次已保存的语言，并成为下次直接打开的保存值。`lang=zh-CN` 显示简体并写回 `zh-CN`。
- 归一结果是 `null` 时不调用 `setLang`，已保存的语言保持原样。
- 写完后仍从地址栏去掉 `lang`，其余查询参数和 hash 保留。
- 日语参数仍先被归一成 `en`，然后按上面的规则写入。这次不改日语开关。

现在 `main.tsx` 在 store 创建后立刻 `setLang`。zustand persist 的回填是异步的，回填会用旧的繁体盖掉这次交接。实现放在现有启动路径上：若 `useUIStore.persist.hasHydrated()` 已为真，立刻应用；否则在 `onFinishHydration` 里应用。不要在 rehydrate 之前写最终语言。

## 3. 文案

繁体拆成 `zhHantWorkflow.ts` 和铺在它上面的 `zh-Hant.ts`。简体按同样形状各一份，都是提交进仓库的源文件：

- `src/shared/i18n/locales/zhCnWorkflow.ts`，导出 `zhCnWorkflow`
- `src/shared/i18n/locales/zh-CN.ts`，导出 `zhCn`，并用 `...zhCnWorkflow` 铺开

不把这两份文件拆小来回避行数。它们和现有语言文件一样，是一份内聚文案。

生成脚本是 `scripts/generate/zh_cn_locale.mjs`，入口是 `npm run i18n:zh-cn`。它只在人手动运行时写文件。不加入 `build`、`verify:fast`、`verify:full` 或任何 prebuild。

脚本用 `opencc-js` 的台湾繁体到简体（`from: 'tw'`，`to: 'cn'`，即 tw2s）。`opencc-js` 只做开发依赖，`src/` 不引用它。

转换范围是字符串字面量和中文注释。标识符、`{count}` 这类占位符、以及 URDF Studio 这类拉丁名保持不动。导出名字和文件头注释由脚本按简体文件改写，不靠 OpenCC 去改标识符。`zh-Hant.ts` 里的 `...zhHantWorkflow` 写成 `...zhCnWorkflow`。

脚本先写临时文件，成功后在同一目录改名替换。转换或写入失败时退出非零，不替换已有的 `zh-CN.ts` 和 `zhCnWorkflow.ts`。

跑完并提交之后，这两份文件就是源。之后手改简体句子。再跑脚本会盖掉手改。脚本顶部注释写明：这是一次性重置，不是日常步骤。没有测试去断言简体句子仍等于 OpenCC 输出。

`translations` 增加 `'zh-CN': zhCn`。`Translations` 是 `Record<Language, TranslationKeys>`，缺键过不了类型检查。运行时不因缺键回退到繁体。

界面继续用 `translations[lang]`。语言是 `zh-CN` 时，标题、按钮和设置文案都来自这份简体表，不在运行时再转换。

语言码的三处配套：

- `resolveDocumentLocale('zh-CN')` 返回 `zh-CN`
- `resolveDateLocale('zh-CN')` 返回 `zh-CN`
- `isChineseLanguage` 对 `zh-CN` 和 `zh-Hant` 都为真

专门比较 `'zh-Hant'` 才决定给用户看的句子时，补上简体分支。只判断“是不是中文”的地方改走 `isChineseLanguage`。

## 4. 检查、对话与回主站

检查和对话请求里的 `lang` 使用当前界面语言。界面是简体时原样发送 `zh-CN`。主站后端不用改。

`prompts.ts` 把 `zh-CN` 算作界面语言（放进 `CHROME_LANGUAGES`）。界面语言是 `zh-CN` 时：

- 检查模板用已有的 `inspection.zh-CN`
- 对话模板用已有的 `conversation.zh-CN`
- 检查指令用「请使用简体中文生成所有报告内容，包括总结、问题标题和描述。」
- 对话指令用「请使用简体中文回复，简洁准确。」

`zh-Hant` 仍用繁体模板和繁体指令。法、德、西、韩仍用英文模板加各自的语言指令。生成机器人的英文模板不改。不使用 OpenCC 改写提示词。

检查配置的 `nameZh` / `descriptionZh` 已经是简体。简体和繁体界面都继续用它们，包括检查设置的显示，以及放进模型条件说明的文字。不为简体再抄一份检查项，也不为繁体另做一套。

下面两处 `localeFromLang` 今天只列出 `zh-Hant`，其余落到 `en`。`zh-CN` 必须显式返回 `zh-CN`：

- `src/integrations/robots-studio/requirementsSectionLabels.ts`
- `src/integrations/robots-studio/studioModificationTools.ts`

`studioLangToOrdersLocale` 继续把界面语言原样放进主站路径。界面是 `zh-CN` 时，询价地址是 `{主站}/zh-CN/orders?...`。不另做对照表。

## 5. 测试

- `normalizeLanguage`：`zh-CN`、`zh-Hans`、`zh-Hans-CN`、`zh` 为简体；`zh-Hant`、`zh-Hant-TW`、`zh-TW`、`zh-HK` 为繁体。持久化 `lang` 为 `zh-Hant` 时，直接打开仍是繁体。
- `getLanguageFromRobotsHandoffSearch('?lang=zh-CN')` 为 `zh-CN`。
- rehydrate 出 `zh-Hant` 之后再应用 `lang=zh-CN`，保存的 `lang` 变成 `zh-CN`。没有 `lang` 或无法识别时，不改已保存的语言。
- `zh-CN.ts` 的流程文案与 `zhCnWorkflow` 一致。简体与繁体的键集合相同。
- 脚本导出的转换函数：输入 `'{count} 行未變更（已摺疊）'`，得到 `'{count} 行未变更（已折叠）'`。这只保护脚本，不要求已提交的简体文件永远等于重新生成的结果。
- `getInspectionSystemPrompt('zh-CN')` 和 `getConversationSystemPrompt('zh-CN')` 含简体指令，不含繁体指令。`zh-Hant` 仍是繁体。
- 两处 `localeFromLang('zh-CN')` 返回 `zh-CN`。
- 询价 URL 含 `/zh-CN/orders`。

## 6. 不做

- 不改 SEO 静态页、sitemap、`/zh-CN` 路径识别。
- 不把日语加回选择器。
- 不用 OpenCC 改提示词或检查项文案。
- 不把已经存成 `zh-Hant` 的用户改成简体。
- 不改 robots 仓库，也不改主站 `prompt_builder.py`。
