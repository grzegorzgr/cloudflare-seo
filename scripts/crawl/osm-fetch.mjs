#!/usr/bin/env node
// Warstwa SCRIPTS: HYBRYDOWY silnik pozyskiwania danych GEO GRAPH.
//
// PIPELINE (etap 2 - OSM Import + Normalization + Graph Linking):
//   City Seed Layer (packages/data/cities.json)
//       -> Overpass query "around" kazdego miasta-huba
//       -> Normalizacja (schemat /packages/data, ZERO inference)
//       -> Przypisanie belongs_to_city / belongs_to_region (najblizszy seed)
//       -> candidates.json (wejscie dla scripts/crawl/graph-update.mjs --write)
//
// ZASADA BEZWZGLEDNA: ZERO halucynacji.
//   - kazde pole wynika WYLACZNIE z jawnych tagow OSM,
//   - belongs_to_* to obliczenie geometryczne na wspolrzednych (nie zgadywanie),
//   - brak nazwy / brak dopasowania typu = element pominiety.
//
// Uzycie:
//   node scripts/crawl/osm-fetch.mjs [opcje]
//     --radius=8            promien zapytania "around" w km (domyslnie 8)
//     --link-radius=25      maks. promien przypisania POI do huba (domyslnie 25)
//     --only=beach,parking  ogranicz typy (beach|parking|trail|attraction)
//     --out=<plik>          plik wyjsciowy (domyslnie reports/osm-candidates.json)
//     --offline=<plik>      uzyj lokalnego eksportu Overpass zamiast sieci (determinizm/testy)
//     --endpoint=<url>      alternatywny endpoint Overpass API
//     --delay=1200          odstep miedzy zapytaniami miast w ms (grzecznosc API)
//
// Wynik zawsze deterministyczny: encje sortowane wg osmId.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, '../../packages/data');
const REPORTS_DIR = resolve(HERE, 'reports');

const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const EARTH_RADIUS_KM = 6371;

