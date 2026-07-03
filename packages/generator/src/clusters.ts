// Cluster pages: strony agregacyjne wg typu (/{type}/) oraz regionu (/region/{slug}).
// Wszystko wyprowadzone deterministycznie z /packages/data. Bez nowych danych.

import { slugify, stripTrailingSlashes } from './slug.js';
import { byDistanceFrom } from './geo.js';
import type { CollectionRef, Entity, TypeConfig } from './types.js';

const UNKNOWN = 'nieznane';

/** Link wewnetrzny do strony encji w widoku cluster. */
export interface ClusterLink {
  href: string;
  name: string;
  city: string;
  region: string;
}

/** Sekcja cluster: naglowek + lista linkow wewnetrznych. */
export interface ClusterSection {
  heading: string;
  items: ClusterLink[];
}

/** Model strony cluster wg typu (/{type}/). */
export interface ClusterModel {
  type: string;
  title: string;
  description: string;
  intro: string;
  canonical: string;
  count: number;
  sections: ClusterSection[];
  jsonLd: Record<string, unknown>;
}

/** Wpis rejestru regionow (do getStaticPaths i nawigacji). */
export interface RegionRef {
  region: string;
  slug: string;
  count: number;
}

/** Wpis rejestru miast (do getStaticPaths i nawigacji /city/{slug}). */
export interface CityRef {
  city: string;
  region: string | null;
  slug: string;
  count: number;
}

/** Model strony regionu (/region/{slug}), grupowany wg typu encji. */
export interface RegionModel {
  region: string;
  slug: string;
  title: string;
  description: string;
  intro: string;
  canonical: string;
  count: number;
  sections: ClusterSection[];
  jsonLd: Record<string, unknown>;
}

function toLink(entity: Entity, config: TypeConfig): ClusterLink {
  return {
    href: `/${config.basePath}/${entity.slug}`,
    name: entity.name,
    city: entity.location?.city ?? UNKNOWN,
    region: entity.location?.region ?? UNKNOWN,
  };
}

/**
 * Buduje deterministyczny blok JSON-LD ItemList z listy linkow.
 * baseUrl (opcjonalny origin) jest doklejany do href, jesli podany.
 */
function buildItemList(
  name: string,
  links: ClusterLink[],
  baseUrl = '',
): Record<string, unknown> {
  const base = stripTrailingSlashes(baseUrl);
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: links.length,
    itemListElement: links.map((link, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: link.name,
      url: `${base}${link.href}`,
    })),
  };
}

/**
 * Model strony cluster dla jednego typu (np. wszystkie plaze).
 * Grupuje encje wg regionu; kolejnosc wynika z porzadku datasetu.
 */
export function buildClusterModel(
  entities: Entity[],
  config: TypeConfig,
  baseUrl = '',
): ClusterModel {
  const regions: string[] = [];
  const grouped = new Map<string, ClusterLink[]>();

  for (const entity of entities) {
    const region = entity.location?.region ?? UNKNOWN;
    if (!grouped.has(region)) {
      grouped.set(region, []);
      regions.push(region);
    }
    grouped.get(region)!.push(toLink(entity, config));
  }

  const sections: ClusterSection[] = regions.map((region) => ({
    heading: region,
    items: grouped.get(region)!,
  }));

  const allLinks = entities.map((entity) => toLink(entity, config));

  return {
    type: config.basePath,
    title: config.collectionLabel,
    description: `${config.collectionLabel}: pelna lista (${entities.length}) w bazie, pogrupowana wedlug regionu.`,
    intro: `Jesli szukasz ${config.entityNoun} w konkretnym regionie, ponizsza lista zawiera wszystkie dostepne obiekty typu ${config.collectionLabel.toLowerCase()}.`,
    canonical: `/${config.basePath}/`,
    count: entities.length,
    sections,
    jsonLd: buildItemList(config.collectionLabel, allLinks, baseUrl),
  };
}

/**
 * Rejestr unikalnych regionow ze wszystkich datasetow.
 * Kolejnosc = pierwsze wystapienie (deterministyczna).
 * Opcjonalny citySeeds gwarantuje, ze region z warstwy seed pojawi sie
 * nawet gdy nie ma jeszcze zadnego POI (np. region bez zaimportowanych danych).
 */
