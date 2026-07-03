#!/usr/bin/env node
// =============================================================================
// BUILD-TIME GEO DATA ENGINE  (Programmatic SEO / Poland)
// =============================================================================
// Warstwa: SCRIPTS (orkiestrator build-time). Uruchamiany w CI / przed `astro build`.
//
// DATA FLOW:
//   City Seed DB (packages/data/cities.json)
//     -> OSM fetch (Overpass, batch per WOJEWODZTWO, cache na dysku)
//     -> Normalize (schemat /packages/data, ZERO inference)
//     -> Deduplicate (osmId / wspolrzedne <50m / nazwa+miasto)
//     -> Graph Expansion (belongs_to_city/region + nearby adjacency)
//     -> /packages/data (beaches/parkings/trails)
//     -> Reports (stats, coverage-map, graph-density, dedup)
//
// ZASADA BEZWZGLEDNA: ZERO halucynacji.
//   - kazde pole encji wynika WYLACZNIE z jawnych tagow OSM,
//   - belongs_to_* i nearby to obliczenia geometryczne (nie zgadywanie),
//   - brak nazwy / brak typu = element pominiety.
//
// PERFORMANCE / RATE-LIMIT:
//   - 1 zapytanie Overpass na wojewodztwo (max 16 requestow), nie na miasto,
//   - odpowiedzi cache'owane w scripts/build/cache/osm/{region}.json,
//   - kolejne buildy = 0 ruchu sieciowego (deterministyczny build).
//
// Uzycie:
//   node scripts/build/geo-engine.mjs               # dry-run (raporty, bez zapisu danych)
//   node scripts/build/geo-engine.mjs --write       # pelny build + zapis /packages/data
//   node scripts/build/geo-engine.mjs --refresh      # ignoruj cache, pobierz na nowo
//   node scripts/build/geo-engine.mjs --no-fetch     # tylko cache/istniejace dane (offline CI)
//   node scripts/build/geo-engine.mjs --offline=<f>  # fixture Overpass zamiast sieci
//   node scripts/build/geo-engine.mjs --radius=10 --link-radius=25 --nearby=5
//   node scripts/build/geo-engine.mjs --only=beach,parking,trail
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, '../../packages/data');
const CACHE_DIR = resolve(HERE, 'cache/osm');
const REPORTS_DIR = resolve(HERE, 'reports');

const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const EARTH_RADIUS_KM = 6371;
const SAME_COORD_KM = 0.05;
const MAX_EDGES_PER_NODE = 8;

// Typ encji -> plik danych. Tylko routowalne typy sa zapisywane.
const TYPE_FILES = { beach: 'beaches', parking: 'parkings', trail: 'trails' };

// -----------------------------------------------------------------------------
// Deterministyczne helpery (kopie packages/generator/src/{slug,geo}.ts)
// -----------------------------------------------------------------------------
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
    .replace(/^-+|-+$/g, '');
}
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
function round(v, d = 2) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
function pct(part, total) {
  return total === 0 ? 0 : round((part / total) * 100, 1);
}

// -----------------------------------------------------------------------------
// OSM tag mapping (ZERO inference; kopia scripts/crawl/osm-fetch.mjs)
// -----------------------------------------------------------------------------
function resolveType(tags) {
  if (tags.natural === 'beach' || tags.leisure === 'beach_resort') return 'beach';
  if (tags.amenity === 'parking') return 'parking';
  if (['path', 'cycleway', 'footway'].includes(tags.highway)) return 'trail';
  if (tags.tourism === 'attraction' || tags.natural === 'attraction') return 'attraction';
  return null;
}
function osmBool(v) {
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return null;
}
function resolveCoordinates(el) {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return { lat: null, lng: null };
}
function resolveAmenities(tags) {
  return {
    parking: tags.amenity === 'parking' ? true : null,
    toilets: osmBool(tags.toilets),
    dog_friendly: osmBool(tags.dog),
    accessibility: osmBool(tags.wheelchair),
    paid_entry: osmBool(tags.fee),
    lifeguards: osmBool(tags.supervised),
    covered: osmBool(tags.covered),
    guarded: osmBool(tags.supervised),
  };
}
function resolveFeatures(tags) {
  const f = [];
  if (tags.surface) f.push(`nawierzchnia: ${tags.surface}`);
  if (tags.length) f.push(`długość: ${tags.length}`);
  if (tags.distance) f.push(`dystans: ${tags.distance}`);
  if (tags.operator) f.push(`operator: ${tags.operator}`);
  if (tags.capacity) f.push(`pojemność: ${tags.capacity}`);
  if (tags.ref) f.push(`oznakowanie: ${tags.ref}`);
  return f;
}
function mapElement(el) {
  const tags = el.tags ?? {};
  const type = resolveType(tags);
  if (!type) return null;
  const name = tags.name;
  if (!name) return null; // 1 encja = 1 strona, bez fikcji
  const osmId = `${el.type}/${el.id}`;
  const slug = `${slugify(name)}-${el.id}`;
  return {
    id: slug,
    slug,
    type,
    osmId,
    name,
    location: {
      city: tags['addr:city'] ?? null,
      region: tags['addr:region'] ?? tags['addr:state'] ?? null,
      country: tags['addr:country'] ?? null,
    },
    description: null,
    coordinates: resolveCoordinates(el),
    features: resolveFeatures(tags),
    amenities: resolveAmenities(tags),
    tags: ['osm'],
    access: null,
    seo: null,
  };
}

