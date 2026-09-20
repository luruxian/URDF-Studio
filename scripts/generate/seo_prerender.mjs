/**
 * SEO pre-render (post-build step).
 *
 * URDF Studio is a client-rendered WebGL/WASM editor, so true SSR is not viable.
 * Instead this runs after `vite build` and turns the built `dist/index.html` into
 * crawlable, per-language static pages without a headless browser:
 *   - rewrites the per-language head region (title/description/canonical/og/twitter/JSON-LD)
 *   - emits localized variants at `dist/zh-Hant/index.html` (and legacy `dist/zh/` alias) and `dist/ja/index.html`
 *   - regenerates `dist/sitemap.xml` with all URLs + hreflang alternates
 *
 * Language-specific regions in `index.html` are delimited by `<!-- SEO:HEAD:* -->` and
 * `<!-- SEO:CONTENT:* -->` markers. Missing markers throw rather than silently emitting a
 * half-rendered page. The SEO content is hidden from users and replaced by React on mount.
 * Asset URLs stay absolute (Vite base `/`), so `/zh/` needs no rewrite.
 *
 * Usage: node scripts/generate/seo_prerender.mjs   (wired into `npm run build`)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://urdf.enkeebot.com';
const LOGO = `${SITE}/logos/logo.png`;
const GITHUB = 'https://github.com/enkeebot/URDF-Studio';

export const ENKEEBOT_RELATED_PRODUCTS = [
  {
    name: 'BotWorld',
    url: 'https://botworld.enkeebot.com/',
    image: `${SITE}/logos/botworld-logo.webp`,
    description: {
      en: 'Discover and download robot models.',
      'zh-Hant': '發現並下載機器人模型。',
      ja: 'ロボットモデルを発見してダウンロードします。',
      fr: 'Découvrez et téléchargez des modèles de robots.',
      de: 'Robotermodelle entdecken und herunterladen.',
      es: 'Descubre y descarga modelos de robots.',
    },
  },
  {
    name: 'Motion Studio',
    url: 'https://motion.enkeebot.com/',
    image: `${SITE}/logos/motion-studio-logo.webp`,
    description: {
      en: 'Retarget and edit robot motion.',
      'zh-Hant': '重定向並編輯機器人動作。',
      ja: 'ロボットモーションをリターゲットして編集します。',
      fr: 'Retargetez et modifiez les mouvements des robots.',
      de: 'Roboterbewegungen retargeten und bearbeiten.',
      es: 'Retargetea y edita movimientos de robots.',
    },
  },
  {
    name: 'BotLab',
    url: 'https://botlab.enkeebot.com/',
    image: `${SITE}/logos/botlab-logo.webp`,
    description: {
      en: 'Simulate and validate robots in the browser.',
      'zh-Hant': '在瀏覽器中仿真並驗證機器人。',
      ja: 'ブラウザ上でロボットをシミュレーションし検証します。',
      fr: 'Simulez et validez des robots dans le navigateur.',
      de: 'Roboter im Browser simulieren und validieren.',
      es: 'Simula y valida robots en el navegador.',
    },
  },
];

const seoContent = {
  en: {
    ogLocale: 'en_US',
    title: 'URDF Studio - Professional Robot Design & Visualization Tool',
    description:
      'Free in-browser editor and viewer for robot models: URDF, MJCF, USD, SDF and Xacro. ' +
      'Edit kinematics, optimize collisions, assemble modules and convert formats.',
    url: `${SITE}/`,
    inLanguage: ['en', 'zh-Hant', 'ja', 'fr', 'de', 'es'],
    featureList: [
      'URDF / MJCF / SDF / USD / Xacro import and export',
      'Collision geometry optimization',
      'Multi-robot modular assembly with bridge joints',
      'Hardware and motor configuration',
      'AI generation and review',
      'PDF and CSV reports',
    ],
    hero: {
      tagline: 'Professional online editor & visualizer for robot models',
      sub:
        'Import, edit, visualize and convert URDF, MJCF, USD, SDF and Xacro robots — ' +
        'collision optimization, modular assembly and AI review, all in your browser.',
      formatsLabel: 'Supported formats',
      relatedProductsLabel: 'Related EnkeeBot products',
      noscript: 'URDF Studio needs JavaScript enabled to run the interactive editor.',
    },
  },
  'zh-Hant': {
    ogLocale: 'zh_TW',
    title: 'URDF Studio - 專業機器人設計與可視化工具',
    description:
      '免費的瀏覽器端機器人模型編輯與可視化工作站，支持 URDF、MJCF、USD、SDF、Xacro 的導入、編輯與轉換，' +
      '提供運動學編輯、碰撞優化、模塊組裝與 AI 審閱。',
    url: `${SITE}/zh-Hant/`,
    inLanguage: ['zh-Hant', 'en', 'ja', 'fr', 'de', 'es'],
    featureList: [
      'URDF / MJCF / SDF / USD / Xacro 導入與導出',
      '碰撞幾何優化',
      '多機器人模塊化組裝與橋接關節',
      '硬件與電機配置',
      'AI 生成與審閱',
      'PDF 與 CSV 報告',
    ],
    hero: {
      tagline: '專業的在線機器人模型編輯與可視化工具',
      sub:
        '在瀏覽器中導入、編輯、可視化與轉換 URDF、MJCF、USD、SDF、Xacro 機器人模型，' +
        '支持碰撞優化、模塊組裝與 AI 審閱。',
      formatsLabel: '支持的格式',
      relatedProductsLabel: 'EnkeeBot 相關產品',
      noscript: '運行 URDF Studio 交互式編輯器需要啟用 JavaScript。',
    },
  },
  ja: {
    ogLocale: 'ja_JP',
    title: 'URDF Studio - プロフェッショナルなロボット設計・可視化ツール',
    description:
      'URDF、MJCF、USD、SDF、Xacro に対応した無料のブラウザ型ロボットモデル編集・可視化ワークステーション。' +
      '運動學編集、衝突最適化、モジュール組立、形式変換に対応。',
    url: `${SITE}/ja/`,
    inLanguage: ['ja', 'en', 'zh-Hant', 'fr', 'de', 'es'],
    featureList: [
      'URDF / MJCF / SDF / USD / Xacro のインポートとエクスポート',
      '衝突ジオメトリ最適化',
      'ブリッジ joint によるマルチロボット組立',
      'ハードウェアとモーター設定',
      'AI 生成とレビュー',
      'PDF / CSV レポート',
    ],
    hero: {
      tagline: 'ロボットモデル向けのプロフェッショナルなオンライン編集・可視化ツール',
      sub:
        'ブラウザ上で URDF、MJCF、USD、SDF、Xacro ロボットをインポート、編集、可視化、変換。' +
        '衝突最適化、モジュール組立、AI レビューにも対応。',
      formatsLabel: '対応形式',
      relatedProductsLabel: '関連 EnkeeBot 製品',
      noscript: 'URDF Studio の対話型エディターを実行するには JavaScript を有効にしてください。',
    },
  },
  fr: {
    ogLocale: 'fr_FR',
    title: 'URDF Studio - Outil professionnel de conception et de visualisation de robots',
    description:
      'Éditeur et visualiseur gratuit de modèles de robots dans le navigateur : URDF, MJCF, USD, SDF et Xacro. ' +
      'Modifiez la cinématique, optimisez les collisions, assemblez des modules et convertissez les formats.',
    url: `${SITE}/fr/`,
    inLanguage: ['fr', 'en', 'zh-Hant', 'ja', 'de', 'es'],
    featureList: [
      'Import et export URDF / MJCF / SDF / USD / Xacro',
      'Optimisation de la géométrie de collision',
      'Assemblage modulaire multi-robots avec joints de pont',
      'Configuration matérielle et moteurs',
      'Génération et revue par IA',
      'Rapports PDF et CSV',
    ],
    hero: {
      tagline: 'Éditeur et visualiseur en ligne professionnel pour modèles de robots',
      sub:
        'Importez, modifiez, visualisez et convertissez des robots URDF, MJCF, USD, SDF et Xacro — ' +
        'optimisation des collisions, assemblage modulaire et revue IA, directement dans votre navigateur.',
      formatsLabel: 'Formats pris en charge',
      relatedProductsLabel: 'Produits EnkeeBot associés',
      noscript: 'URDF Studio nécessite JavaScript pour exécuter l’éditeur interactif.',
    },
  },
  de: {
    ogLocale: 'de_DE',
    title: 'URDF Studio – Professionelles Werkzeug für Roboter-Design und Visualisierung',
    description:
      'Kostenloser browserbasierter Editor und Viewer für Robotermodelle: URDF, MJCF, USD, SDF und Xacro. ' +
      'Kinematik bearbeiten, Kollisionen optimieren, Module zusammenbauen und Formate konvertieren.',
    url: `${SITE}/de/`,
    inLanguage: ['de', 'en', 'zh-Hant', 'ja', 'fr', 'es'],
    featureList: [
      'Import und Export von URDF / MJCF / SDF / USD / Xacro',
      'Optimierung der Kollisionsgeometrie',
      'Modularer Multi-Roboter-Zusammenbau mit Bridge-Joints',
      'Hardware- und Motor-Konfiguration',
      'KI-Generierung und -Review',
      'PDF- und CSV-Berichte',
    ],
    hero: {
      tagline: 'Professioneller Online-Editor und Viewer für Robotermodelle',
      sub:
        'Importieren, bearbeiten, visualisieren und konvertieren Sie URDF-, MJCF-, USD-, SDF- und Xacro-Roboter — ' +
        'Kollisionsoptimierung, modularer Zusammenbau und KI-Review direkt im Browser.',
      formatsLabel: 'Unterstützte Formate',
      relatedProductsLabel: 'Verwandte EnkeeBot-Produkte',
      noscript: 'URDF Studio benötigt JavaScript, um den interaktiven Editor auszuführen.',
    },
  },
  es: {
    ogLocale: 'es_ES',
    title: 'URDF Studio - Herramienta profesional de diseño y visualización de robots',
    description:
      'Editor y visor gratuito de modelos de robots en el navegador: URDF, MJCF, USD, SDF y Xacro. ' +
      'Edita la cinemática, optimiza colisiones, ensambla módulos y convierte formatos.',
    url: `${SITE}/es/`,
    inLanguage: ['es', 'en', 'zh-Hant', 'ja', 'fr', 'de'],
    featureList: [
      'Importación y exportación de URDF / MJCF / SDF / USD / Xacro',
      'Optimización de geometría de colisión',
      'Ensamblaje modular multirobot con joints puente',
      'Configuración de hardware y motores',
      'Generación y revisión con IA',
      'Informes PDF y CSV',
    ],
    hero: {
      tagline: 'Editor y visualizador en línea profesional para modelos de robots',
      sub:
        'Importa, edita, visualiza y convierte robots URDF, MJCF, USD, SDF y Xacro — ' +
        'optimización de colisiones, ensamblaje modular y revisión con IA, todo en tu navegador.',
      formatsLabel: 'Formatos compatibles',
      relatedProductsLabel: 'Productos relacionados de EnkeeBot',
      noscript: 'URDF Studio necesita JavaScript habilitado para ejecutar el editor interactivo.',
    },
  },
};

function escHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(value) {
  return escHtml(value).replace(/"/g, '&quot;');
}

export function renderHead(lang) {
  const c = seoContent[lang];
  const earlyTitleSync = [
    `    <script>`,
    `(function () {`,
    `  var titles = {`,
    `    en: ${JSON.stringify(seoContent.en.title)},`,
    `    'zh-Hant': ${JSON.stringify(seoContent['zh-Hant'].title)},`,
    `    ja: ${JSON.stringify(seoContent.ja.title)},`,
    `    fr: ${JSON.stringify(seoContent.fr.title)},`,
    `    de: ${JSON.stringify(seoContent.de.title)},`,
    `    es: ${JSON.stringify(seoContent.es.title)}`,
    `  };`,
    `  var lang = 'en';`,
    `  try {`,
    `    if (/^\\/zh-Hant(?:\\/|$)/i.test(window.location.pathname) || /^\\/zh(?:\\/|$)/.test(window.location.pathname)) {`,
    `      lang = 'zh-Hant';`,
    `    } else if (/^\\/ja(?:\\/|$)/.test(window.location.pathname)) {`,
    `      lang = 'ja';`,
    `    } else if (/^\\/fr(?:\\/|$)/.test(window.location.pathname)) {`,
    `      lang = 'fr';`,
    `    } else if (/^\\/de(?:\\/|$)/.test(window.location.pathname)) {`,
    `      lang = 'de';`,
    `    } else if (/^\\/es(?:\\/|$)/.test(window.location.pathname)) {`,
    `      lang = 'es';`,
    `    } else {`,
    `      var saved = window.localStorage && window.localStorage.getItem('language');`,
    `      if (saved === 'en' || saved === 'zh-Hant' || saved === 'zh' || saved === 'ja' || saved === 'fr' || saved === 'de' || saved === 'es') {`,
    `        lang = saved === 'zh' ? 'zh-Hant' : saved;`,
    `      } else {`,
    `        var browserLang = (window.navigator.language || window.navigator.userLanguage || '').toLowerCase();`,
    `        if (browserLang.indexOf('zh') === 0) {`,
    `          lang = 'zh-Hant';`,
    `        } else if (browserLang.indexOf('ja') === 0) {`,
    `          lang = 'ja';`,
    `        } else if (browserLang.indexOf('fr') === 0) {`,
    `          lang = 'fr';`,
    `        } else if (browserLang.indexOf('de') === 0) {`,
    `          lang = 'de';`,
    `        } else if (browserLang.indexOf('es') === 0) {`,
    `          lang = 'es';`,
    `        } else {`,
    `          lang = 'en';`,
    `        }`,
    `      }`,
    `    }`,
    `    document.title = titles[lang] || titles.en;`,
    `  } catch (_error) {`,
    `    document.title = titles.en;`,
    `  }`,
    `})();`,
    `    </script>`,
  ].join('\n');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'URDF Studio',
    url: c.url,
    applicationCategory: 'DesignApplication',
    operatingSystem: 'Web browser',
    description: c.description,
    image: LOGO,
    inLanguage: c.inLanguage,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: c.featureList,
    author: { '@type': 'Organization', name: 'enkeebot', url: GITHUB },
    mentions: ENKEEBOT_RELATED_PRODUCTS.map((product) => ({
      '@type': 'SoftwareApplication',
      name: product.name,
      url: product.url,
      image: product.image,
      description: product.description[lang],
    })),
  };

  return [
    `    <title>${escHtml(c.title)}</title>`,
    earlyTitleSync,
    `    <meta name="description" content="${escAttr(c.description)}">`,
    `    <link rel="canonical" href="${c.url}">`,
    `    <meta property="og:url" content="${c.url}">`,
    `    <meta property="og:title" content="${escAttr(c.title)}">`,
    `    <meta property="og:description" content="${escAttr(c.description)}">`,
    `    <meta property="og:locale" content="${c.ogLocale}">`,
    `    <meta name="twitter:title" content="${escAttr(c.title)}">`,
    `    <meta name="twitter:description" content="${escAttr(c.description)}">`,
    `    <script type="application/ld+json">`,
    JSON.stringify(jsonLd),
    `    </script>`,
  ].join('\n');
}

export function renderContent(lang) {
  const c = seoContent[lang];
  const relatedProductLinks = ENKEEBOT_RELATED_PRODUCTS.map(
    (product) =>
      `          <a href="${escAttr(product.url)}" rel="related" tabindex="-1">${escHtml(product.name)} — ${escHtml(product.description[lang])}</a>`,
  );

  return [
    `      <div class="boot-seo" aria-hidden="true">`,
    `        <img class="boot-logo" src="/logos/logo.png" alt="URDF Studio logo" width="72" height="72">`,
    `        <h1 class="boot-title">URDF Studio</h1>`,
    `        <p class="boot-tagline">${escHtml(c.hero.tagline)}</p>`,
    `        <p class="boot-sub">${escHtml(c.hero.sub)}</p>`,
    `        <ul class="boot-formats" aria-label="${escAttr(c.hero.formatsLabel)}">`,
    `          <li>URDF</li>`,
    `          <li>MJCF</li>`,
    `          <li>USD / USDA</li>`,
    `          <li>SDF</li>`,
    `          <li>Xacro</li>`,
    `        </ul>`,
    `        <nav aria-label="${escAttr(c.hero.relatedProductsLabel)}">`,
    ...relatedProductLinks,
    `        </nav>`,
    `      </div>`,
    `      <noscript class="boot-noscript">`,
    `        ${escHtml(c.hero.noscript)}`,
    `      </noscript>`,
  ].join('\n');
}

function replaceRegion(html, name, inner) {
  const region = new RegExp(
    `(<!--\\s*${name}:START[\\s\\S]*?-->)[\\s\\S]*?(<!--\\s*${name}:END\\s*-->)`,
  );
  if (!region.test(html)) {
    throw new Error(
      `[seo_prerender] marker ${name} not found in built HTML — did the index.html layout change?`,
    );
  }
  return html.replace(region, `$1\n${inner}\n    $2`);
}

function renderSitemap(lastmod) {
  const alternates = [
    `    <xhtml:link rel="alternate" hreflang="en" href="${SITE}/"/>`,
    `    <xhtml:link rel="alternate" hreflang="zh-Hant" href="${SITE}/zh-Hant/"/>`,
    `    <xhtml:link rel="alternate" hreflang="ja" href="${SITE}/ja/"/>`,
    `    <xhtml:link rel="alternate" hreflang="fr" href="${SITE}/fr/"/>`,
    `    <xhtml:link rel="alternate" hreflang="de" href="${SITE}/de/"/>`,
    `    <xhtml:link rel="alternate" hreflang="es" href="${SITE}/es/"/>`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>`,
  ].join('\n');

  const entries = [
    { loc: `${SITE}/`, priority: '1.0' },
    { loc: `${SITE}/zh-Hant/`, priority: '0.9' },
    { loc: `${SITE}/ja/`, priority: '0.9' },
    { loc: `${SITE}/fr/`, priority: '0.9' },
    { loc: `${SITE}/de/`, priority: '0.9' },
    { loc: `${SITE}/es/`, priority: '0.9' },
  ]
    .map((entry) =>
      [
        '  <url>',
        `    <loc>${entry.loc}</loc>`,
        alternates,
        `    <lastmod>${lastmod}</lastmod>`,
        '    <changefreq>weekly</changefreq>',
        `    <priority>${entry.priority}</priority>`,
        '  </url>',
      ].join('\n'),
    )
    .join('\n');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    `${entries}\n` +
    '</urlset>\n'
  );
}

function resolveLastmod(repoRoot) {
  try {
    const committed = execSync('git log -1 --format=%cs', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(committed)) {
      return committed;
    }
  } catch {
    // Fall back to the current date when git history is unavailable.
  }
  return new Date().toISOString().slice(0, 10);
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '../..');
  const distDir = path.join(repoRoot, 'dist');
  const indexPath = path.join(distDir, 'index.html');

  if (!existsSync(indexPath)) {
    throw new Error(`[seo_prerender] ${indexPath} not found — run "vite build" first.`);
  }

  let enHtml = readFileSync(indexPath, 'utf8');
  enHtml = replaceRegion(enHtml, 'SEO:HEAD', renderHead('en'));
  enHtml = replaceRegion(enHtml, 'SEO:CONTENT', renderContent('en'));
  writeFileSync(indexPath, enHtml);

  let zhHtml = enHtml.replace(
    '<html lang="en" translate="no">',
    '<html lang="zh-Hant" translate="no">',
  );
  if (!zhHtml.includes('lang="zh-Hant"')) {
    throw new Error(
      '[seo_prerender] failed to set zh-Hant lang attribute — did the <html> tag change?',
    );
  }
  zhHtml = replaceRegion(zhHtml, 'SEO:HEAD', renderHead('zh-Hant'));
  zhHtml = replaceRegion(zhHtml, 'SEO:CONTENT', renderContent('zh-Hant'));
  mkdirSync(path.join(distDir, 'zh-Hant'), { recursive: true });
  writeFileSync(path.join(distDir, 'zh-Hant', 'index.html'), zhHtml);
  mkdirSync(path.join(distDir, 'zh'), { recursive: true });
  writeFileSync(path.join(distDir, 'zh', 'index.html'), zhHtml);

  let jaHtml = enHtml.replace(
    '<html lang="en" translate="no">',
    '<html lang="ja" translate="no">',
  );
  if (!jaHtml.includes('lang="ja"')) {
    throw new Error(
      '[seo_prerender] failed to set ja lang attribute — did the <html> tag change?',
    );
  }
  jaHtml = replaceRegion(jaHtml, 'SEO:HEAD', renderHead('ja'));
  jaHtml = replaceRegion(jaHtml, 'SEO:CONTENT', renderContent('ja'));
  mkdirSync(path.join(distDir, 'ja'), { recursive: true });
  writeFileSync(path.join(distDir, 'ja', 'index.html'), jaHtml);

  let frHtml = enHtml.replace(
    '<html lang="en" translate="no">',
    '<html lang="fr" translate="no">',
  );
  if (!frHtml.includes('lang="fr"')) {
    throw new Error(
      '[seo_prerender] failed to set fr lang attribute — did the <html> tag change?',
    );
  }
  frHtml = replaceRegion(frHtml, 'SEO:HEAD', renderHead('fr'));
  frHtml = replaceRegion(frHtml, 'SEO:CONTENT', renderContent('fr'));
  mkdirSync(path.join(distDir, 'fr'), { recursive: true });
  writeFileSync(path.join(distDir, 'fr', 'index.html'), frHtml);

  let deHtml = enHtml.replace(
    '<html lang="en" translate="no">',
    '<html lang="de" translate="no">',
  );
  if (!deHtml.includes('lang="de"')) {
    throw new Error(
      '[seo_prerender] failed to set de lang attribute — did the <html> tag change?',
    );
  }
  deHtml = replaceRegion(deHtml, 'SEO:HEAD', renderHead('de'));
  deHtml = replaceRegion(deHtml, 'SEO:CONTENT', renderContent('de'));
  mkdirSync(path.join(distDir, 'de'), { recursive: true });
  writeFileSync(path.join(distDir, 'de', 'index.html'), deHtml);

  let esHtml = enHtml.replace(
    '<html lang="en" translate="no">',
    '<html lang="es" translate="no">',
  );
  if (!esHtml.includes('lang="es"')) {
    throw new Error(
      '[seo_prerender] failed to set es lang attribute — did the <html> tag change?',
    );
  }
  esHtml = replaceRegion(esHtml, 'SEO:HEAD', renderHead('es'));
  esHtml = replaceRegion(esHtml, 'SEO:CONTENT', renderContent('es'));
  mkdirSync(path.join(distDir, 'es'), { recursive: true });
  writeFileSync(path.join(distDir, 'es', 'index.html'), esHtml);

  const lastmod = resolveLastmod(repoRoot);
  writeFileSync(path.join(distDir, 'sitemap.xml'), renderSitemap(lastmod));

  console.log(
    `[seo_prerender] wrote dist/index.html (en), dist/zh-Hant/index.html (zh-Hant), dist/zh/index.html (legacy), dist/ja/index.html (ja), dist/fr/index.html (fr), dist/de/index.html (de), dist/es/index.html (es), dist/sitemap.xml (lastmod ${lastmod})`,
  );
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) {
  main();
}
