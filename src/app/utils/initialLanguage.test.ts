import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import { getLanguageFromPath, hideSeoLanguagePathFromUserUrl } from './initialLanguage.ts';

test('getLanguageFromPath recognizes explicit English, Chinese, Japanese, French, German, and Spanish path prefixes', () => {
  assert.equal(getLanguageFromPath('/zh/'), 'zh');
  assert.equal(getLanguageFromPath('/zh'), 'zh');
  assert.equal(getLanguageFromPath('/zh/?from=search'), 'zh');
  assert.equal(getLanguageFromPath('/ja/'), 'ja');
  assert.equal(getLanguageFromPath('/ja'), 'ja');
  assert.equal(getLanguageFromPath('/ja/?from=search'), 'ja');
  assert.equal(getLanguageFromPath('/fr/'), 'fr');
  assert.equal(getLanguageFromPath('/fr'), 'fr');
  assert.equal(getLanguageFromPath('/fr/?from=search'), 'fr');
  assert.equal(getLanguageFromPath('/de/'), 'de');
  assert.equal(getLanguageFromPath('/de'), 'de');
  assert.equal(getLanguageFromPath('/de/?from=search'), 'de');
  assert.equal(getLanguageFromPath('/es/'), 'es');
  assert.equal(getLanguageFromPath('/es'), 'es');
  assert.equal(getLanguageFromPath('/es/?from=search'), 'es');
  assert.equal(getLanguageFromPath('/en/'), 'en');
  assert.equal(getLanguageFromPath('/en'), 'en');
  assert.equal(getLanguageFromPath('/en/?from=search'), 'en');
  assert.equal(getLanguageFromPath('/'), null);
  assert.equal(getLanguageFromPath('/robots/zh/model'), null);
  assert.equal(getLanguageFromPath('/robots/en/model'), null);
  assert.equal(getLanguageFromPath('/robots/ja/model'), null);
  assert.equal(getLanguageFromPath('/robots/fr/model'), null);
  assert.equal(getLanguageFromPath('/robots/de/model'), null);
  assert.equal(getLanguageFromPath('/robots/es/model'), null);
});

test('hideSeoLanguagePathFromUserUrl normalizes direct Chinese SEO-page visits for the app', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://urdf.enkeebot.com/zh/?asset=go2#viewer',
  });
  const previousWindow = globalThis.window;

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;

  try {
    hideSeoLanguagePathFromUserUrl();

    assert.equal(dom.window.location.pathname, '/');
    assert.equal(dom.window.location.search, '?asset=go2');
    assert.equal(dom.window.location.hash, '#viewer');
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      (globalThis as { window?: Window }).window = previousWindow;
    }
    dom.window.close();
  }
});

test('hideSeoLanguagePathFromUserUrl normalizes direct English SEO-page visits for the app', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://urdf.enkeebot.com/en/?asset=go2#viewer',
  });
  const previousWindow = globalThis.window;

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;

  try {
    hideSeoLanguagePathFromUserUrl();

    assert.equal(dom.window.location.pathname, '/');
    assert.equal(dom.window.location.search, '?asset=go2');
    assert.equal(dom.window.location.hash, '#viewer');
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      (globalThis as { window?: Window }).window = previousWindow;
    }
    dom.window.close();
  }
});
