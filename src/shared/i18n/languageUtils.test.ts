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