// -----------------------------------------------------------------------------
// Graph linking: POI -> najblizsze miasto-hub (belongs_to_city/region)
// -----------------------------------------------------------------------------
function linkCity(entity, seeds, maxKm) {
  const declared = entity.location?.city;
  if (declared) {
    const dslug = slugify(declared);
    const match = seeds.find((s) => s.slug === dslug);
    if (match) return { city: match.name, region: match.region };
  }
  if (!hasCoords(entity.coordinates)) return { city: null, region: null };
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

// -----------------------------------------------------------------------------
// Dedup + enrichment (kopia scripts/crawl/graph-update.mjs)
// -----------------------------------------------------------------------------
function matchExisting(candidate, existing) {
  if (candidate.osmId) {
    const byOsm = existing.find((e) => e.osmId && e.osmId === candidate.osmId);
    if (byOsm) return byOsm;
  }
  const bySlug = existing.find((e) => e.slug === candidate.slug);
  if (bySlug) return bySlug;
  const candNameSlug = slugify(candidate.name);
  const candCity = candidate.location?.city ?? null;
  const byName = existing.find(
    (e) => slugify(e.name) === candNameSlug && (e.location?.city ?? null) === candCity,
  );
  if (byName) return byName;
  const byCoord = existing.find((e) => {
    const d = distanceKm(e.coordinates, candidate.coordinates);
    return d !== null && d <= SAME_COORD_KM;
  });
  return byCoord ?? null;
}
function enrichEntity(existing, incoming) {
  const changed = [];
  const next = { ...existing };
  if (!hasCoords(existing.coordinates) && hasCoords(incoming.coordinates)) {
    next.coordinates = { lat: incoming.coordinates.lat, lng: incoming.coordinates.lng };
    changed.push('coordinates');
  }
  const location = { ...(existing.location ?? {}) };
  let locChanged = false;
  for (const key of ['city', 'region', 'country']) {
    if (location[key] == null && incoming.location?.[key] != null) {
      location[key] = incoming.location[key];
      locChanged = true;
    }
  }
  if (locChanged) { next.location = location; changed.push('location'); }
  const existingFeatures = existing.features ?? [];
  const mergedFeatures = [...existingFeatures];
  for (const f of incoming.features ?? []) {
    if (!mergedFeatures.includes(f)) mergedFeatures.push(f);
  }
  if (mergedFeatures.length !== existingFeatures.length) {
    next.features = mergedFeatures;
    changed.push('features');
  }
  const amenities = { ...(existing.amenities ?? {}) };
  let amenChanged = false;
  for (const [k, v] of Object.entries(incoming.amenities ?? {})) {
    if (v != null && amenities[k] == null) { amenities[k] = v; amenChanged = true; }
  }
  if (amenChanged) { next.amenities = amenities; changed.push('amenities'); }
  if (!existing.osmId && incoming.osmId) { next.osmId = incoming.osmId; changed.push('osmId'); }
  return { entity: next, changed };
}

// -----------------------------------------------------------------------------
// Graph Expansion: adjacency (same-city first, then same-region, by distance)
// -----------------------------------------------------------------------------
function buildAdjacency(entities) {
  const nodes = entities.map((e) => ({
    key: `${e.type ?? 'unknown'}/${e.slug}`,
    entity: e,
    city: e.location?.city ?? null,
    region: e.location?.region ?? null,
  }));
  const adjacency = {};
  for (const source of nodes) {
    const candidates = nodes.filter((o) => {
      if (o.key === source.key) return false;
      return (
        (source.city && o.city === source.city) ||
        (source.region && o.region === source.region)
      );
    });
    candidates.sort((a, b) => {
      const aCity = source.city && a.city === source.city ? 0 : 1;
      const bCity = source.city && b.city === source.city ? 0 : 1;
      if (aCity !== bCity) return aCity - bCity;
      const da = distanceKm(source.entity.coordinates, a.entity.coordinates);
      const db = distanceKm(source.entity.coordinates, b.entity.coordinates);
      if (da === null && db === null) return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      if (da === null) return 1;
      if (db === null) return -1;
      if (da !== db) return da - db;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    adjacency[source.key] = candidates.slice(0, MAX_EDGES_PER_NODE).map((o) => ({
      to: o.key,
      distanceKm: distanceKm(source.entity.coordinates, o.entity.coordinates),
      sameType: (o.entity.type ?? 'unknown') === (source.entity.type ?? 'unknown'),
    }));
  }
  return adjacency;
}

// -----------------------------------------------------------------------------
// Overpass (batch per wojewodztwo)
// -----------------------------------------------------------------------------
function buildRegionQuery(regionSeeds, radiusKm, only) {
  const r = Math.round(radiusKm * 1000);
  const parts = [];
  for (const seed of regionSeeds) {
    const around = `(around:${r},${seed.coordinates.lat},${seed.coordinates.lng})`;
    if (only.has('beach')) {
      parts.push(`node["natural"="beach"]${around};`);
      parts.push(`way["natural"="beach"]${around};`);
      parts.push(`way["leisure"="beach_resort"]${around};`);
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
  }
  return `[out:json][timeout:180];(\n  ${parts.join('\n  ')}\n);out center tags;`;
}
async function fetchOverpass(endpoint, query) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'cloudflare-seo-geo-engine/1.0 (deterministic SSG dataset builder)',
    },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  return Array.isArray(json?.elements) ? json.elements : [];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -----------------------------------------------------------------------------
// CLI + IO
// -----------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    write: false,
    refresh: false,
    noFetch: false,
    offline: null,
    endpoint: DEFAULT_ENDPOINT,
    radius: 10,
    linkRadius: 25,
    nearby: 5,
    delay: 1500,
    only: new Set(['beach', 'parking', 'trail', 'attraction']),
  };
  for (const a of argv) {
    if (a === '--write') opts.write = true;
    else if (a === '--refresh') opts.refresh = true;
    else if (a === '--no-fetch') opts.noFetch = true;
    else if (a.startsWith('--offline=')) opts.offline = resolve(process.cwd(), a.slice(10));
    else if (a.startsWith('--endpoint=')) opts.endpoint = a.slice(11);
    else if (a.startsWith('--radius=')) opts.radius = Number(a.slice(9));
    else if (a.startsWith('--link-radius=')) opts.linkRadius = Number(a.slice(14));
    else if (a.startsWith('--nearby=')) opts.nearby = Number(a.slice(9));
    else if (a.startsWith('--delay=')) opts.delay = Number(a.slice(8));
    else if (a.startsWith('--only=')) {
      opts.only = new Set(a.slice(7).split(',').map((s) => s.trim()).filter(Boolean));
    }
  }
  return opts;
}
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function loadSeeds() {
  return readJson(resolve(DATA_DIR, 'cities.json'))
    .filter((c) => c.type === 'city' && hasCoords(c.coordinates))
    .map((c) => ({
      name: c.location?.city ?? c.name,
      region: c.location?.region ?? null,
      slug: c.slug ?? slugify(c.location?.city ?? c.name),
      coordinates: { lat: c.coordinates.lat, lng: c.coordinates.lng },
    }));
}
function loadRegions() {
  const p = resolve(DATA_DIR, 'regions.json');
  return existsSync(p) ? readJson(p) : [];
}
function loadDataset(name, type) {
  const p = resolve(DATA_DIR, `${name}.json`);
  if (!existsSync(p)) return [];
  return readJson(p).map((e) => ({ ...e, type: e.type ?? type }));
}

// -----------------------------------------------------------------------------
// STAGE 1: fetch (batch per region, cache-first, offline fallback)
// -----------------------------------------------------------------------------
async function fetchAllRegions(seeds, regions, opts) {
  mkdirSync(CACHE_DIR, { recursive: true });

  // Offline fixture: pojedynczy plik zastepuje caly fetch (determinizm/testy).
  if (opts.offline) {
    const raw = readJson(opts.offline);
    const els = Array.isArray(raw) ? raw : raw.elements ?? [];
    return { elements: els, fetchLog: [{ mode: 'offline', file: opts.offline, elements: els.length }] };
  }

  const byRegion = new Map();
  for (const s of seeds) {
    if (!byRegion.has(s.region)) byRegion.set(s.region, []);
    byRegion.get(s.region).push(s);
  }
  const regionOrder = regions.length
    ? regions.map((r) => r.region).filter((r) => byRegion.has(r))
    : [...byRegion.keys()];

  const elements = [];
  const fetchLog = [];
  let idx = 0;
  for (const region of regionOrder) {
    idx++;
    const rslug = slugify(region);
    const cachePath = resolve(CACHE_DIR, `${rslug}.json`);
    let els = null;
    let mode = null;

    if (!opts.refresh && existsSync(cachePath)) {
      els = readJson(cachePath);
      mode = 'cache';
    } else if (opts.noFetch) {
      mode = 'skip-no-fetch';
      els = [];
    } else {
      const query = buildRegionQuery(byRegion.get(region), opts.radius, opts.only);
      try {
        els = await fetchOverpass(opts.endpoint, query);
        writeFileSync(cachePath, JSON.stringify(els, null, 2) + '\n', 'utf8');
        mode = 'overpass';
      } catch (err) {
        mode = `error:${err.message}`;
        els = [];
      }
      if (idx < regionOrder.length) await sleep(opts.delay);
    }

    elements.push(...els);
    fetchLog.push({ region, seeds: byRegion.get(region).length, mode, elements: els.length });
    process.stderr.write(
      `  [${idx}/${regionOrder.length}] ${region}: ${els.length} elementow (${mode})\n`,
    );
  }
  return { elements, fetchLog };
}

// -----------------------------------------------------------------------------
// Reports
// -----------------------------------------------------------------------------
function buildCoverageMap(regions, seeds, entities) {
  // Miasta-seed z co najmniej 1 POI + liczba POI per region.
  const seedsByRegion = new Map();
  for (const s of seeds) {
    if (!seedsByRegion.has(s.region)) seedsByRegion.set(s.region, new Set());
    seedsByRegion.get(s.region).add(s.slug);
  }
  const seedCitiesWithPoi = new Map(); // region -> Set(citySlug)
  const poiByRegion = new Map();       // region -> { total, byType }
  for (const e of entities) {
    const region = e.location?.region ?? null;
    if (!region) continue;
    if (!poiByRegion.has(region)) poiByRegion.set(region, { total: 0, byType: {} });
    const bucket = poiByRegion.get(region);
    bucket.total++;
    bucket.byType[e.type] = (bucket.byType[e.type] ?? 0) + 1;
    const city = e.location?.city ? slugify(e.location.city) : null;
    if (city) {
      if (!seedCitiesWithPoi.has(region)) seedCitiesWithPoi.set(region, new Set());
      seedCitiesWithPoi.get(region).add(city);
    }
  }

  const regionOrder = regions.length ? regions.map((r) => r.region) : [...seedsByRegion.keys()];
  const perRegion = regionOrder.map((region) => {
    const totalSeeds = seedsByRegion.get(region)?.size ?? 0;
    const coveredSeeds = [...(seedCitiesWithPoi.get(region) ?? [])].filter((c) =>
      seedsByRegion.get(region)?.has(c),
    ).length;
    const poi = poiByRegion.get(region) ?? { total: 0, byType: {} };
    return {
      region,
      seedCities: totalSeeds,
      seedCitiesWithPoi: coveredSeeds,
      pois: poi.total,
      byType: poi.byType,
      completenessPct: pct(coveredSeeds, totalSeeds),
    };
  });

  const totalSeeds = seeds.length;
  const totalCoveredSeeds = perRegion.reduce((a, r) => a + r.seedCitiesWithPoi, 0);
  const totalPois = perRegion.reduce((a, r) => a + r.pois, 0);
  const regionsCovered = perRegion.filter((r) => r.pois > 0).length;

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    national: {
      voivodeships: regionOrder.length,
      voivodeshipsCovered: regionsCovered,
      seedCities: totalSeeds,
      seedCitiesWithPoi: totalCoveredSeeds,
      totalPois,
      completenessPct: pct(totalCoveredSeeds, totalSeeds),
      voivodeshipCoveragePct: pct(regionsCovered, regionOrder.length),
    },
    perRegion,
  };
}

