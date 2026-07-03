// Warstwa DEDUPLICATION: deterministyczne wykrywanie duplikatow i sierot.
// Analizuje istniejacy dataset - nie tworzy ani nie zmienia danych zrodlowych.
// Wynik (raport) sluzy do czyszczenia danych przed generowaniem grafu.

import { distanceKm, hasCoordinates } from './geo.js';
import { slugify } from './slug.js';
import type { Dataset, Entity } from './types.js';

/** Prog odleglosci (km) ponizej ktorego wspolrzedne uznajemy za te same (50 m). */
const SAME_COORD_KM = 0.05;

/** Powod uznania encji za duplikaty. */
export type DuplicateReason = 'name' | 'coordinates' | 'osmId';

/** Plaska referencja do encji w obrebie calego datasetu. */
export interface EntityRef {
  key: string;
  type: string;
  slug: string;
  name: string;
}

/** Grupa duplikatow: encja wiodaca + duplikaty + powod. */
export interface DuplicateGroup {
  reason: DuplicateReason;
  primary: EntityRef;
  duplicates: EntityRef[];
}

/** Pelny raport deduplikacji. */
export interface DedupeReport {
  totalEntities: number;
  duplicateGroups: DuplicateGroup[];
  /** Wezly bez zadnych sasiadow (ten sam typ/miasto/region) - kandydaci do przegladu. */
  orphans: EntityRef[];
}

interface Indexed {
  entity: Entity;
  ref: EntityRef;
}

function toRef(entity: Entity, basePath: string): EntityRef {
  return {
    key: `${basePath}/${entity.slug}`,
    type: basePath,
    slug: entity.slug,
    name: entity.name,
  };
}

function indexAll(datasets: Dataset[]): Indexed[] {
  const indexed: Indexed[] = [];
  for (const { entities, config } of datasets) {
    for (const entity of entities) {
      indexed.push({ entity, ref: toRef(entity, config.basePath) });
    }
  }
  return indexed;
}

/**
 * Grupuje encje wg klucza deterministycznego. Pierwsza encja w kolejnosci
 * datasetu zostaje "primary", pozostale sa duplikatami.
 */
function groupBy(
  indexed: Indexed[],
  reason: DuplicateReason,
  keyOf: (item: Indexed) => string | null,
): DuplicateGroup[] {
  const order: string[] = [];
  const groups = new Map<string, Indexed[]>();

  for (const item of indexed) {
    const key = keyOf(item);
    if (key === null) {
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(item);
  }

  return order
    .map((key) => groups.get(key)!)
    .filter((members) => members.length > 1)
    .map((members) => ({
      reason,
      primary: members[0].ref,
      duplicates: members.slice(1).map((m) => m.ref),
    }));
}

/** Duplikaty wg znormalizowanej nazwy (slug z name). */
export function findNameDuplicates(datasets: Dataset[]): DuplicateGroup[] {
  return groupBy(indexAll(datasets), 'name', (item) =>
    slugify(item.entity.name),
  );
}

/** Duplikaty wg identyfikatora OSM (tylko encje z osmId). */
export function findOsmDuplicates(datasets: Dataset[]): DuplicateGroup[] {
  return groupBy(indexAll(datasets), 'osmId', (item) =>
    item.entity.osmId ? String(item.entity.osmId) : null,
  );
}

/**
 * Duplikaty wg zblizonych wspolrzednych (< SAME_COORD_KM).
 * Deterministyczne, symetryczne parowanie: kazda encja z wspolrzednymi
 * porownywana z nastepnymi w stalej kolejnosci datasetu.
 */
export function findCoordinateDuplicates(datasets: Dataset[]): DuplicateGroup[] {
  const indexed = indexAll(datasets).filter((item) =>
    hasCoordinates(item.entity.coordinates),
  );
  const assigned = new Set<string>();
  const groups: DuplicateGroup[] = [];

  for (let i = 0; i < indexed.length; i++) {
    if (assigned.has(indexed[i].ref.key)) {
      continue;
    }
    const duplicates: EntityRef[] = [];
    for (let j = i + 1; j < indexed.length; j++) {
      if (assigned.has(indexed[j].ref.key)) {
        continue;
      }
      const d = distanceKm(indexed[i].entity, indexed[j].entity);
      if (d !== null && d <= SAME_COORD_KM) {
        duplicates.push(indexed[j].ref);
        assigned.add(indexed[j].ref.key);
      }
    }
    if (duplicates.length > 0) {
      assigned.add(indexed[i].ref.key);
      groups.push({
        reason: 'coordinates',
        primary: indexed[i].ref,
        duplicates,
      });
    }
  }
  return groups;
}

/**
 * Wezly-sieroty: encje bez zadnego sasiada (nikt nie dzieli miasta ani regionu).
 * Takie encje wygeneruja pusta sekcje "Podobne miejsca" - warto je przejrzec.
 */
export function findOrphans(datasets: Dataset[]): EntityRef[] {
  const indexed = indexAll(datasets);
  return indexed
    .filter((item) => {
      const city = item.entity.location?.city ?? null;
      const region = item.entity.location?.region ?? null;
      if (!city && !region) {
        return true;
      }
      return !indexed.some((other) => {
        if (other.ref.key === item.ref.key) {
          return false;
        }
        const oCity = other.entity.location?.city ?? null;
        const oRegion = other.entity.location?.region ?? null;
        return (city && oCity === city) || (region && oRegion === region);
      });
    })
    .map((item) => item.ref);
}

/** Pelny, deterministyczny raport deduplikacji dla wszystkich datasetow. */
export function buildDedupeReport(datasets: Dataset[]): DedupeReport {
  const indexed = indexAll(datasets);
  return {
    totalEntities: indexed.length,
    duplicateGroups: [
      ...findOsmDuplicates(datasets),
      ...findNameDuplicates(datasets),
      ...findCoordinateDuplicates(datasets),
    ],
    orphans: findOrphans(datasets),
  };
}
