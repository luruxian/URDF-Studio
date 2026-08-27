import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyRobot } from '@/core/robot/builders';
import { translations } from '@/shared/i18n';
import { setAiBackendBaseUrlResolver } from '@/shared/hostIntegrationState';

const minimalRobot = createEmptyRobot();

test('generateRobotFromPrompt returns login handoff when backend is disabled', async () => {
  const previousBackendUrl = process.env.AI_BACKEND_URL;
  const previousApiKey = process.env.API_KEY;
  delete process.env.AI_BACKEND_URL;
  delete process.env.API_KEY;
  setAiBackendBaseUrlResolver(null);

  try {
    const { generateRobotFromPrompt } = await import('./aiService.ts');
    const result = await generateRobotFromPrompt('hi', minimalRobot, {}, 'en');
    assert.ok(result);
    assert.equal(result!.actionType, 'advice');
    assert.equal(result!.explanation, translations.en.aiLoginRequired);
  } finally {
    if (previousBackendUrl === undefined) {
      delete process.env.AI_BACKEND_URL;
    } else {
      process.env.AI_BACKEND_URL = previousBackendUrl;
    }
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    setAiBackendBaseUrlResolver(null);
  }
});

test('runRobotInspection returns login handoff when backend is disabled', async () => {
  const previousBackendUrl = process.env.AI_BACKEND_URL;
  const previousApiKey = process.env.API_KEY;
  delete process.env.AI_BACKEND_URL;
  delete process.env.API_KEY;
  setAiBackendBaseUrlResolver(null);

  try {
    const { runRobotInspection } = await import('./aiService.ts');
    const report = await runRobotInspection(minimalRobot, undefined, 'en');
    assert.ok(report);
    assert.equal(report!.summary, translations.en.aiLoginRequired);
    assert.equal(report!.issues[0]?.description, translations.en.aiLoginRequired);
  } finally {
    if (previousBackendUrl === undefined) {
      delete process.env.AI_BACKEND_URL;
    } else {
      process.env.AI_BACKEND_URL = previousBackendUrl;
    }
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    setAiBackendBaseUrlResolver(null);
  }
});