function buildGraphDensity(entities, adjacency) {
  const total = entities.length;
  let edges = 0;
  let withNeighbors = 0;
  let sameTypeEdges = 0;
  for (const e of entities) {
    const key = `${e.type ?? 'unknown'}/${e.slug}`;
    const list = adjacency[key] ?? [];
    edges += list.length;
    if (list.length > 0) withNeighbors++;
    sameTypeEdges += list.filter((x) => x.sameType).length;
  }
  const maxEdges = total * (total - 1);
  return {
    nodes: total,
    directedEdges: edges,
    avgDegree: total === 0 ? 0 : round(edges / total, 2),
    orphans: total - withNeighbors,
    connectedPct: pct(withNeighbors, total),
    sameTypeEdges,
    crossTypeEdges: edges - sameTypeEdges,
    densityPct: maxEdges === 0 ? 0 : round((edges / maxEdges) * 100, 3),
  };
}

function buildDedupReport(rawCount, uniqueRawCount, plan) {
  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    rawElements: rawCount,
    uniqueRawElements: uniqueRawCount,
    rawDuplicatesRemoved: rawCount - uniqueRawCount,
    candidateMatches: {
      enriched: plan.enriched.length,
      duplicatesSkipped: plan.duplicates.length,
      newNodes: plan.newNodes.length,
    },
    duplicates: plan.duplicates,
  };
}

