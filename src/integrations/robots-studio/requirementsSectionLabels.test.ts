import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatProposeRevisionSectionSummary,
  getRequirementsSectionLabel,
  resolveRequirementsSectionId,
} from './requirementsSectionLabels';

test('resolveRequirementsSectionId accepts canonical and simplified keys', () => {
  assert.equal(resolveRequirementsSectionId('背景'), '背景');
  assert.equal(resolveRequirementsSectionId('性能参数'), '性能參數');
  assert.equal(resolveRequirementsSectionId('机型'), '機型');
  assert.equal(resolveRequirementsSectionId('unknown'), null);
});

test('formatProposeRevisionSectionSummary localizes section names for English', () => {
  const summary = formatProposeRevisionSectionSummary(
    'Submit requirements revision',
    ['背景', '性能參數'],
    'en',
  );
  assert.match(summary, /Submit requirements revision \(Background/);
  assert.match(summary, /Performance parameters/);
  assert.doesNotMatch(summary, /背景/);
});

test('formatProposeRevisionSectionSummary keeps CJK labels for zh-Hant', () => {
  const summary = formatProposeRevisionSectionSummary(
    '提交需求確認書修訂',
    ['背景', '性能參數'],
    'zh-Hant',
  );
  assert.match(summary, /提交需求確認書修訂（/);
  assert.match(summary, /背景/);
  assert.match(summary, /性能參數/);
});

test('getRequirementsSectionLabel returns localized label', () => {
  assert.equal(getRequirementsSectionLabel('機型', 'en'), 'Robot model');
  assert.equal(getRequirementsSectionLabel('機型', 'zh-Hant'), '機型');
});
