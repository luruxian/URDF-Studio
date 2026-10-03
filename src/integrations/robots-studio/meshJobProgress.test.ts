import assert from 'node:assert/strict';
import test from 'node:test';

import { meshJobProgressPercent } from './meshJobProgress.ts';

test('meshJobProgressPercent accepts integers from 0 through 100', () => {
  assert.equal(meshJobProgressPercent(0), 0);
  assert.equal(meshJobProgressPercent(40), 40);
  assert.equal(meshJobProgressPercent(100), 100);
});

test('meshJobProgressPercent rejects missing, null, non-integers, and out-of-range values', () => {
  assert.equal(meshJobProgressPercent(undefined), null);
  assert.equal(meshJobProgressPercent(null), null);
  assert.equal(meshJobProgressPercent(40.5), null);
  assert.equal(meshJobProgressPercent(-1), null);
  assert.equal(meshJobProgressPercent(101), null);
  assert.equal(meshJobProgressPercent('40'), null);
  assert.equal(meshJobProgressPercent(true), null);
});
