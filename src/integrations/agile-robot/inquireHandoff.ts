import type { Language } from '@/shared/i18n';
import type { RobotsStudioBootstrap } from './types';

const ORDER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function studioLangToOrdersLocale(lang: Language): string {
  return lang === 'zh' ? 'zh-CN' : lang;
}

export function canShowStudioInquireButton(
  bootstrap: RobotsStudioBootstrap | null,
): boolean {
  return (
    bootstrap?.can_inquire === true &&
    typeof bootstrap.main_site_origin === 'string' &&
    bootstrap.main_site_origin.trim().length > 0
  );
}

export function buildStudioInquireOrdersUrl(opts: {
  mainSiteOrigin: string;
  lang: Language;
  orderId: string;
}): string | null {
  if (!ORDER_ID_RE.test(opts.orderId)) return null;
  const origin = opts.mainSiteOrigin.replace(/\/$/, '');
  const locale = studioLangToOrdersLocale(opts.lang);
  const params = new URLSearchParams({
    order: opts.orderId,
    action: 'inquire',
  });
  return `${origin}/${locale}/orders?${params.toString()}`;
}
