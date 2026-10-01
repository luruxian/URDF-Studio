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