// -----------------------------------------------------------------------------
// Full-build merge plan (bez ratio cap - to pelny build, nie inkrement)
// -----------------------------------------------------------------------------
function refOf(e) {
  const type = e.type ?? 'unknown';
  return { key: `${type}/${e.slug}`, type, slug: e.slug, name: e.name };
}
function buildMergePlan(existing, candidates) {
  const workingList = existing.map((e) => ({ ...e }));
  const bySlug = new Map();
  workingList.forEach((e, i) => bySlug.set(e.slug, i));

  const enriched = [];
  const duplicates = [];
  const fresh = [];

  for (const candidate of candidates) {
    const match = matchExisting(candidate, workingList);
    if (match) {
      const index = bySlug.get(match.slug);
      const { entity, changed } = enrichEntity(workingList[index], candidate);
      workingList[index] = entity;
      if (changed.length > 0) enriched.push({ ref: refOf(entity), changed });
      else duplicates.push({ candidate: refOf(candidate), matched: refOf(entity) });
    } else {
      fresh.push(candidate);
    }
  }

  // Dedup wsrod nowych kandydatow (ten sam POI z 2 miast / <50m).
  const accepted = [];
  for (const candidate of fresh) {
    const match = matchExisting(candidate, accepted);
    if (match) duplicates.push({ candidate: refOf(candidate), matched: refOf(match) });
    else accepted.push(candidate);
  }
  accepted.sort((a, b) => {
    const ao = a.osmId ?? '', bo = b.osmId ?? '';
    if (ao !== bo) return ao < bo ? -1 : 1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  return { enriched, duplicates, newNodes: accepted, mergedList: [...workingList, ...accepted] };
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const seeds = loadSeeds();
  const regions = loadRegions();
  if (seeds.length === 0) {
    process.stderr.write('Brak miast-seed. Uruchom najpierw scripts/build/seed-cities.mjs\n');
    process.exit(1);
  }

  process.stderr.write(
    `GEO ENGINE: ${seeds.length} seedow / ${regions.length || '?'} wojewodztw, ` +
      `radius ${opts.radius}km, link ${opts.linkRadius}km, typy [${[...opts.only].join(',')}]\n`,
  );

  // STAGE 1: fetch (batch per region, cache-first).
  const { elements: rawElements, fetchLog } = await fetchAllRegions(seeds, regions, opts);

  // STAGE 2: dedup surowych elementow OSM po type/id.
  const seen = new Set();
  const uniqueRaw = [];
  for (const el of rawElements) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRaw.push(el);
  }

  // STAGE 3: normalize + graph linking (belongs_to_city/region).
  const seedIndex = seeds.map((s) => ({ ...s }));
  let linked = 0;
  const candidates = uniqueRaw
    .map(mapElement)
    .filter((e) => e !== null && TYPE_FILES[e.type]) // tylko routowalne typy do zapisu
    .map((e) => {
      const link = linkCity(e, seedIndex, opts.linkRadius);
      if (link.city) { e.location.city = link.city; e.location.region = link.region; linked++; }
      return e;
    })
    .sort((a, b) => (a.osmId < b.osmId ? -1 : a.osmId > b.osmId ? 1 : 0));

  // STAGE 4: merge + dedup vs istniejace dane.
  const existing = [
    ...loadDataset('beaches', 'beach'),
    ...loadDataset('parkings', 'parking'),
    ...loadDataset('trails', 'trail'),
  ];
  const plan = buildMergePlan(existing, candidates);

  // STAGE 5: graph expansion (adjacency + nearby na kazdym wezle).
  const adjacency = buildAdjacency(plan.mergedList);
  for (const e of plan.mergedList) {
    const key = `${e.type ?? 'unknown'}/${e.slug}`;
    e.graph = { nearby: (adjacency[key] ?? []).slice(0, opts.nearby).map((x) => x.to) };
  }

  // --- Reports ---
  const byType = plan.mergedList.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1;
    return acc;
  }, {});
  const coverageMap = buildCoverageMap(regions, seeds, plan.mergedList);
  const graphDensity = buildGraphDensity(plan.mergedList, adjacency);
  const dedupReport = buildDedupReport(rawElements.length, uniqueRaw.length, plan);

  const clusterPages = {
    cityHubs: seeds.length,
    regions: coverageMap.national.voivodeships,
    categories: Object.keys(TYPE_FILES).length,
  };
  const entityPages = Object.entries(byType)
    .filter(([t]) => TYPE_FILES[t])
    .reduce((a, [, n]) => a + n, 0);
  const totalPages =
    entityPages + clusterPages.cityHubs + clusterPages.regions + clusterPages.categories + 1;

  const stats = {
    generatedAt: new Date().toISOString().slice(0, 10),
    mode: opts.offline ? 'offline' : opts.noFetch ? 'no-fetch' : 'overpass',
    seedCities: seeds.length,
    hubs: seeds.filter((s) => true).length, // wszystkie seedy sa hubami klastra
    voivodeships: coverageMap.national.voivodeships,
    entities: { total: entityPages, byType },
    linkedToCity: linked,
    newNodes: plan.newNodes.length,
    enrichedNodes: plan.enriched.length,
    estimatedPages: { entityPages, ...clusterPages, total: totalPages },
    fetchLog,
  };

  // Persist reports (zawsze, nawet w dry-run).
  mkdirSync(REPORTS_DIR, { recursive: true });
  const reports = {
    'geo-engine-stats.json': stats,
    'coverage-map.json': coverageMap,
    'graph-density.json': graphDensity,
    'geo-engine-dedup.json': dedupReport,
  };
  for (const [file, data] of Object.entries(reports)) {
    writeFileSync(resolve(REPORTS_DIR, file), JSON.stringify(data, null, 2) + '\n', 'utf8');
  }

  // STAGE 6: write /packages/data (tylko z --write).
  if (opts.write) {
    for (const [type, file] of Object.entries(TYPE_FILES)) {
      const rows = plan.mergedList
        .filter((e) => e.type === type)
        .map(({ type: _t, ...rest }) => rest);
      writeFileSync(
        resolve(DATA_DIR, `${file}.json`),
        JSON.stringify(rows, null, 2) + '\n',
        'utf8',
      );
    }
    process.stderr.write('[--write] Zapisano /packages/data (beaches/parkings/trails)\n');
  } else {
    process.stderr.write('[dry-run] Dane zrodlowe niezmienione (uzyj --write)\n');
  }

  // Podsumowanie.
  process.stderr.write(
    `\nWYNIK:\n` +
      `  encje: ${entityPages} (${JSON.stringify(byType)})\n` +
      `  linked->miasto: ${linked} | nowe: ${plan.newNodes.length} | wzbogacone: ${plan.enriched.length}\n` +
      `  graph: ${graphDensity.directedEdges} krawedzi, avg degree ${graphDensity.avgDegree}, ` +
      `orphans ${graphDensity.orphans}, connected ${graphDensity.connectedPct}%\n` +
      `  coverage: ${coverageMap.national.completenessPct}% seedow z POI, ` +
      `${coverageMap.national.voivodeshipsCovered}/${coverageMap.national.voivodeships} wojewodztw\n` +
      `  szacowane strony SEO: ${totalPages}\n` +
      `  raporty -> scripts/build/reports/{geo-engine-stats,coverage-map,graph-density,geo-engine-dedup}.json\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
