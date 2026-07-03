// Warstwa CITY SEED / GRAPH LINKING.
// Deterministyczne narzedzia dla warstwy miast (anchor nodes) oraz przypisania
// POI do najblizszego miasta-huba (belongs_to_city / belongs_to_region).
//
// ZASADA BEZWZGLEDNA: zero halucynacji. Linkowanie miasta to obliczenie
// geometryczne na istniejacych wspolrzednych, a nie wymyslony fakt.
// Brak wspolrzednych albo brak miasta w promieniu => null (bez zgadywania).

import { distanceKm, hasCoordinates } from './geo.js';
import { slugify } from './slug.js';
import type { CityRef, SitemapLikeDataset } from './clusters.js';
import type { Entity } from './types.js';

/** Seed miasta = encja o type "city" (ten sam schemat co POI). */
export type CitySeed = Entity;

/** Wynik przypisania POI do miasta-huba (graph linkage). */
export interface CityLinkage {
  belongs_to_city: string | null;
  belongs_to_region: string | null;
  /** Odleglosc w km do przypisanego huba (null gdy brak wspolrzednych). */
  distanceKm: number | null;
}

/** Domyslny maks. promien przypisania POI do miasta-huba (km). */
export const DEFAULT_CITY_LINK_RADIUS_KM = 25;

/**
 * Rejestr miast wprost z warstwy seed (anchor nodes).
 * Kolejnosc = kolejnosc w danych (deterministyczna).
 */
export function listCitySeeds(citySeeds: CitySeed[]): CityRef[] {
  return citySeeds.map((seed) => ({
    city: seed.location?.city ?? seed.name,
    region: seed.location?.region ?? null,
    slug: seed.slug ?? slugify(seed.location?.city ?? seed.name),
    count: 0,
  }));
}

/**
 * Deterministyczne przypisanie POI do najblizszego miasta-huba.
 * Preferuje jawny addr:city (location.city) jesli pokrywa sie z seedem;
 * w przeciwnym razie wybiera najblizszy seed w promieniu maxKm.
 * Remis odleglosci rozstrzyga slug miasta (pelna odtwarzalnosc).
 */
export function linkCity(
  entity: Entity,
  citySeeds: CitySeed[],
  maxKm: number = DEFAULT_CITY_LINK_RADIUS_KM,
): CityLinkage {
  const empty: CityLinkage = {
    belongs_to_city: null,
    belongs_to_region: null,
    distanceKm: null,
  };

  // 1. Jawny addr:city pokrywajacy sie z seedem ma pierwszenstwo (zero inference).
  const declaredCity = entity.location?.city ?? null;
  if (declaredCity) {
    const declaredSlug = slugify(declaredCity);
    const match = citySeeds.find(
      (seed) => slugify(seed.location?.city ?? seed.name) === declaredSlug,
    );
    if (match) {
      return {
        belongs_to_city: match.location?.city ?? match.name,
        belongs_to_region: match.location?.region ?? null,
        distanceKm: distanceKm(entity, match),
      };
    }
  }

  // 2. Brak wspolrzednych = brak mozliwosci obliczenia => null.
  if (!hasCoordinates(entity.coordinates)) {
    return empty;
  }

  // 3. Najblizszy seed w promieniu maxKm (deterministyczny tie-break po slug).
  let best: { seed: CitySeed; dist: number } | null = null;
  for (const seed of citySeeds) {
    const dist = distanceKm(entity, seed);
    if (dist === null || dist > maxKm) {
      continue;
    }
    if (
      best === null ||
      dist < best.dist ||
      (dist === best.dist &&
        (seed.slug ?? '') < (best.seed.slug ?? ''))
    ) {
      best = { seed, dist };
    }
  }

  if (best === null) {
    return empty;
  }

  return {
    belongs_to_city: best.seed.location?.city ?? best.seed.name,
    belongs_to_region: best.seed.location?.region ?? null,
    distanceKm: best.dist,
  };
}

/**
 * Laczy rejestr miast pochodzacy z POI z rejestrem seed.
 * Miasta-huby bez POI nadal otrzymuja wpis (i strone /city/{slug}).
 * Deduplikacja po slug; liczniki (count) sumowane z warstwy POI.
 * Kolejnosc: najpierw seedy (anchor), potem dodatkowe miasta z POI.
 */
export function mergeCityRefs(
  fromPoi: CityRef[],
  fromSeeds: CityRef[],
): CityRef[] {
  const bySlug = new Map<string, CityRef>();
  const order: string[] = [];

  for (const ref of fromSeeds) {
    if (!bySlug.has(ref.slug)) {
      bySlug.set(ref.slug, { ...ref });
      order.push(ref.slug);
    }
  }

  for (const ref of fromPoi) {
    const existing = bySlug.get(ref.slug);
    if (existing) {
      existing.count += ref.count;
      if (existing.region == null && ref.region != null) {
        existing.region = ref.region;
      }
    } else {
      bySlug.set(ref.slug, { ...ref });
      order.push(ref.slug);
    }
  }

  return order.map((slug) => bySlug.get(slug)!);
}

/** Region seedu dla danej nazwy miasta (fallback gdy miasto nie ma POI). */
export function regionOfCitySeed(
  city: string,
  citySeeds: CitySeed[],
): string | null {
  const target = slugify(city);
  const match = citySeeds.find(
    (seed) => slugify(seed.location?.city ?? seed.name) === target,
  );
  return match?.location?.region ?? null;
}

// Re-eksport typow uzywanych przez konsumentow warstwy miast.
export type { SitemapLikeDataset };
