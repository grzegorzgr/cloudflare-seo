#!/usr/bin/env node
// =============================================================================
// FETCH-OSM: warstwa sieciowa pipeline'u danych (Overpass API -> cache na dysku).
// =============================================================================
// Jedyny skrypt w projekcie, ktory rozmawia z siecia. Wszystko dalej
// (geo-engine.mjs) jest czysta, deterministyczna funkcja: cache -> dataset.
//
// Dla kazdego wojewodztwa z miastami-hubami wykonuje 2 zapytania:
//   1) POI:    natural=beach / leisure=beach_resort / amenity=parking z nazwa
//              w promieniu --radius km od hubow + parkingi w promieniu 1,5 km
//              od plaz (takze plaz z recznie utrzymywanego zbioru beaches.json).
//              `out center tags meta` -> mamy timestamp/version edycji OSM.
//   2) ROUTES: relation[route=bicycle|hiking|mtb|foot] z nazwa, w promieniu
//              --route-radius km od hubow. `out geom` -> pelna geometria
//              (potrzebna do wyliczenia dlugosci, mapy, relacji przestrzennych).
//
// Cache: scripts/build/cache/osm/{region}.pois.json / {region}.routes.json
//        { fetchedAt, osmBase, kind, region, query, elements }
// Cache-first: bez --refresh nie dotyka sieci. --only=pois|routes zaweza zakres.
// Grzecznosc wobec Overpass: 1 zapytanie na raz, --delay ms miedzy zapytaniami,
// backoff na 429/5xx/rate_limited.
//
// Uzycie:
//   node scripts/build/fetch-osm.mjs                # tylko brakujace pliki cache
//   node scripts/build/fetch-osm.mjs --refresh      # pobierz wszystko na nowo
//   node scripts/build/fetch-osm.mjs --only=routes --regions=pomorskie,opolskie
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, '../../packages/data');
const CACHE_DIR = resolve(HERE, 'cache/osm');
const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';

