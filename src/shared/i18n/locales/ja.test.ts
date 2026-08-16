import assert from 'node:assert/strict';
import test from 'node:test';

import { ja } from './ja.ts';
import { jaWorkflow } from './jaWorkflow.ts';

test('Japanese locale keeps workflow copy from the workflow source of truth', () => {
  for (const key of Object.keys(jaWorkflow) as Array<keyof typeof jaWorkflow>) {
    assert.equal(ja[key], jaWorkflow[key], `workflow key drifted: ${String(key)}`);
  }
});
