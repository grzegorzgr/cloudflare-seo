#!/usr/bin/env node
// =============================================================================
// QUALITY ANALYZER — audyt wygenerowanego HTML (apps/web/dist)
// =============================================================================
// Bez zaleznosci: lekki parser HTML (regex/tokenizer) wystarczajacy dla naszego
// wlasnego, przewidywalnego markupu. Dla kazdej strony liczy:
//   - metryki SEO (title, description, canonical, robots, H1, breadcrumbs, JSON-LD)
//   - metryki tresci (liczba faktow, tabel, sekcji, unikalny tekst, mapa, provenance)
//   - graf linkow (inbound/outbound, linki zerwane, sieroty)
// Nastepnie punktuje strony (0-100) wg wag: dane 20 / wartosc 20 / intencja 20 /
// kontekst 10 / zaufanie 10 / odkrywalnosc 10 / UX 10, klasyfikuje klastry
// (INDEX / IMPROVE / NOINDEX / MERGE / REMOVE) i wykonuje twarde kontrole SEO.
//
// Wyjscie:
//   scripts/quality/reports/quality.json
//   docs/agent/QUALITY_SCORE.md
// Kod wyjscia != 0, gdy zawiodly kontrole krytyczne albo srednia < progu.
//
// Uzycie: node scripts/quality/analyze.mjs [--dist=apps/web/dist] [--min-score=90] [--sample=N]
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const DIST = resolve(ROOT, opt('dist', 'apps/web/dist'));
const MIN_SCORE = Number(opt('min-score', 90));
const REPORTS_DIR = resolve(HERE, 'reports');
const DOCS_DIR = resolve(ROOT, 'docs/agent');
const SITE = 'https://gdziemy.pl';

// --- HTML helpers -------------------------------------------------------------
const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
const stripTags = (html) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
const first = (re, html) => {
  const m = re.exec(html);
  return m ? decode(m[1].trim()) : null;
};
const all = (re, html) => {
  const out = [];
  let m;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = r.exec(html))) out.push(decode(m[1]));
  return out;
};
const attrOf = (tag, name) => {
  const m = new RegExp(`\\s${name}=["']([^"']*)["']`, 'i').exec(tag);
  return m ? decode(m[1]) : null;
};

function walk(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (f.endsWith('.html')) acc.push(p);
  }
  return acc;
}
function urlOf(file) {
  const rel = relative(DIST, file).split('\\').join('/');
  if (rel === 'index.html') return '/';
  if (rel === '404.html') return '/404.html';
  return '/' + rel.replace(/\/index\.html$/, '/');
}
function clusterOf(url) {
  if (url === '/') return 'home';
  if (url === '/404.html') return '404';
  if (/^\/(parking|trail|beach)\/[^/]+\/$/.test(url)) return url.split('/')[1];
  if (/^\/city\/[^/]+\/(parkingi|szlaki|plaze)\/$/.test(url)) return 'city-type';
  if (/^\/city\/[^/]+\/$/.test(url)) return 'city';
  if (/^\/region\/[^/]+\/$/.test(url)) return 'region';
  if (['/parking/', '/trails/', '/beaches/', '/cities/', '/regions/'].includes(url)) return 'index';
  return 'static';
}

