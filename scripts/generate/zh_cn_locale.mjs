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