const POLISH_CHARS = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .split('')
    .map((c) => POLISH_CHARS[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function parseArgs(argv) {
  const o = {
    refresh: false,
    only: new Set(['pois', 'routes']),
    regions: null,
    radius: 10,
    routeRadius: 15,
    delay: 20000,
    endpoint: DEFAULT_ENDPOINT,
  };
  for (const a of argv) {
    if (a === '--refresh') o.refresh = true;
    else if (a.startsWith('--only=')) o.only = new Set(a.slice(7).split(','));
    else if (a.startsWith('--regions=')) o.regions = new Set(a.slice(10).split(','));
    else if (a.startsWith('--radius=')) o.radius = Number(a.slice(9));
    else if (a.startsWith('--route-radius=')) o.routeRadius = Number(a.slice(15));
    else if (a.startsWith('--delay=')) o.delay = Number(a.slice(8));
    else if (a.startsWith('--endpoint=')) o.endpoint = a.slice(11);
  }
  return o;
}

function loadSeeds() {
  return readJson(resolve(DATA_DIR, 'cities.json'))
    .filter((c) => c.type === 'city' && Number.isFinite(c.coordinates?.lat))
    .map((c) => ({
      name: c.location?.city ?? c.name,
      region: c.location?.region ?? null,
      slug: c.slug ?? slugify(c.location?.city ?? c.name),
      lat: c.coordinates.lat,
      lng: c.coordinates.lng,
    }));
}

function loadCuratedBeaches() {
  const p = resolve(DATA_DIR, 'beaches.json');
  if (!existsSync(p)) return [];
  return readJson(p)
    .filter((b) => !b.osmId && Number.isFinite(b.coordinates?.lat))
    .map((b) => ({ region: b.location?.region ?? null, lat: b.coordinates.lat, lng: b.coordinates.lng }));
}

// Relacja granic Polski w OSM: relation/49715 -> area id 3600049715.
// Filtr (area.pl) ogranicza wyniki do obiektow polozonych w Polsce (dla relacji:
// co najmniej czesciowo), co wyklucza np. czeskie parkingi przy hubach granicznych.
const AREA_PL = 'area(3600049715)->.pl;';

// Filtr obszaru stosujemy RAZ na zebranym zbiorze (node.x(area.pl)), a nie w kazdej
// instrukcji around — wielokrotne (area.pl) przy 7 hubach powodowalo timeouty 240 s.
function poiQuery(hubs, beaches, radiusKm) {
  const r = Math.round(radiusKm * 1000);
  const hubAround = hubs.map((h) => `(around:${r},${h.lat},${h.lng})`);
  const beachAround = beaches.map((b) => `(around:1500,${b.lat},${b.lng})`);
  const lines = [];
  lines.push(AREA_PL);
  lines.push('(');
  for (const a of hubAround) {
    lines.push(`  node["natural"="beach"]["name"]${a};`);
    lines.push(`  way["natural"="beach"]["name"]${a};`);
    lines.push(`  way["leisure"="beach_resort"]["name"]${a};`);
  }
  for (const a of beachAround) {
    lines.push(`  node["natural"="beach"]["name"]${a};`);
    lines.push(`  way["natural"="beach"]["name"]${a};`);
  }
  lines.push(')->.b0;');
  lines.push('( node.b0(area.pl); way.b0(area.pl); )->.beaches;');
  lines.push('(');
  for (const a of hubAround) {
    lines.push(`  node["amenity"="parking"]["name"]${a};`);
    lines.push(`  way["amenity"="parking"]["name"]${a};`);
  }
  // Parkingi przy plazach (use case "parking przy plazy"): wokol plaz z OSM
  // i wokol plaz z recznego zbioru (poza promieniem hubow).
  lines.push('  node["amenity"="parking"]["name"](around.beaches:1500);');
  lines.push('  way["amenity"="parking"]["name"](around.beaches:1500);');
  for (const a of beachAround) {
    lines.push(`  node["amenity"="parking"]["name"]${a};`);
    lines.push(`  way["amenity"="parking"]["name"]${a};`);
  }
  lines.push(')->.p0;');
  lines.push('( node.p0(area.pl); way.p0(area.pl); )->.pois;');
  lines.push('(.beaches; .pois;);');
  lines.push('out center tags meta;');
  return `[out:json][timeout:240];\n${lines.join('\n')}`;
}

function routeQuery(hubs, radiusKm) {
  const r = Math.round(radiusKm * 1000);
  const parts = hubs.map(
    (h) => `  relation["type"="route"]["route"~"^(bicycle|hiking|mtb|foot)$"]["name"](around:${r},${h.lat},${h.lng});`,
  );
  return `[out:json][timeout:300];\n${AREA_PL}\n(\n${parts.join('\n')}\n)->.r0;\nrelation.r0(area.pl);\nout geom meta;`;
}

/** Dzieli huby regionu na porcje (max `size`), zeby pojedyncze zapytanie bylo lekkie. */
function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function overpass(endpoint, query, { retries = 6, baseDelay = 15000, maxWait = 120000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    let text;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'gdziemy.pl data builder (contact@digital.gda.pl)',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(330000),
      });
      text = await res.text();
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = Math.min(baseDelay * 2 ** attempt, maxWait);
      process.stderr.write(`    blad sieci (${err.name}), retry za ${wait / 1000}s\n`);
      await sleep(wait);
      continue;
    }
    let json = null;
    if (text.trimStart().startsWith('{')) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    const remark = typeof json?.remark === 'string' ? json.remark : '';
    const busy =
      [429, 502, 503, 504].includes(res.status) ||
      /rate_limited|too many requests|timed out|Dispatcher_Client/i.test(remark) ||
      (json === null && /rate_limited|OSM3S Response|runtime error|Too Many Requests/i.test(text));
    if (res.ok && json && !busy) {
      return {
        elements: Array.isArray(json.elements) ? json.elements : [],
        osmBase: json.osm3s?.timestamp_osm_base ?? null,
      };
    }
    if (attempt < retries) {
      const ra = Number(res.headers.get('retry-after'));
      const wait =
        Number.isFinite(ra) && ra > 0
          ? Math.min(ra * 1000, maxWait)
          : Math.min(baseDelay * 2 ** attempt, maxWait);
      const why = busy ? 'rate-limit/przeciazenie' : `HTTP ${res.status}`;
      process.stderr.write(
        `    Overpass ${why}${remark ? ` (${remark.trim().slice(0, 80)})` : ''}, retry za ${Math.round(wait / 1000)}s\n`,
      );
      await sleep(wait);
      continue;
    }
    throw new Error(`Overpass: HTTP ${res.status} ${remark}`);
  }
  throw new Error('Overpass: wyczerpano proby');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const seeds = loadSeeds();
  const beaches = loadCuratedBeaches();
  const regions = readJson(resolve(DATA_DIR, 'regions.json'));
  mkdirSync(CACHE_DIR, { recursive: true });

  const byRegion = new Map();
  for (const s of seeds) {
    if (!byRegion.has(s.region)) byRegion.set(s.region, []);
    byRegion.get(s.region).push(s);
  }
  const order = regions
    .map((r) => r.region)
    .filter((r) => byRegion.has(r))
    .filter((r) => !opts.regions || opts.regions.has(slugify(r)));

  const jobs = [];
  for (const region of order) {
    const rslug = slugify(region);
    if (opts.only.has('pois')) {
      jobs.push({ region, rslug, kind: 'pois', file: resolve(CACHE_DIR, `${rslug}.pois.json`) });
    }
    if (opts.only.has('routes')) {
      jobs.push({ region, rslug, kind: 'routes', file: resolve(CACHE_DIR, `${rslug}.routes.json`) });
    }
  }

  let touchedNetwork = false;
  for (const [i, job] of jobs.entries()) {
    if (!opts.refresh && existsSync(job.file)) {
      process.stderr.write(`[${i + 1}/${jobs.length}] ${job.region} ${job.kind}: cache OK\n`);
      continue;
    }
    const hubs = byRegion.get(job.region);
    const regionBeaches = beaches.filter((b) => b.region === job.region);
    // Porcje hubow (max 3 na zapytanie); plaze curated dolaczane do pierwszej porcji.
    const groups = chunk(hubs, 3);
    const t0 = Date.now();
    process.stderr.write(`[${i + 1}/${jobs.length}] ${job.region} ${job.kind}: pobieram (${hubs.length} hubow, ${groups.length} zapytan)...\n`);
    const seen = new Set();
    const elements = [];
    const queries = [];
    let osmBase = null;
    let failed = false;
    for (const [gi, group] of groups.entries()) {
      if (touchedNetwork && opts.delay > 0) await sleep(opts.delay);
      touchedNetwork = true;
      const query = job.kind === 'pois' ? poiQuery(group, gi === 0 ? regionBeaches : [], opts.radius) : routeQuery(group, opts.routeRadius);
      queries.push(query);
      try {
        const res = await overpass(opts.endpoint, query);
        osmBase = res.osmBase ?? osmBase;
        for (const el of res.elements) {
          const k = `${el.type}/${el.id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          elements.push(el);
        }
        process.stderr.write(`    porcja ${gi + 1}/${groups.length}: ${res.elements.length} elementow\n`);
      } catch (err) {
        process.stderr.write(`    BLAD porcji ${gi + 1}: ${err.message}\n`);
        failed = true;
      }
    }
    if (failed) {
      process.stderr.write(`    region niekompletny — cache NIE zapisany\n`);
      process.exitCode = 2;
      continue;
    }
    const payload = { fetchedAt: new Date().toISOString(), osmBase, kind: job.kind, region: job.region, query: queries.join('\n\n'), elements };
    writeFileSync(job.file, JSON.stringify(payload) + '\n', 'utf8');
    process.stderr.write(`    OK ${elements.length} elementow, ${Math.round((Date.now() - t0) / 1000)}s\n`);
  }
  process.stderr.write('fetch-osm: koniec\n');
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
