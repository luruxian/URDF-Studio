/**
 * URL language helpers for the per-language static pages emitted by
 * scripts/generate/seo_prerender.mjs.
 */
import { normalizeLanguage, type Language } from '@/shared/i18n';

/** Query param robots main site sets when opening Studio preview (`agentApi` STUDIO_LANG_QUERY_PARAM). */
export const ROBOTS_HANDOFF_LANG_QUERY_PARAM = 'lang';

/** Returns the language encoded in a URL path, or null when the path carries no signal. */
export function getLanguageFromPath(pathname: string): Language | null {
  if (/^\/zh-Hant(\/|$)/i.test(pathname)) return 'zh-Hant';
  // Legacy SEO entry still served at /zh/
  if (/^\/zh(\/|$)/.test(pathname)) return 'zh-Hant';
  if (/^\/ja(\/|$)/.test(pathname)) return 'ja';
  if (/^\/fr(\/|$)/.test(pathname)) return 'fr';
  if (/^\/de(\/|$)/.test(pathname)) return 'de';
  if (/^\/es(\/|$)/.test(pathname)) return 'es';
  if (/^\/en(\/|$)/.test(pathname)) return 'en';
  return null;
}

/** Reads robots handoff `lang` query param; null when absent or unsupported. */
export function getLanguageFromRobotsHandoffSearch(search: string): Language | null {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  return normalizeLanguage(params.get(ROBOTS_HANDOFF_LANG_QUERY_PARAM));
}

/** Reads the URL language signal in the browser; null on the server or when absent. */
export function getInitialLanguageFromUrl(): Language | null {
  if (typeof window === 'undefined') return null;
  const fromHandoff = getLanguageFromRobotsHandoffSearch(window.location.search);
  if (fromHandoff) {
    return fromHandoff;
  }
  return getLanguageFromPath(window.location.pathname);
}

/** Removes handoff-only `lang` from the visible URL after applying it to the UI store. */
export function hideRobotsHandoffLangFromUserUrl(): void {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') {
    return;
  }

  const url = new URL(window.location.href);
  if (!url.searchParams.has(ROBOTS_HANDOFF_LANG_QUERY_PARAM)) {
    return;
  }

  url.searchParams.delete(ROBOTS_HANDOFF_LANG_QUERY_PARAM);
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

/** Keeps SEO-only language paths from remaining visible in the interactive app. */
export function hideSeoLanguagePathFromUserUrl(): void {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') {
    return;
  }

  if (getLanguageFromPath(window.location.pathname) === null) {
    return;
  }

  const nextUrl = `/${window.location.search}${window.location.hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}
