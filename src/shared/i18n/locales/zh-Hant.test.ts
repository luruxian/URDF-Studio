import assert from 'node:assert/strict';
import test from 'node:test';

import { zhHant } from './zh-Hant.ts';
import { zhHantWorkflow } from './zhHantWorkflow.ts';

test('advanced mode product copy stays consistent in Traditional Chinese', () => {
  assert.equal(zhHant.proMode, '高級模式');
  assert.match(zhHant.generateWorkspaceUrdfConfirmMessage, /高級模式/);
  assert.match(zhHant.generateWorkspaceUrdfDisconnected, /高級模式/);
  assert.match(zhHant.exportProjectWorkspaceSummaryDesc, /高級模式/);
  assert.match(zhHant.disconnectedWorkspaceUrdfExportMessage, /高級模式/);
  assert.doesNotMatch(zhHant.exportProjectWorkspaceSummaryDesc, /專業模式/);
});

test('zh-Hant locale keeps workflow copy from the workflow source of truth', () => {
  for (const key of Object.keys(zhHantWorkflow) as Array<keyof typeof zhHantWorkflow>) {
    assert.equal(zhHant[key], zhHantWorkflow[key], `workflow key drifted: ${String(key)}`);
  }
});