export function listRegions(
  datasets: SitemapLikeDataset[],
  citySeeds: Entity[] = [],
): RegionRef[] {
  const order: string[] = [];
  const counts = new Map<string, number>();

  for (const { entities } of datasets) {
    for (const entity of entities) {
      const region = entity.location?.region;
      if (!region) {
        continue;
      }
      if (!counts.has(region)) {
        counts.set(region, 0);
        order.push(region);
      }
      counts.set(region, counts.get(region)! + 1);
    }
  }

  for (const seed of citySeeds) {
    const region = seed.location?.region;
    if (!region) {
      continue;
    }
    if (!counts.has(region)) {
      counts.set(region, 0);
      order.push(region);
    }
  }

  return order.map((region) => ({
    region,
    slug: slugify(region),
    count: counts.get(region)!,
  }));
}

/** Dataset dla agregacji regionow (encje + konfiguracja typu). */
export interface SitemapLikeDataset {
  entities: Entity[];
  config: TypeConfig;
}

/**
 * Model strony regionu: agreguje wszystkie typy encji dla danego regionu.
 * Grupuje sekcje wedlug typu (collectionLabel). Bez fikcyjnych wartosci.
 * Opcjonalny citySeeds dodaje sekcje "Miasta" (huby) nalezace do regionu.
 */
export function buildRegionModel(
  region: string,
  datasets: SitemapLikeDataset[],
  baseUrl = '',
  citySeeds: Entity[] = [],
): RegionModel {
  const sections: ClusterSection[] = [];
  const allLinks: ClusterLink[] = [];

  const cityItems: ClusterLink[] = citySeeds
    .filter((seed) => seed.location?.region === region)
    .map((seed) => ({
      href: `/city/${seed.slug ?? slugify(seed.location?.city ?? seed.name)}`,
      name: seed.location?.city ?? seed.name,
      city: seed.location?.city ?? seed.name,
      region,
    }));
  if (cityItems.length > 0) {
    sections.push({ heading: 'Miasta', items: cityItems });
    allLinks.push(...cityItems);
  }

  for (const { entities, config } of datasets) {
    const items = entities
      .filter((entity) => entity.location?.region === region)
      .map((entity) => toLink(entity, config));
    if (items.length > 0) {
      sections.push({ heading: config.collectionLabel, items });
      allLinks.push(...items);
    }
  }

  return {
    region,
    slug: slugify(region),
    title: `${region} — miasta i obiekty`,
    description: `Katalog miejsc w regionie ${region}: ${allLinks.length} obiektow pogrupowanych wedlug typu.`,
    intro: `Jesli szukasz miejsc w regionie ${region}, ta strona zbiera wszystkie dostepne miasta-huby oraz obiekty pogrupowane wedlug typu.`,
    canonical: `/region/${slugify(region)}`,
    count: allLinks.length,
    sections,
    jsonLd: buildItemList(`${region} — miejsca`, allLinks, baseUrl),
  };
}

/** Link do bliskego miasta (sekcja "Najblizsze miasta"). */
export interface NearbyCityLink {
  href: string;
  name: string;
  distanceKm: number | null;
}

/** Model strony miasta (/city/{slug}), grupowany wg typu encji. */
export interface CityModel {
  city: string;
  region: string | null;
  slug: string;
  title: string;
  description: string;
  intro: string;
  canonical: string;
  count: number;
  sections: ClusterSection[];
  /** Sekcja "Najblizsze miasta" – budowana z warstwy seed (wspolrzedne). */
  nearbyCities: NearbyCityLink[];
  /** Kolekcje powiazane z miastem. */
  collectionRefs: CollectionRef[];
  jsonLd: Record<string, unknown>;
}

/**
 * Rejestr unikalnych miast ze wszystkich datasetow.
 * Kolejnosc = pierwsze wystapienie (deterministyczna).
 */
export function listCities(datasets: SitemapLikeDataset[]): CityRef[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  const regionOf = new Map<string, string | null>();

  for (const { entities } of datasets) {
    for (const entity of entities) {
      const city = entity.location?.city;
      if (!city) {
        continue;
      }
      if (!counts.has(city)) {
        counts.set(city, 0);
        regionOf.set(city, entity.location?.region ?? null);
        order.push(city);
      }
      counts.set(city, counts.get(city)! + 1);
    }
  }

  return order.map((city) => ({
    city,
    region: regionOf.get(city) ?? null,
    slug: slugify(city),
    count: counts.get(city)!,
  }));
}

