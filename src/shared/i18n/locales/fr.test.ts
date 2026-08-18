import assert from 'node:assert/strict';
import test from 'node:test';

import { fr } from './fr.ts';
import { frWorkflow } from './frWorkflow.ts';

test('French locale keeps workflow copy from the workflow source of truth', () => {
  for (const key of Object.keys(frWorkflow) as Array<keyof typeof frWorkflow>) {
    assert.equal(fr[key], frWorkflow[key], `workflow key drifted: ${String(key)}`);
  }
});
