import assert from 'node:assert/strict';
import test from 'node:test';

import { de } from './de.ts';
import { deWorkflow } from './deWorkflow.ts';

test('German locale keeps workflow copy from the workflow source of truth', () => {
  for (const key of Object.keys(deWorkflow) as Array<keyof typeof deWorkflow>) {
    assert.equal(de[key], deWorkflow[key], `workflow key drifted: ${String(key)}`);
  }
});
