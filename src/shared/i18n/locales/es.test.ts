import assert from 'node:assert/strict';
import test from 'node:test';

import { es } from './es.ts';
import { esWorkflow } from './esWorkflow.ts';

test('Spanish locale keeps workflow copy from the workflow source of truth', () => {
  for (const key of Object.keys(esWorkflow) as Array<keyof typeof esWorkflow>) {
    assert.equal(es[key], esWorkflow[key], `workflow key drifted: ${String(key)}`);
  }
});
