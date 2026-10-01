import assert from 'node:assert/strict';
import test from 'node:test';

import { convertTraditionalToSimplified } from './zh_cn_locale.mjs';

test('convertTraditionalToSimplified turns the collapsed-lines phrase into simplified Chinese', () => {
  assert.equal(
    convertTraditionalToSimplified('{count} 行未變更（已摺疊）'),
    '{count} 行未变更（已折叠）',
  );
});
