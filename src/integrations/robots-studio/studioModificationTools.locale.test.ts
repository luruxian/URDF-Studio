import assert from 'node:assert/strict';
import test from 'node:test';

import { localeFromLang } from './studioModificationTools.ts';

test('mesh tool localeFromLang keeps simplified Chinese', () => {
  assert.equal(localeFromLang('zh-CN'), 'zh-CN');
});