/**
 * Buduje liste najblizszych miast (Modul 2 – City Hub Engine).
 * Uzywa warstwy seed (citySeeds) z wspolrzednymi geograficznymi.
 * Zwraca max `limit` miast najblizszych do podanego seedu, z wylaczeniem siebie.
 */
export function buildNearbyCities(
  citySeed: Entity,
  allSeeds: Entity[],
  limit = 5,
): NearbyCityLink[] {
  const sorted = allSeeds
    .filter((s) => s.slug !== citySeed.slug)
    .sort(byDistanceFrom(citySeed));

  return sorted.slice(0, limit).map((s) => {
    const { distanceKm: dist } = byDistanceFromRaw(citySeed, s);
    return {
      href: `/city/${s.slug ?? slugify(s.location?.city ?? s.name)}`,
      name: s.location?.city ?? s.name,
      distanceKm: dist,
    };
  });
}

// Pomocnik inline (nie eksportowany) – zwraca dystans haversine miedzy dwoma seed-encjami.
function byDistanceFromRaw(a: Entity, b: Entity): { distanceKm: number | null } {
  const aC = a.coordinates;
  const bC = b.coordinates;
  if (
    !aC || typeof aC.lat !== 'number' || typeof aC.lng !== 'number' ||
    !bC || typeof bC.lat !== 'number' || typeof bC.lng !== 'number'
  ) {
    return { distanceKm: null };
  }
  const R = 6371;
  const dLat = ((bC.lat - aC.lat) * Math.PI) / 180;
  const dLng = ((bC.lng - aC.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((aC.lat * Math.PI) / 180) *
      Math.cos((bC.lat * Math.PI) / 180) *
      sinLng * sinLng;
  return { distanceKm: 2 * R * Math.asin(Math.min(1, Math.sqrt(h))) };
}

/**
 * Model strony miasta: agreguje wszystkie typy encji dla danego miasta.
 * Grupuje sekcje wedlug typu (collectionLabel). Bez fikcyjnych wartosci.
 * Opcjonalny citySeeds dostarcza region-fallback dla miast-hubow bez POI,
 * dzieki czemu kazdy hub ma strone /city/{slug} nawet przy 0 obiektach.
 * Opcjonalny cityCollections dodaje sekcje kolekcji.
 */
export function buildCityModel(
  city: string,
  datasets: SitemapLikeDataset[],
  baseUrl = '',
  citySeeds: Entity[] = [],
  cityCollections: CollectionRef[] = [],
): CityModel {
  const sections: ClusterSection[] = [];
  const allLinks: ClusterLink[] = [];
  let region: string | null = null;

  const citySlug = slugify(city);
  const seed = citySeeds.find(
    (s) => slugify(s.location?.city ?? s.name) === citySlug,
  );
  if (seed) {
    region = seed.location?.region ?? null;
  }

  for (const { entities, config } of datasets) {
    const matched = entities.filter((entity) => entity.location?.city === city);
    if (matched.length === 0) {
      continue;
    }
    if (region === null) {
      region = matched[0].location?.region ?? null;
    }
    const items = matched.map((entity) => toLink(entity, config));
    sections.push({ heading: config.collectionLabel, items });
    allLinks.push(...items);
  }

  const intro =
    allLinks.length > 0
      ? `Jesli szukasz miejsc w ${city}, ta strona zbiera wszystkie dostepne obiekty pogrupowane wedlug typu.`
      : `${city} to wezel-hub katalogu. Trwa import obiektow (OSM) dla tej miejscowosci.`;

  // Najblizsze miasta z warstwy seed.
  const nearbyCities = seed ? buildNearbyCities(seed, citySeeds) : [];

  return {
    city,
    region,
    slug: citySlug,
    title: `${city} — miejsca i obiekty`,
    description: `Katalog miejsc w miejscowosci ${city}: ${allLinks.length} obiektow pogrupowanych wedlug typu.`,
    intro,
    canonical: `/city/${citySlug}`,
    count: allLinks.length,
    sections,
    nearbyCities,
    collectionRefs: cityCollections,
    jsonLd: buildItemList(`${city} — miejsca`, allLinks, baseUrl),
  };
}
