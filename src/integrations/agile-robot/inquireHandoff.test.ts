import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStudioInquireOrdersUrl,
  canShowStudioInquireButton,
  studioLangToOrdersLocale,
} from './inquireHandoff.ts';

const ORDER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('studioLangToOrdersLocale matches robots public locales', () => {
  assert.equal(studioLangToOrdersLocale('zh-Hant'), 'zh-Hant');
  assert.equal(studioLangToOrdersLocale('en'), 'en');
});

test('buildStudioInquireOrdersUrl builds absolute inquire deep link', () => {
  const url = buildStudioInquireOrdersUrl({
    mainSiteOrigin: 'https://robots.test',
    lang: 'zh-Hant',
    orderId: ORDER_ID,
  });
  assert.equal(
    url,
    `https://robots.test/zh-Hant/orders?order=${ORDER_ID}&action=inquire`,
  );
});

test('buildStudioInquireOrdersUrl returns null for invalid order id', () => {
  assert.equal(
    buildStudioInquireOrdersUrl({
      mainSiteOrigin: 'https://robots.test',
      lang: 'en',
      orderId: 'not-a-uuid',
    }),
    null,
  );
});

test('canShowStudioInquireButton requires can_inquire and main_site_origin', () => {
  assert.equal(
    canShowStudioInquireButton({
      studio_token: 't',
      studio_expires_at: '2026-01-01T00:00:00.000Z',
      api_base_url: 'https://robots.test/api/v1',
      order_id: ORDER_ID,
      attachment_id: 'a',
      conversation_id: null,
      input_image_path: 'p',
      fallback_input_image_path: 'p',
      can_inquire: true,
      main_site_origin: 'https://robots.test',
    }),
    true,
  );
  assert.equal(canShowStudioInquireButton(null), false);
});
