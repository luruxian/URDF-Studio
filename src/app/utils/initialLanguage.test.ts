import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import {
  applyLanguageAfterHydration,
  getLanguageFromPath,
  getLanguageFromRobotsHandoffSearch,
  hideRobotsHandoffLangFromUserUrl,
  hideSeoLanguagePathFromUserUrl,
} from './initialLanguage.ts';

test('getLanguageFromPath recognizes explicit English, Chinese, Japanese, French, German, and Spanish path prefixes', () => {
  assert.equal(getLanguageFromPath('/zh-Hant/'), 'zh-Hant');
  assert.equal(getLanguageFromPath('/zh-Hant'), 'zh-Hant');
  assert.equal(getLanguageFromPath('/zh-Hant/?from=search'), 'zh-Hant');
  assert.equal(getLanguageFromPath('/zh/'), 'zh-Hant');
  assert.equal(getLanguageFromPath('/zh'), 'zh-Hant');
  assert.equal(getLanguageFromPath('/zh/?from=search'), 'zh-Hant');
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

test('applyLanguageAfterHydration waits until persist hydration before writing zh-CN', () => {
  const writes: string[] = [];
  let hydrated = false;
  let listener: (() => void) | null = null;
  let hidden = false;

  applyLanguageAfterHydration(
    'zh-CN',
    {
      hasHydrated: () => hydrated,
      onFinishHydration: (fn) => {
        listener = fn;
      },
      setLang: (lang) => {
        writes.push(lang);
      },
    },
    () => {
      hidden = true;
    },
  );

  assert.deepEqual(writes, []);
  assert.equal(hidden, false);
  listener?.();
  assert.deepEqual(writes, ['zh-CN']);
  assert.equal(hidden, true);
});

test('applyLanguageAfterHydration writes immediately when hydration already finished', () => {
  const writes: string[] = [];
  applyLanguageAfterHydration(
    'zh-CN',
    {
      hasHydrated: () => true,
      onFinishHydration: () => {
        throw new Error('listener should not be registered');
      },
      setLang: (lang) => {
        writes.push(lang);
      },
    },
    () => {},
  );
  assert.deepEqual(writes, ['zh-CN']);
});

test('applyLanguageAfterHydration ignores an unrecognized handoff language', () => {
  let called = false;
  applyLanguageAfterHydration(
    null,
    {
      hasHydrated: () => true,
      onFinishHydration: () => {
        throw new Error('listener should not be registered');
      },
      setLang: () => {
        called = true;
      },
    },
    () => {
      called = true;
    },
  );
  assert.equal(called, false);
});

test('getLanguageFromRobotsHandoffSearch maps main-site locale query param', () => {
  assert.equal(getLanguageFromRobotsHandoffSearch('?mesh=x&lang=zh-Hant'), 'zh-Hant');
  assert.equal(getLanguageFromRobotsHandoffSearch('?lang=en&import=pvw_1'), 'en');
  assert.equal(getLanguageFromRobotsHandoffSearch('?lang=zh-CN'), 'zh-CN');
  assert.equal(getLanguageFromRobotsHandoffSearch('?mesh=x'), null);
});

test('hideRobotsHandoffLangFromUserUrl strips lang while keeping handoff query params', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://urdf.enkeebot.com/?mesh=abc&lang=zh-Hant&from=https%3A%2F%2Frobots.test#robots-bootstrap=1',
  });
  const previousWindow = globalThis.window;

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;

  try {
    hideRobotsHandoffLangFromUserUrl();

    assert.equal(dom.window.location.pathname, '/');
    assert.match(dom.window.location.search, /\bmesh=abc/);
    assert.match(dom.window.location.search, /\bfrom=/);
    assert.doesNotMatch(dom.window.location.search, /\blang=/);
    assert.equal(dom.window.location.hash, '#robots-bootstrap=1');
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      (globalThis as { window?: Window }).window = previousWindow;
    }
    dom.window.close();
  }
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
