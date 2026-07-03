#!/usr/bin/env node
// Warstwa SCRIPTS: continuous GEO SEO crawler + graph optimizer.
// INKREMENTALNY updater grafu - utrzymuje "zywy" dataset bez pelnej regeneracji.
//
// Co robi jeden run:
//   1. analizuje pokrycie (coverage %) istniejacych encji
//   2. dopasowuje kandydatow (np. z OSM) do istniejacych wezlow
//      - dopasowany  -> enrichment (uzupelnia braki, STABILNE id/slug/URL)
//      - nowy        -> kandydat na nowy wezel (limit +ratio% na run)
//   3. deduplikuje (osmId / slug / nazwa / wspolrzedne < 50 m)
//   4. przelicza liste sasiedztwa (adjacency)
//   5. zapisuje raporty; z flaga --write aktualizuje pliki /packages/data
//
// Uzycie:
//   node scripts/crawl/graph-update.mjs [candidates.json] [--write] [--ratio=0.2]
//
// Domyslnie DRY-RUN (nie zapisuje danych zrodlowych) - tylko raporty.
// candidates.json = wynik scripts/crawl/osm-ingest.mjs (schemat encji).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, '../../packages/data');
const REPORTS_DIR = resolve(HERE, 'reports');

const SAME_COORD_KM = 0.05;
const EARTH_RADIUS_KM = 6371;
const MAX_EDGES_PER_NODE = 8;
const DEFAULT_RATIO = 0.2;

// Mapowanie typ encji -> plik danych. Tylko znane typy sa zapisywane (--write).
const TYPE_FILES = { beach: 'beaches', parking: 'parkings', trail: 'trails' };

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
    .replace(/^-+|-+$/g, '');
}

// --- Geo (kopia packages/generator/src/geo.ts) ---
function hasCoords(c) {
  return !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng);
}
function distanceKm(a, b) {
  if (!hasCoords(a.coordinates) || !hasCoords(b.coordinates)) return null;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.coordinates.lat - a.coordinates.lat);
  const dLng = toRad(b.coordinates.lng - a.coordinates.lng);
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h =
    sLat * sLat +
    Math.cos(toRad(a.coordinates.lat)) *
      Math.cos(toRad(b.coordinates.lat)) * sLng * sLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function refOf(e) {
  const type = e.type ?? 'unknown';
  return { key: `${type}/${e.slug}`, type, slug: e.slug, name: e.name };
}

