import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MESH_JOB_POLL_INTERVAL_MS,
  DEFAULT_MESH_JOB_POLL_TIMEOUT_MS,
  resolveMeshJobPollConfig,
} from './meshRegeneratePollConfig.ts';

test('resolveMeshJobPollConfig uses defaults when env is unset', () => {
  assert.deepEqual(resolveMeshJobPollConfig({}, {}), {
    intervalMs: DEFAULT_MESH_JOB_POLL_INTERVAL_MS,
    timeoutMs: DEFAULT_MESH_JOB_POLL_TIMEOUT_MS,
  });
});

test('resolveMeshJobPollConfig reads VITE_MESH_JOB_POLL_* from env', () => {
  assert.deepEqual(
    resolveMeshJobPollConfig(
      {
        VITE_MESH_JOB_POLL_INTERVAL_MS: '3000',
        VITE_MESH_JOB_POLL_TIMEOUT_MS: '600000',
      },
      {},
    ),
    { intervalMs: 3000, timeoutMs: 600_000 },
  );
});

test('resolveMeshJobPollConfig prefers import.meta env over process env', () => {
  assert.deepEqual(
    resolveMeshJobPollConfig(
      { VITE_MESH_JOB_POLL_INTERVAL_MS: '4000' },
      { VITE_MESH_JOB_POLL_INTERVAL_MS: '8000' },
    ),
    {
      intervalMs: 4000,
      timeoutMs: DEFAULT_MESH_JOB_POLL_TIMEOUT_MS,
    },
  );
});

test('resolveMeshJobPollConfig falls back on invalid values', () => {
  assert.deepEqual(
    resolveMeshJobPollConfig(
      {
        VITE_MESH_JOB_POLL_INTERVAL_MS: '0',
        VITE_MESH_JOB_POLL_TIMEOUT_MS: 'not-a-number',
      },
      {},
    ),
    {
      intervalMs: DEFAULT_MESH_JOB_POLL_INTERVAL_MS,
      timeoutMs: DEFAULT_MESH_JOB_POLL_TIMEOUT_MS,
    },
  );
});

test('resolveMeshJobPollConfig resets timeout when it is shorter than interval', () => {
  assert.deepEqual(
    resolveMeshJobPollConfig(
      {
        VITE_MESH_JOB_POLL_INTERVAL_MS: '10000',
        VITE_MESH_JOB_POLL_TIMEOUT_MS: '5000',
      },
      {},
    ),
    {
      intervalMs: 10_000,
      timeoutMs: DEFAULT_MESH_JOB_POLL_TIMEOUT_MS,
    },
  );
});
