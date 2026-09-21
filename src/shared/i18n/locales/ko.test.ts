import assert from 'node:assert/strict';
import test from 'node:test';

import { ko } from './ko.ts';
import { koWorkflow } from './koWorkflow.ts';

test('Korean locale keeps workflow copy from the workflow source of truth', () => {
  for (const key of Object.keys(koWorkflow) as Array<keyof typeof koWorkflow>) {
    assert.equal(ko[key], koWorkflow[key], `workflow key drifted: ${String(key)}`);
  }
});
