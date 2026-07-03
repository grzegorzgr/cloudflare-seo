// Warstwa CRAWLER: deterministyczny, INKREMENTALNY updater GEO SEO GRAPH.
// Czyste funkcje (bez IO) - orkiestracja i zapis nalezą do scripts/crawl/graph-update.mjs.
//
// ZASADY (bezwzgledne):
//  - toznosc encji jest STALA: id, slug (URL), name, type NIGDY sie nie zmieniaja
//  - enrichment tylko uzupelnia braki (null/empty) - nie nadpisuje istniejacych faktow
//  - ZERO inference: nowe dane pochodza wylacznie z jawnych kandydatow (np. OSM)
//  - ekspansja jest INKREMENTALNA: max ratio nowych wezlow na run (domyslnie +20%)

import { distanceKm, hasCoordinates } from './geo.js';
import { slugify } from './slug.js';
import { buildGeoGraph } from './graph.js';
import type { Dataset, Entity } from './types.js';

/** Prog (km), ponizej ktorego dwie encje uznajemy za ten sam punkt (50 m). */
const SAME_COORD_KM = 0.05;

/** Domyslny limit inkrementalnej ekspansji: +20% nowych wezlow na run. */
export const DEFAULT_EXPANSION_RATIO = 0.2;

/** Plaska referencja do encji. */
export interface CrawlRef {
  key: string;
  type: string;
  slug: string;
  name: string;
}