// --- Parse one page -----------------------------------------------------------
function parsePage(file) {
  const html = readFileSync(file, 'utf8');
  const url = urlOf(file);
  const head = html.slice(0, html.indexOf('</head>') + 7);
  const body = html.slice(html.indexOf('<body'));
  const mainStart = body.indexOf('<main');
  const mainEnd = body.indexOf('</main>');
  const main = mainStart >= 0 && mainEnd > mainStart ? body.slice(mainStart, mainEnd) : body;
  const title = first(/<title>([^<]*)<\/title>/i, head);
  const metaTags = head.match(/<meta[^>]+>/gi) ?? [];
  const meta = (n) => {
    const t = metaTags.find((x) => new RegExp(`name=["']${n}["']`, 'i').test(x));
    return t ? attrOf(t, 'content') : null;
  };
  const linkTags = head.match(/<link[^>]+>/gi) ?? [];
  const canonTag = linkTags.find((x) => /rel=["']canonical["']/i.test(x));
  const canonical = canonTag ? attrOf(canonTag, 'href') : null;
  const robots = meta('robots') ?? '';
  const description = meta('description');
  const h1s = all(/<h1[^>]*>([\s\S]*?)<\/h1>/i, body).map((s) => stripTags(s));
  const h2s = all(/<h2[^>]*>([\s\S]*?)<\/h2>/i, body).map((s) => stripTags(s));
  const jsonLd = all(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i, head);
  let ldTypes = [];
  let ldValid = true;
  for (const j of jsonLd) {
    try {
      const o = JSON.parse(j);
      ldTypes.push(o['@type'] ?? '?');
    } catch {
      ldValid = false;
    }
  }
  const anchors = body.match(/<a\s[^>]*href=["'][^"']*["'][^>]*>/gi) ?? [];
  const internal = new Set();
  const external = new Set();
  for (const a of anchors) {
    const href = attrOf(a, 'href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    if (/^https?:\/\//.test(href)) {
      if (href.startsWith(SITE)) internal.add(href.slice(SITE.length));
      else external.add(href);
    } else internal.add(href.split('#')[0]);
  }
  const text = stripTags(main);
  const words = text.split(/\s+/).filter(Boolean);
  const factRows =
    (main.match(/<table class="facts">[\s\S]*?<\/table>/gi) ?? []).reduce((a, t) => a + (t.match(/<tr>/g)?.length ?? 0), 0) +
    (main.match(/<div class="stats">[\s\S]*?<\/div>\s*<\/div>/i)?.[0].match(/<div><span>/g)?.length ?? 0);
  const dataTables = main.match(/<table class="data">/gi)?.length ?? 0;
  const dataRows = (main.match(/<table class="data">[\s\S]*?<\/table>/gi) ?? []).reduce((a, t) => a + Math.max(0, (t.match(/<tr>/g)?.length ?? 0) - 1), 0);
  const linkSections = main.match(/<ul class="links">/gi)?.length ?? 0;
  const hasMap = /class="map"/.test(main);
  const mapTiles = main.match(/tile\.openstreetmap\.org/g)?.length ?? 0;
  const hasPath = /<path d="M/.test(main);
  const hasProvenance = /class="prov"/.test(main);
  const hasOsmLink = /openstreetmap\.org\/(node|way|relation)\//.test(main);
  const hasLastEdit = /Ostatnia edycja w OSM/.test(main);
  const hasBreadcrumbs = /class="crumbs/.test(body);
  const hasNav = /Główna nawigacja/.test(body);
  const notices = main.match(/class="notice"/g)?.length ?? 0;
  const images = body.match(/<img\s[^>]*>/gi) ?? [];
  const imgNoAlt = images.filter((i) => !/\salt=/.test(i)).length;
  const imgNoLazy = images.filter((i) => !/loading=["']lazy["']/.test(i)).length;
  const scripts = (head + body).match(/<script\s[^>]*src=/gi)?.length ?? 0;
  const inlineScripts = (body.match(/<script(?![^>]*type="application\/ld\+json")[^>]*>/gi) ?? []).length;
  const summary = all(/<p class="summary">([\s\S]*?)<\/p>/i, main).map(stripTags).join(' ');

  return {
    url, file: relative(ROOT, file), cluster: clusterOf(url), bytes: Buffer.byteLength(html),
    title, titleLen: title?.length ?? 0, description, descLen: description?.length ?? 0, canonical, robots,
    noindex: /noindex/i.test(robots), h1s, h2Count: h2s.length, h2s, ldTypes, ldValid, ldCount: jsonLd.length,
    internal: [...internal], externalCount: external.size, words: words.length, factRows, dataTables, dataRows,
    linkSections, hasMap, mapTiles, hasPath, hasProvenance, hasOsmLink, hasLastEdit, hasBreadcrumbs, hasNav,
    notices, imgCount: images.length, imgNoAlt, imgNoLazy, scripts, inlineScripts, summary, text,
  };
}

// --- Scoring -------------------------------------------------------------------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function scorePage(p, ctx) {
  const isEntity = ['parking', 'trail', 'beach'].includes(p.cluster);
  const isHub = ['city', 'city-type', 'region', 'index', 'home'].includes(p.cluster);
  // Data value (20): fakty / wiersze tabel / sekcje.
  const dataUnits = p.factRows + p.dataRows * 1.5 + p.linkSections * 1.5;
  const data = isEntity ? clamp((dataUnits / 14) * 20, 0, 20) : isHub ? clamp((dataUnits / 20) * 20, 0, 20) : clamp((p.words / 350) * 20, 0, 20);
  // Original / useful value (20): tabele porownawcze, mapa, geometria, unikalnosc tekstu (title+summary).
  const uniq = ctx.summaryDupes.get(p.summary) > 1 && p.summary ? 0.5 : 1;
  let original = 0;
  if (isEntity) original = clamp((p.dataTables ? 7 : 0) + (p.hasMap ? 5 : 0) + (p.hasPath ? 3 : 0) + (p.linkSections ? 3 : 0) + (p.notices ? 1 : 0) + 1, 0, 20) * uniq;
  else if (isHub) original = clamp((p.dataTables ? 8 : 0) + Math.min(p.dataRows, 20) * 0.3 + (p.hasMap ? 3 : 0) + Math.min(p.linkSections, 4) * 1.5, 0, 20);
  else original = clamp((p.words / 250) * 20, 0, 20);
  // Intent (20): tytul + opis + H1 + slowa kluczowe typu w tytule.
  const t = (p.title ?? '').toLowerCase();
  const intentWord = p.cluster === 'parking' ? /parking/ : p.cluster === 'trail' ? /szlak|trasa/ : p.cluster === 'beach' ? /plaż|kąpielisko/ : /./;
  const intent = clamp((p.h1s.length === 1 ? 5 : 0) + (p.titleLen >= 20 && p.titleLen <= 70 ? 5 : p.title ? 2 : 0) + (p.descLen >= 70 && p.descLen <= 300 ? 5 : p.description ? 2 : 0) + (intentWord.test(t) ? 5 : 0), 0, 20);
  // Context (10): sekcje relacji, notices, h2.
  const context = clamp(Math.min(p.linkSections, 3) * 2 + Math.min(p.h2Count, 4) + (p.dataTables ? 1 : 0), 0, 10);
  // Trust (10): provenance, OSM link, last edit, external source links.
  const trust = isEntity
    ? clamp((p.hasProvenance ? 4 : 0) + (p.hasOsmLink ? 3 : 0) + (p.hasLastEdit ? 3 : 0), 0, 10)
    : clamp((p.text.includes('OpenStreetMap') ? 5 : 0) + (p.internal.includes('/metodologia/') ? 3 : 0) + (p.ldValid && p.ldCount ? 2 : 0), 0, 10);
  // Discovery (10): breadcrumbs, inbound links, outbound internal links.
  const inbound = ctx.inbound.get(p.url) ?? 0;
  const discovery = clamp((p.hasBreadcrumbs ? 3 : 0) + Math.min(inbound, 5) + (p.internal.length >= 8 ? 2 : p.internal.length >= 3 ? 1 : 0), 0, 10);
  // UX (10): nav, no heavy scripts, images lazy+alt, size.
  const ux = clamp((p.hasNav ? 3 : 0) + (p.scripts <= 1 ? 2 : 0) + (p.imgNoAlt === 0 ? 2 : 0) + (p.bytes < 150000 ? 2 : p.bytes < 400000 ? 1 : 0) + (p.inlineScripts === 0 ? 1 : 0), 0, 10);
  const total = Math.round(data + original + intent + context + trust + discovery + ux);
  return { data: +data.toFixed(1), original: +original.toFixed(1), intent, context, trust, discovery, ux, total };
}

function classify(p, s) {
  if (p.cluster === '404') return 'NOINDEX';
  if (p.noindex) return 'NOINDEX';
  if (s.total >= 75) return 'INDEX';
  if (s.total >= 55) return 'IMPROVE';
  return 'REMOVE';
}

// --- Main -----------------------------------------------------------------------
function main() {
  if (!existsSync(DIST)) {
    console.error(`Brak katalogu ${DIST} — uruchom najpierw build.`);
    process.exit(2);
  }
  const files = walk(DIST);
  const pages = files.map(parsePage);
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const sitemapXml = existsSync(join(DIST, 'sitemap.xml')) ? readFileSync(join(DIST, 'sitemap.xml'), 'utf8') : '';
  const sitemapUrls = new Set(all(/<loc>([^<]+)<\/loc>/g, sitemapXml).map((u) => u.replace(SITE, '')));
  const robotsTxt = existsSync(join(DIST, 'robots.txt')) ? readFileSync(join(DIST, 'robots.txt'), 'utf8') : '';

  // Link graph.
  const inbound = new Map();
  const broken = [];
  const staticFiles = new Set(readdirSync(DIST));
  for (const p of pages) {
    for (const href of p.internal) {
      const target = href.endsWith('/') || href === '/' ? href : href;
      if (byUrl.has(target)) inbound.set(target, (inbound.get(target) ?? 0) + 1);
      else if (!staticFiles.has(target.replace(/^\//, '')) && !/\.(xml|txt|png|svg|ico)$/.test(target)) broken.push({ from: p.url, href });
    }
  }
  const summaryDupes = new Map();
  for (const p of pages) if (p.summary) summaryDupes.set(p.summary, (summaryDupes.get(p.summary) ?? 0) + 1);
  const ctx = { inbound, summaryDupes };

  const scored = pages.map((p) => {
    const s = scorePage(p, ctx);
    return { ...p, score: s, verdict: classify(p, s), inbound: inbound.get(p.url) ?? 0, text: undefined };
  });

  // --- Hard SEO checks (critical) ---
  const critical = [];
  const warnings = [];
  const titles = new Map();
  for (const p of scored) {
    if (p.cluster === '404') continue;
    if (!p.title) critical.push(`${p.url}: brak <title>`);
    if (p.h1s.length !== 1) critical.push(`${p.url}: liczba H1 = ${p.h1s.length}`);
    if (!p.canonical) critical.push(`${p.url}: brak canonical`);
    else if (p.canonical !== `${SITE}${p.url}`) critical.push(`${p.url}: canonical ${p.canonical} != URL`);
    if (!p.description) critical.push(`${p.url}: brak meta description`);
    if (!p.ldValid) critical.push(`${p.url}: niepoprawny JSON-LD`);
    if (p.noindex && sitemapUrls.has(p.url)) critical.push(`${p.url}: noindex, a jest w sitemap`);
    if (!p.noindex && !sitemapUrls.has(p.url)) critical.push(`${p.url}: indeksowalna, a brak w sitemap`);
    if (!p.noindex && p.inbound === 0 && p.url !== '/') critical.push(`${p.url}: sierota (0 linkow wchodzacych)`);
    if (p.titleLen > 75) warnings.push(`${p.url}: title ${p.titleLen} znakow`);
    if (p.descLen > 320) warnings.push(`${p.url}: description ${p.descLen} znakow`);
    if (p.imgNoAlt) warnings.push(`${p.url}: ${p.imgNoAlt} obrazow bez alt`);
    if (!p.noindex) titles.set(p.title, (titles.get(p.title) ?? 0) + 1);
    if (!p.hasBreadcrumbs && !['home', '404'].includes(p.cluster)) warnings.push(`${p.url}: brak breadcrumbs`);
  }
  for (const [t, n] of titles) if (n > 1) critical.push(`Duplikat title (${n}x): ${t}`);
  for (const b of broken.slice(0, 50)) critical.push(`Zerwany link ${b.from} -> ${b.href}`);
  if (broken.length > 50) critical.push(`...i ${broken.length - 50} kolejnych zerwanych linkow`);
  for (const u of sitemapUrls) if (!byUrl.has(u)) critical.push(`Sitemap wskazuje nieistniejaca strone ${u}`);
  if (!/Sitemap:\s*https:\/\/gdziemy\.pl\/sitemap\.xml/.test(robotsTxt)) critical.push('robots.txt bez wpisu Sitemap');

  // --- Aggregates ---
  const indexable = scored.filter((p) => !p.noindex && p.cluster !== '404');
  const avg = (arr) => (arr.length ? arr.reduce((a, p) => a + p.score.total, 0) / arr.length : 0);
  const clusters = {};
  for (const p of scored) {
    const c = (clusters[p.cluster] ??= { pages: 0, indexable: 0, noindex: 0, avgIndexable: 0, avgAll: 0, verdicts: {}, sum: 0, sumIdx: 0, min: 100, worst: null });
    c.pages++;
    c.sum += p.score.total;
    if (p.noindex) c.noindex++;
    else {
      c.indexable++;
      c.sumIdx += p.score.total;
      if (p.score.total < c.min) {
        c.min = p.score.total;
        c.worst = p.url;
      }
    }
    c.verdicts[p.verdict] = (c.verdicts[p.verdict] ?? 0) + 1;
  }
  for (const c of Object.values(clusters)) {
    c.avgAll = +(c.sum / c.pages).toFixed(1);
    c.avgIndexable = c.indexable ? +(c.sumIdx / c.indexable).toFixed(1) : null;
    delete c.sum;
    delete c.sumIdx;
  }
  const overall = +avg(indexable).toFixed(1);
  const dims = ['data', 'original', 'intent', 'context', 'trust', 'discovery', 'ux'];
  const dimAvg = Object.fromEntries(dims.map((d) => [d, +(indexable.reduce((a, p) => a + p.score[d], 0) / Math.max(1, indexable.length)).toFixed(1)]));

  const report = {
    generatedAt: new Date().toISOString(),
    dist: relative(ROOT, DIST),
    pages: scored.length,
    indexable: indexable.length,
    noindex: scored.length - indexable.length,
    sitemapUrls: sitemapUrls.size,
    overallScore: overall,
    minScore: MIN_SCORE,
    dimensionAverages: dimAvg,
    clusters,
    critical,
    warnings: warnings.slice(0, 200),
    brokenLinks: broken.length,
    lowest: [...indexable].sort((a, b) => a.score.total - b.score.total).slice(0, 25).map((p) => ({ url: p.url, score: p.score.total, verdict: p.verdict, inbound: p.inbound, factRows: p.factRows, dataRows: p.dataRows })),
    pagesSample: scored.slice(0, 0),
  };
  const pass = critical.length === 0 && overall >= MIN_SCORE;
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(resolve(REPORTS_DIR, 'quality.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(resolve(REPORTS_DIR, 'pages.json'), JSON.stringify(scored.map(({ internal, h2s, summary, ...rest }) => rest), null, 0) + '\n', 'utf8');

  // --- Markdown ---
  const md = [];
  md.push('# QUALITY_SCORE', '', `Wygenerowano: ${report.generatedAt} (build: \`${report.dist}\`)`, '');
  md.push(`**Wynik ogólny (strony indeksowalne): ${overall} / 100** — próg ${MIN_SCORE}. Kontrole krytyczne: ${critical.length === 0 ? '0 (PASS)' : `${critical.length} (FAIL)`}.`, '');
  md.push('| Wymiar | Waga | Średnia |', '| --- | --- | --- |');
  const weights = { data: 20, original: 20, intent: 20, context: 10, trust: 10, discovery: 10, ux: 10 };
  const names = { data: 'Wartość danych', original: 'Wartość oryginalna/użytkowa', intent: 'Intencja użytkownika', context: 'Kontekst', trust: 'Zaufanie / provenance', discovery: 'Odkrywalność / linkowanie', ux: 'UX' };
  for (const d of dims) md.push(`| ${names[d]} | ${weights[d]} | ${dimAvg[d]} |`);
  md.push('', `Strony: ${scored.length} (indeksowalne ${indexable.length}, noindex ${scored.length - indexable.length}); URL w sitemap: ${sitemapUrls.size}; zerwane linki: ${broken.length}.`, '');
  md.push('## Klastry', '', '| Klaster | Stron | Indeksowalne | Noindex | Śr. (indeks.) | Min | Najsłabsza | Werdykty |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, c] of Object.entries(clusters).sort()) {
    md.push(`| ${name} | ${c.pages} | ${c.indexable} | ${c.noindex} | ${c.avgIndexable ?? '—'} | ${c.indexable ? c.min : '—'} | ${c.worst ? `\`${c.worst}\`` : '—'} | ${Object.entries(c.verdicts).map(([k, v]) => `${k}: ${v}`).join(', ')} |`);
  }
  md.push('', '## Kontrole krytyczne', '');
  if (!critical.length) md.push('Brak.');
  else for (const c of critical.slice(0, 80)) md.push(`- ${c}`);
  if (critical.length > 80) md.push(`- …i ${critical.length - 80} kolejnych`);
  md.push('', '## Ostrzeżenia (pierwsze 40)', '');
  if (!warnings.length) md.push('Brak.');
  else for (const w of warnings.slice(0, 40)) md.push(`- ${w}`);
  md.push('', '## 25 najsłabszych stron indeksowalnych', '', '| URL | Wynik | Werdykt | Linki wchodzące | Fakty | Wiersze tabel |', '| --- | --- | --- | --- | --- | --- |');
  for (const p of report.lowest) md.push(`| \`${p.url}\` | ${p.score} | ${p.verdict} | ${p.inbound} | ${p.factRows} | ${p.dataRows} |`);
  md.push('', '## Metoda', '', 'Punktacja liczona z wygenerowanego HTML: fakty (wiersze tabeli faktów), tabele danych, sekcje relacji, mapa i geometria, unikalność podsumowania, poprawność title/description/H1, breadcrumbs, linki wchodzące (graf całej witryny), provenance (link OSM, data edycji), brak skryptów poza AdSense, atrybuty alt/lazy. Klasyfikacja: INDEX ≥ 75, IMPROVE 55–74, REMOVE < 55; strony z `noindex` = NOINDEX. Kontrole krytyczne: brak title/H1/canonical/description, canonical ≠ URL, niepoprawny JSON-LD, niespójność noindex↔sitemap, sieroty, duplikaty title, zerwane linki, sitemap → 404, robots bez sitemapy.', '');
  mkdirSync(DOCS_DIR, { recursive: true });
  writeFileSync(resolve(DOCS_DIR, 'QUALITY_SCORE.md'), md.join('\n'), 'utf8');

  console.log(`QUALITY: ${overall}/100 (prog ${MIN_SCORE}), strony ${scored.length}, indeksowalne ${indexable.length}, krytyczne ${critical.length}, zerwane linki ${broken.length} -> ${pass ? 'PASS' : 'FAIL'}`);
  for (const [name, c] of Object.entries(clusters).sort()) console.log(`  ${name.padEnd(10)} n=${String(c.pages).padStart(5)} idx=${String(c.indexable).padStart(5)} avg=${c.avgIndexable ?? '—'} min=${c.indexable ? c.min : '—'}`);
  if (critical.length) for (const c of critical.slice(0, 15)) console.log('  CRITICAL:', c);
  process.exit(pass ? 0 : 1);
}

main();
