import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  getRuntimeLanguageTranslations,
  normalizeLanguage,
  resolveRuntimeLanguage,
} from './runtimeLanguage.ts';

function installDom(html = '<!doctype html><html><body></body></html>') {
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
  });

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });

  return dom;
}

test('normalizeLanguage maps regional browser language tags', () => {
  assert.equal(normalizeLanguage('zh-CN'), 'zh');
  assert.equal(normalizeLanguage('zh-Hans'), 'zh');
  assert.equal(normalizeLanguage('en-US'), 'en');
  assert.equal(normalizeLanguage('en-GB'), 'en');
  assert.equal(normalizeLanguage('ja-JP'), 'ja');
  assert.equal(normalizeLanguage('ja'), 'ja');
  assert.equal(normalizeLanguage('fr-FR'), 'fr');
  assert.equal(normalizeLanguage('fr'), 'fr');
  assert.equal(normalizeLanguage('fr-CA'), 'fr');
  assert.equal(normalizeLanguage('de-DE'), 'de');
  assert.equal(normalizeLanguage('de'), 'de');
  assert.equal(normalizeLanguage('de-AT'), 'de');
  assert.equal(normalizeLanguage('es-ES'), 'es');
  assert.equal(normalizeLanguage('es'), 'es');
  assert.equal(normalizeLanguage('es-MX'), 'es');
  assert.equal(normalizeLanguage('it-IT'), null);
});

test('resolveRuntimeLanguage prefers the active document language marker', () => {
  const dom = installDom('<!doctype html><html data-lang="zh"><body></body></html>');

  try {
    window.localStorage.setItem('language', 'en');
    assert.equal(resolveRuntimeLanguage(), 'zh');
    assert.equal(getRuntimeLanguageTranslations().t.appErrorBoundaryTitle, '应用遇到错误');
  } finally {
    dom.window.close();
  }
});

test('resolveRuntimeLanguage uses persisted app language before navigator language', () => {
  const dom = installDom();

  try {
    document.documentElement.removeAttribute('data-lang');
    document.documentElement.removeAttribute('lang');
    window.localStorage.setItem('language', 'zh-CN');
    assert.equal(resolveRuntimeLanguage(), 'zh');
  } finally {
    dom.window.close();
  }
});