function refOf(entity: Entity): CrawlRef {
  const type = entity.type ?? 'unknown';
  return {
    key: `${type}/${entity.slug}`,
    type,
    slug: entity.slug,
    name: entity.name,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : round1((part / total) * 100);
}

/** Raport pokrycia (coverage) grafu w procentach. */
export interface CoverageReport {
  totalNodes: number;
  withCoordinates: number;
  withCity: number;
  withRegion: number;
  withNeighbors: number;
  orphans: number;
  coordinatesPct: number;
  regionPct: number;
  cityPct: number;
  neighborsPct: number;
}

/**
 * Deterministyczny raport pokrycia dla wszystkich datasetow.
 * "withNeighbors" liczone z rzeczywistego grafu (buildGeoGraph).
 */
export function analyzeCoverage(datasets: Dataset[]): CoverageReport {
  const graph = buildGeoGraph(datasets);
  const entities = datasets.flatMap((d) => d.entities);
  const total = entities.length;

  let withCoordinates = 0;
  let withCity = 0;
  let withRegion = 0;
  for (const entity of entities) {
    if (hasCoordinates(entity.coordinates)) withCoordinates++;
    if (entity.location?.city) withCity++;
    if (entity.location?.region) withRegion++;
  }

  let withNeighbors = 0;
  for (const node of graph.nodes) {
    if ((graph.adjacency[node.key] ?? []).length > 0) withNeighbors++;
  }

  return {
    totalNodes: total,
    withCoordinates,
    withCity,
    withRegion,
    withNeighbors,
    orphans: total - withNeighbors,
    coordinatesPct: pct(withCoordinates, total),
    regionPct: pct(withRegion, total),
    cityPct: pct(withCity, total),
    neighborsPct: pct(withNeighbors, total),
  };
}

/**
 * Znajduje istniejaca encje odpowiadajaca kandydatowi (deterministycznie).
 * Kolejnosc sygnalow toznosci: osmId -> slug -> slug(name)+miasto -> bliskosc wspolrzednych.
 * Pozwala uzupelnic istniejacy wezel zamiast tworzyc duplikat.
 */
export function matchExisting(
  candidate: Entity,
  existing: Entity[],
): Entity | null {
  if (candidate.osmId) {
    const byOsm = existing.find((e) => e.osmId && e.osmId === candidate.osmId);
    if (byOsm) return byOsm;
  }
  const bySlug = existing.find((e) => e.slug === candidate.slug);
  if (bySlug) return bySlug;

  const candNameSlug = slugify(candidate.name);
  const candCity = candidate.location?.city ?? null;
  const byName = existing.find(
    (e) =>
      slugify(e.name) === candNameSlug &&
      (e.location?.city ?? null) === candCity,
  );
  if (byName) return byName;

  const byCoord = existing.find((e) => {
    const d = distanceKm(e, candidate);
    return d !== null && d <= SAME_COORD_KM;
  });
  return byCoord ?? null;
}

/** Wynik enrichmentu jednej encji: nowy obiekt + lista zmienionych pol. */
export interface EnrichResult {
  entity: Entity;
  changed: string[];
}

/**
 * INKREMENTALNY enrichment: uzupelnia WYLACZNIE braki istniejacej encji
 * danymi z kandydata. Nigdy nie zmienia id/slug/name/type ani istniejacych
 * (nie-null) faktow. Zwraca nowy obiekt (bez mutacji wejscia).
 */
export function enrichEntity(existing: Entity, incoming: Entity): EnrichResult {
  const changed: string[] = [];
  const next: Entity = { ...existing };

  // Wspolrzedne: uzupelnij tylko, gdy istniejaca encja ich nie ma.
  if (
    !hasCoordinates(existing.coordinates) &&
    hasCoordinates(incoming.coordinates)
  ) {
    next.coordinates = {
      lat: incoming.coordinates.lat,
      lng: incoming.coordinates.lng,
    };
    changed.push('coordinates');
  }

  // Lokalizacja: uzupelnij wylacznie puste pola (city/region/country).
  const location = { ...(existing.location ?? {}) };
  let locationChanged = false;
  for (const key of ['city', 'region', 'country'] as const) {
    if (location[key] == null && incoming.location?.[key] != null) {
      location[key] = incoming.location[key];
      locationChanged = true;
    }
  }
  if (locationChanged) {
    next.location = location;
    changed.push('location');
  }

  // Features: unia z zachowaniem kolejnosci (dodaj nowe fakty, bez usuwania).
  const existingFeatures = existing.features ?? [];
  const mergedFeatures = [...existingFeatures];
  for (const feature of incoming.features ?? []) {
    if (!mergedFeatures.includes(feature)) {
      mergedFeatures.push(feature);
    }
  }
  if (mergedFeatures.length !== existingFeatures.length) {
    next.features = mergedFeatures;
    changed.push('features');
  }

  // Amenities: wypelnij wylacznie sloty null jawnymi wartosciami kandydata.
  const amenities = { ...(existing.amenities ?? {}) };
  let amenitiesChanged = false;
  for (const [key, value] of Object.entries(incoming.amenities ?? {})) {
    if (value != null && amenities[key] == null) {
      amenities[key] = value;
      amenitiesChanged = true;
    }
  }
  if (amenitiesChanged) {
    next.amenities = amenities;
    changed.push('amenities');
  }

  // osmId: przypisz tylko, gdy istniejaca encja go nie ma (metadata enrichment).
  if (!existing.osmId && incoming.osmId) {
    next.osmId = incoming.osmId;
    changed.push('osmId');
  }

  return { entity: next, changed };
}

/** Wpis enrichmentu w planie (encja istniejaca zmieniona przez kandydata). */
export interface EnrichmentEntry {
  ref: CrawlRef;
  changed: string[];
  entity: Entity;
}

/** Wpis duplikatu: kandydat pokryty przez istniejacy wezel (bez zmian). */
export interface DuplicateEntry {
  candidate: CrawlRef;
  matched: CrawlRef;
}

/** Pelny, deterministyczny plan inkrementalnej aktualizacji grafu. */
export interface CrawlUpdatePlan {
  ratio: number;
  cap: number;
  /** Encje istniejace wzbogacone o dane kandydatow (te same id/slug/URL). */
  enrichments: EnrichmentEntry[];
  /** Nowe wezly zaakceptowane w tym runie (do limitu cap). */
  newNodes: Entity[];
  /** Poprawne nowe wezly ponad limit - do kolejnego runu (stabilnosc). */
  deferredNodes: Entity[];
  /** Kandydaci odrzuceni jako duplikaty istniejacych wezlow. */
  duplicates: DuplicateEntry[];
  /** Wynik inkrementalny: istniejace (wzbogacone, ta sama kolejnosc) + newNodes. */
  mergedEntities: Entity[];
}

/**
 * Buduje deterministyczny plan inkrementalnej aktualizacji.
 *
 * Krok 1: dla kazdego kandydata szukaj dopasowania do istniejacego wezla.
 *   - dopasowany  -> enrichment (uzupelnienie brakow, stabilne id/URL)
 *   - niedopasowany -> potencjalny nowy wezel
 * Krok 2: nowe wezly deduplikuj miedzy soba (osmId/slug/nazwa/wspolrzedne).
 * Krok 3: sortuj deterministycznie i przytnij do cap = floor(len * ratio).
 *   nadmiar trafia do deferredNodes (kolejny run), bez utraty stabilnosci.
 *
 * `existing` zachowuje kolejnosc (stabilne URL). Nowe wezly dopisywane na koncu.
 */
export function planCrawlUpdate(
  existing: Entity[],
  candidates: Entity[],
  ratio: number = DEFAULT_EXPANSION_RATIO,
): CrawlUpdatePlan {
  const cap = Math.floor(existing.length * ratio);

  // Kopia robocza istniejacych, indeksowana po slug (kolejnosc zachowana).
  const workingList = existing.map((e) => ({ ...e }));
  const bySlug = new Map<string, number>();
  workingList.forEach((e, i) => bySlug.set(e.slug, i));

  const enrichments: EnrichmentEntry[] = [];
  const duplicates: DuplicateEntry[] = [];
  const freshCandidates: Entity[] = [];

  for (const candidate of candidates) {
    const match = matchExisting(candidate, workingList);
    if (match) {
      const index = bySlug.get(match.slug)!;
      const { entity, changed } = enrichEntity(workingList[index], candidate);
      workingList[index] = entity;
      if (changed.length > 0) {
        enrichments.push({ ref: refOf(entity), changed, entity });
      } else {
        // Dopasowany, ale bez nowych danych -> traktuj jak duplikat (pomijamy).
        duplicates.push({ candidate: refOf(candidate), matched: refOf(entity) });
      }
    } else {
      freshCandidates.push(candidate);
    }
  }

  // Deduplikacja nowych kandydatow miedzy soba (deterministyczna, wg kolejnosci).
  const acceptedFresh: Entity[] = [];
  for (const candidate of freshCandidates) {
    const match = matchExisting(candidate, acceptedFresh);
    if (match) {
      duplicates.push({ candidate: refOf(candidate), matched: refOf(match) });
    } else {
      acceptedFresh.push(candidate);
    }
  }

  // Deterministyczna kolejnosc nowych wezlow: osmId, potem slug.
  acceptedFresh.sort((a, b) => {
    const ao = a.osmId ?? '';
    const bo = b.osmId ?? '';
    if (ao !== bo) return ao < bo ? -1 : 1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  const newNodes = acceptedFresh.slice(0, cap);
  const deferredNodes = acceptedFresh.slice(cap);

  return {
    ratio,
    cap,
    enrichments,
    newNodes,
    deferredNodes,
    duplicates,
    mergedEntities: [...workingList, ...newNodes],
  };
}
