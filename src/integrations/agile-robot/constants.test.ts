import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED_AGILE_ROBOT_ORIGINS,
  BOOTSTRAP_HASH_PREFIX,
  BOOTSTRAP_STORAGE_KEY,
  HUNYUAN_POLL_INTERVAL_MS,
  HUNYUAN_POLL_TIMEOUT_MS,
  MESSAGE_TYPE,
  isOriginAllowed,
  matchOrigin,
} from './constants.ts';

test('bootstrap protocol constants carry the fixed contract values', () => {
  assert.equal(MESSAGE_TYPE, 'robots:studio-bootstrap');
  assert.equal(BOOTSTRAP_HASH_PREFIX, 'robots-bootstrap');
  assert.equal(BOOTSTRAP_STORAGE_KEY, 'robots_studio_bootstrap');
});

test('hunyuan polling constants are stable intervals', () => {
  assert.equal(HUNYUAN_POLL_INTERVAL_MS, 5000);
  assert.equal(HUNYUAN_POLL_TIMEOUT_MS, 15 * 60 * 1000);
});

test('origin allowlist falls back to production domains when env is unset', () => {
  assert.deepEqual(ALLOWED_AGILE_ROBOT_ORIGINS, [
    'https://*.enkeebot.com',
    'https://*.enkeebot.cn',
  ]);
});

test('matchOrigin matches exact and wildcard patterns', () => {
  assert.equal(
    matchOrigin('https://studio.enkeebot.com', 'https://*.enkeebot.com'),
    true,
  );
  assert.equal(
    matchOrigin('https://a.b.enkeebot.com', 'https://*.enkeebot.com'),
    true,
  );
  assert.equal(
    matchOrigin('https://enkeebot.com', 'https://*.enkeebot.com'),
    false,
  );
});

test('matchOrigin rejects scheme mismatches and unrelated hosts', () => {
  assert.equal(
    matchOrigin('http://studio.enkeebot.com', 'https://*.enkeebot.com'),
    false,
  );
  assert.equal(
    matchOrigin('https://enkeebot.com.evil.example', 'https://*.enkeebot.com'),
    false,
  );
});

test('matchOrigin rejects malformed or non-http(s) input', () => {
  assert.equal(matchOrigin('not-a-url', 'https://*.enkeebot.com'), false);
  assert.equal(matchOrigin('ftp://studio.enkeebot.com', 'https://*.enkeebot.com'), false);
});

test('matchOrigin strips userinfo so host validation sees the real host', () => {
  // URL userinfo must not smuggle a different host past the allowlist.
  assert.equal(
    matchOrigin('https://studio.enkeebot.com@evil.example', 'https://*.enkeebot.com'),
    false,
  );
  assert.equal(
    matchOrigin('https://evil.example@studio.enkeebot.com', 'https://*.enkeebot.com'),
    true,
  );
});

test('isOriginAllowed accepts production enkeebot origins and rejects others', () => {
  assert.equal(isOriginAllowed('https://studio.enkeebot.com'), true);
  assert.equal(isOriginAllowed('https://a.b.enkeebot.cn'), true);
  assert.equal(isOriginAllowed('https://evil.example'), false);
  assert.equal(isOriginAllowed('http://localhost:5173'), false);
});