// --- Deterministyczny slug (kopia packages/generator/src/slug.ts) ---
const POLISH_CHARS = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n',
  ó: 'o', ś: 's', ź: 'z', ż: 'z',
};
function slugify(input) {
  return String(input)
    .toLowerCase()
    .split('')
    .map((c) => POLISH_CHARS[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// --- Geo haversine (kopia packages/generator/src/geo.ts) ---
function hasCoords(c) {
  return !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng);
}
function distanceKm(a, b) {
  if (!hasCoords(a) || !hasCoords(b)) return null;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h =
    sLat * sLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sLng * sLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// --- Mapowanie tagow OSM -> typ wewnetrzny (tylko jawne dopasowania) ---
function resolveType(tags) {
  if (tags.natural === 'beach') return 'beach';
  if (tags.amenity === 'parking') return 'parking';
  if (['path', 'cycleway', 'footway'].includes(tags.highway)) return 'trail';
  if (tags.tourism === 'attraction') return 'attraction';
  return null;
}
function osmBool(value) {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}
// Jak osmBool, ale zachowuje realne, nie-boolowskie wartosci OSM jako opis.
function osmFlag(value) {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  const MAP = {
    leashed: 'tylko na smyczy',
    limited: 'ograniczona',
    permissive: 'dozwolone',
    designated: 'wyznaczone',
    customers: 'dla klientow',
    private: 'prywatne',
  };
  return MAP[value] ?? null;
}
function resolveCoordinates(element) {
  if (typeof element.lat === 'number' && typeof element.lon === 'number') {
    return { lat: element.lat, lng: element.lon };
  }
  if (element.center &&
      typeof element.center.lat === 'number' &&
      typeof element.center.lon === 'number') {
    return { lat: element.center.lat, lng: element.center.lon };
  }
  return { lat: null, lng: null };
}
function resolveAmenities(tags) {
  return {
    parking: tags.amenity === 'parking' ? true : null,
    toilets: osmBool(tags.toilets),
    dog_friendly: osmFlag(tags.dog),
    accessibility: osmFlag(tags.wheelchair),
    paid_entry: osmBool(tags.fee),
    lifeguards: osmBool(tags.supervised),
    covered: osmBool(tags.covered),
    guarded: osmBool(tags.supervised),
  };
}
function resolveFeatures(tags) {
  const features = [];
  if (tags.surface) features.push(`nawierzchnia: ${tags.surface}`);
  if (tags.length) features.push(`długość: ${tags.length}`);
  if (tags.distance) features.push(`dystans: ${tags.distance}`);
  if (tags.operator) features.push(`operator: ${tags.operator}`);
  if (tags.capacity) features.push(`pojemność: ${tags.capacity}`);
  if (tags.ref) features.push(`oznakowanie: ${tags.ref}`);
  return features;
}
// Adres strukturalny WYLACZNIE z jawnych tagow addr:* (zero inference).
function resolveAddress(tags) {
  const street = tags['addr:street'] ?? null;
  const housenumber = tags['addr:housenumber'] ?? null;
  const postcode = tags['addr:postcode'] ?? null;
  const city = tags['addr:city'] ?? null;
  if (!street && !housenumber && !postcode && !city) return null;
  return { street, housenumber, postcode, city };
}

function mapElement(element) {
  const tags = element.tags ?? {};
  const type = resolveType(tags);
  if (!type) return null;
  const name = tags.name;
  if (!name) return null; // 1 encja = 1 strona, bez fikcji

  const osmId = `${element.type}/${element.id}`;
  const slug = `${slugify(name)}-${element.id}`;
  const coordinates = resolveCoordinates(element);

  return {
    id: slug,
    slug,
    type,
    osmId,
    name,
    // Wstepnie tylko jawny addr:*; belongs_to_* dolozy linkCity().
    location: {
      city: tags['addr:city'] ?? null,
      region: tags['addr:region'] ?? tags['addr:state'] ?? null,
      country: tags['addr:country'] ?? null,
    },
    address: resolveAddress(tags),
    description: null,
    coordinates,
    features: resolveFeatures(tags),
    amenities: resolveAmenities(tags),
    tags: ['osm'],
    access: null,
    seo: null,
  };
}

// --- Graph linking: przypisz POI do najblizszego miasta-huba ---
// belongs_to_city / belongs_to_region = obliczenie geometryczne (nie inference).
function linkCity(entity, seeds, maxKm) {
  // 1. Jawny addr:city zgodny z seedem ma pierwszenstwo.
  const declared = entity.location?.city;
  if (declared) {
    const dslug = slugify(declared);
    const match = seeds.find((s) => s.slug === dslug);
    if (match) {
      return { city: match.name, region: match.region };
    }
  }
  // 2. Bez wspolrzednych nie da sie policzyc -> null.
  if (!hasCoords(entity.coordinates)) {
    return { city: null, region: null };
  }
  // 3. Najblizszy seed w promieniu maxKm (tie-break: slug).
  let best = null;
  for (const s of seeds) {
    const d = distanceKm(entity.coordinates, s.coordinates);
    if (d === null || d > maxKm) continue;
    if (best === null || d < best.d || (d === best.d && s.slug < best.s.slug)) {
      best = { s, d };
    }
  }
  if (best === null) return { city: null, region: null };
  return { city: best.s.name, region: best.s.region };
}

// --- Overpass ---
function buildQuery(seed, radiusKm, only) {
  const r = Math.round(radiusKm * 1000); // metry
  const { lat, lng } = seed.coordinates;
  const around = `(around:${r},${lat},${lng})`;
  const parts = [];
  if (only.has('beach')) {
    parts.push(`node["natural"="beach"]${around};`);
    parts.push(`way["natural"="beach"]${around};`);
  }
  if (only.has('parking')) {
    parts.push(`node["amenity"="parking"]${around};`);
    parts.push(`way["amenity"="parking"]${around};`);
  }
  if (only.has('trail')) {
    parts.push(`way["highway"~"^(path|footway|cycleway)$"]${around};`);
  }
  if (only.has('attraction')) {
    parts.push(`node["tourism"="attraction"]${around};`);
    parts.push(`way["tourism"="attraction"]${around};`);
  }
  return `[out:json][timeout:90];(\n  ${parts.join('\n  ')}\n);out center tags;`;
}

async function fetchOverpass(endpoint, query) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'cloudflare-seo-geo-graph/1.0 (deterministic SSG dataset builder)',
    },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return Array.isArray(json?.elements) ? json.elements : [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- CLI ---
function parseArgs(argv) {
  const opts = {
    radius: 8,
    linkRadius: 25,
    only: new Set(['beach', 'parking', 'trail', 'attraction']),
    out: resolve(REPORTS_DIR, 'osm-candidates.json'),
    offline: null,
    endpoint: DEFAULT_ENDPOINT,
    delay: 1200,
  };
  for (const arg of argv) {
    if (arg.startsWith('--radius=')) opts.radius = Number(arg.slice(9));
    else if (arg.startsWith('--link-radius=')) opts.linkRadius = Number(arg.slice(14));
    else if (arg.startsWith('--only=')) {
      opts.only = new Set(arg.slice(7).split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--out=')) opts.out = resolve(process.cwd(), arg.slice(6));
    else if (arg.startsWith('--offline=')) opts.offline = resolve(process.cwd(), arg.slice(10));
    else if (arg.startsWith('--endpoint=')) opts.endpoint = arg.slice(11);
    else if (arg.startsWith('--delay=')) opts.delay = Number(arg.slice(8));
  }
  return opts;
}

function loadSeeds() {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, 'cities.json'), 'utf8'));
  return raw
    .filter((c) => c.type === 'city' && hasCoords(c.coordinates))
    .map((c) => ({
      name: c.location?.city ?? c.name,
      region: c.location?.region ?? null,
      slug: c.slug ?? slugify(c.location?.city ?? c.name),
      coordinates: { lat: c.coordinates.lat, lng: c.coordinates.lng },
    }));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const seeds = loadSeeds();
  if (seeds.length === 0) {
    process.stderr.write('Brak miast-seed z wspolrzednymi w cities.json.\n');
    process.exit(1);
  }

  process.stderr.write(
    `GEO GRAPH fetch: ${seeds.length} miast, promien ${opts.radius} km, typy [${[...opts.only].join(', ')}]\n`,
  );

  // Zbierz surowe elementy OSM (online per miasto lub offline z pliku).
  const rawElements = [];
  if (opts.offline) {
    const raw = JSON.parse(readFileSync(opts.offline, 'utf8'));
    const els = Array.isArray(raw) ? raw : raw.elements ?? [];
    // NIE push(...els) - spread duzej tablicy przepelnia stos wywolan.
    for (const el of els) rawElements.push(el);
    process.stderr.write(`Tryb offline: ${els.length} elementow z ${opts.offline}\n`);
  } else {
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const query = buildQuery(seed, opts.radius, opts.only);
      try {
        const els = await fetchOverpass(opts.endpoint, query);
        for (const el of els) rawElements.push(el);
        process.stderr.write(`  [${i + 1}/${seeds.length}] ${seed.name}: ${els.length} elementow\n`);
      } catch (err) {
        process.stderr.write(`  [${i + 1}/${seeds.length}] ${seed.name}: BLAD ${err.message}\n`);
      }
      if (i < seeds.length - 1) await sleep(opts.delay);
    }
  }

  // Dedup surowych elementow po type/id (ten sam POI moze trafic z 2 miast).
  const seen = new Set();
  const uniqueElements = [];
  for (const el of rawElements) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueElements.push(el);
  }

  // Normalizacja + graph linking (belongs_to_city / belongs_to_region).
  let linked = 0;
  const entities = uniqueElements
    .map(mapElement)
    .filter((e) => e !== null)
    .map((e) => {
      const link = linkCity(e, seeds, opts.linkRadius);
      if (link.city) {
        e.location.city = link.city;
        e.location.region = link.region;
        linked++;
      }
      return e;
    })
    // Deterministyczna kolejnosc wg osmId.
    .sort((a, b) => (a.osmId < b.osmId ? -1 : a.osmId > b.osmId ? 1 : 0));

  const byType = entities.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1;
    return acc;
  }, {});

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, JSON.stringify(entities, null, 2) + '\n', 'utf8');

  const report = {
    generatedAt: new Date().toISOString(),
    mode: opts.offline ? 'offline' : 'overpass',
    seeds: seeds.length,
    radiusKm: opts.radius,
    linkRadiusKm: opts.linkRadius,
    types: [...opts.only],
    rawElements: rawElements.length,
    uniqueElements: uniqueElements.length,
    entities: entities.length,
    linkedToCity: linked,
    byType,
    output: opts.out,
  };
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORTS_DIR, 'osm-fetch-report.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8',
  );

  process.stderr.write(
    `Zapisano ${entities.length} encji -> ${opts.out}\n` +
    `Podsumowanie wg typu: ${JSON.stringify(byType)} | linked: ${linked}/${entities.length}\n` +
    `Nastepny krok: node scripts/crawl/graph-update.mjs ${opts.out} --write\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