// --- Matching / enrichment (kopia crawler.ts) ---
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
    (e) => slugify(e.name) === candNameSlug &&
      (e.location?.city ?? null) === candCity,
  );
  if (byName) return byName;
  const byCoord = existing.find((e) => {
    const d = distanceKm(e, candidate);
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

  if (!existing.osmId && incoming.osmId) {
    next.osmId = incoming.osmId;
    changed.push('osmId');
  }

  return { entity: next, changed };
}

// --- Adjacency (kopia graph.ts buildGeoGraph, kompaktowo) ---
function buildAdjacency(entities) {
  const nodes = entities.map((e) => ({
    key: `${e.type ?? 'unknown'}/${e.slug}`,
    entity: e,
    city: e.location?.city ?? null,
    region: e.location?.region ?? null,
  }));
  const adjacency = {};
  for (const source of nodes) {
    const candidates = nodes.filter((other) => {
      if (other.key === source.key) return false;
      return (
        (source.city && other.city === source.city) ||
        (source.region && other.region === source.region)
      );
    });
    candidates.sort((a, b) => {
      const aCity = source.city && a.city === source.city ? 0 : 1;
      const bCity = source.city && b.city === source.city ? 0 : 1;
      if (aCity !== bCity) return aCity - bCity;
      const da = distanceKm(source.entity, a.entity);
      const db = distanceKm(source.entity, b.entity);
      if (da === null && db === null) return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      if (da === null) return 1;
      if (db === null) return -1;
      if (da !== db) return da - db;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    adjacency[source.key] = candidates.slice(0, MAX_EDGES_PER_NODE).map((o) => ({
      to: o.key,
      distanceKm: distanceKm(source.entity, o.entity),
      sameType: (o.entity.type ?? 'unknown') === (source.entity.type ?? 'unknown'),
    }));
  }
  return adjacency;
}

// --- Coverage ---
function round1(v) { return Math.round(v * 10) / 10; }
function pct(part, total) { return total === 0 ? 0 : round1((part / total) * 100); }

function analyzeCoverage(entities, adjacency) {
  const total = entities.length;
  let withCoordinates = 0, withCity = 0, withRegion = 0;
  for (const e of entities) {
    if (hasCoords(e.coordinates)) withCoordinates++;
    if (e.location?.city) withCity++;
    if (e.location?.region) withRegion++;
  }
  let withNeighbors = 0;
  for (const e of entities) {
    const key = `${e.type ?? 'unknown'}/${e.slug}`;
    if ((adjacency[key] ?? []).length > 0) withNeighbors++;
  }
  return {
    totalNodes: total,
    withCoordinates, withCity, withRegion, withNeighbors,
    orphans: total - withNeighbors,
    coordinatesPct: pct(withCoordinates, total),
    regionPct: pct(withRegion, total),
    cityPct: pct(withCity, total),
    neighborsPct: pct(withNeighbors, total),
  };
}

// --- Incremental plan (kopia crawler.ts planCrawlUpdate) ---
function planCrawlUpdate(existing, candidates, ratio) {
  const cap = Math.floor(existing.length * ratio);
  const workingList = existing.map((e) => ({ ...e }));
  const bySlug = new Map();
  workingList.forEach((e, i) => bySlug.set(e.slug, i));

  const enrichments = [];
  const duplicates = [];
  const freshCandidates = [];

  for (const candidate of candidates) {
    const match = matchExisting(candidate, workingList);
    if (match) {
      const index = bySlug.get(match.slug);
      const { entity, changed } = enrichEntity(workingList[index], candidate);
      workingList[index] = entity;
      if (changed.length > 0) {
        enrichments.push({ ref: refOf(entity), changed });
      } else {
        duplicates.push({ candidate: refOf(candidate), matched: refOf(entity) });
      }
    } else {
      freshCandidates.push(candidate);
    }
  }

  const acceptedFresh = [];
  for (const candidate of freshCandidates) {
    const match = matchExisting(candidate, acceptedFresh);
    if (match) {
      duplicates.push({ candidate: refOf(candidate), matched: refOf(match) });
    } else {
      acceptedFresh.push(candidate);
    }
  }

  acceptedFresh.sort((a, b) => {
    const ao = a.osmId ?? '', bo = b.osmId ?? '';
    if (ao !== bo) return ao < bo ? -1 : 1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  const newNodes = acceptedFresh.slice(0, cap);
  const deferredNodes = acceptedFresh.slice(cap);

  return {
    ratio, cap, enrichments, duplicates,
    newNodes, deferredNodes,
    mergedList: [...workingList, ...newNodes],
  };
}

// --- IO ---
function loadDataset(name, type) {
  const list = JSON.parse(readFileSync(resolve(DATA_DIR, `${name}.json`), 'utf8'));
  return list.map((e) => ({ ...e, type: e.type ?? type }));
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const ratioArg = args.find((a) => a.startsWith('--ratio='));
  const ratio = ratioArg ? Number(ratioArg.split('=')[1]) : DEFAULT_RATIO;
  const candidatesPath = args.find((a) => !a.startsWith('--'));

  const existing = [
    ...loadDataset('beaches', 'beach'),
    ...loadDataset('parkings', 'parking'),
    ...loadDataset('trails', 'trail'),
  ];

  let candidates = [];
  if (candidatesPath) {
    const raw = JSON.parse(readFileSync(resolve(candidatesPath), 'utf8'));
    candidates = (Array.isArray(raw) ? raw : raw.elements ?? []).map((e) => ({
      ...e, type: e.type ?? 'unknown',
    }));
  }

  const coverageBefore = analyzeCoverage(existing, buildAdjacency(existing));
  const plan = planCrawlUpdate(existing, candidates, ratio);
  const adjacency = buildAdjacency(plan.mergedList);
  const coverageAfter = analyzeCoverage(plan.mergedList, adjacency);

  // Nowe wezly nieznanego typu - nie zapisujemy do plikow (brak configu/strony).
  const unroutable = plan.newNodes.filter((n) => !TYPE_FILES[n.type]);

  const report = {
    generatedAt: new Date().toISOString().slice(0, 10),
    ratio,
    cap: plan.cap,
    candidatesProvided: candidates.length,
    coverage: { before: coverageBefore, after: coverageAfter },
    updatedNodes: plan.enrichments,
    newNodes: plan.newNodes.map(refOf),
    deferredNodes: plan.deferredNodes.map(refOf),
    duplicates: plan.duplicates,
    unroutableNewTypes: unroutable.map(refOf),
    adjacency,
  };

  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORTS_DIR, 'graph-update-report.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8',
  );

  if (write) {
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
    process.stderr.write('[--write] Zaktualizowano pliki /packages/data (znane typy)\n');
    if (unroutable.length > 0) {
      process.stderr.write(
        `UWAGA: ${unroutable.length} nowych wezlow nieznanego typu NIE zapisano (brak configu/strony)\n`,
      );
    }
  } else {
    process.stderr.write('[dry-run] Nie zapisano danych zrodlowych (uzyj --write)\n');
  }

  process.stderr.write(
    `Coverage: nodes ${coverageBefore.totalNodes} -> ${coverageAfter.totalNodes} | ` +
      `neighbors ${coverageBefore.neighborsPct}% -> ${coverageAfter.neighborsPct}% | ` +
      `coords ${coverageAfter.coordinatesPct}%\n`,
  );
  process.stderr.write(
    `Plan: enriched ${plan.enrichments.length} | new ${plan.newNodes.length} ` +
      `(cap ${plan.cap}) | deferred ${plan.deferredNodes.length} | dup ${plan.duplicates.length}\n`,
  );
  process.stderr.write(`Raport -> ${resolve(REPORTS_DIR, 'graph-update-report.json')}\n`);
}

main();
