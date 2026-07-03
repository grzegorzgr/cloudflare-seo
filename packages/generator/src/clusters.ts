// Cluster pages: strony agregacyjne wg typu (/{type}/) oraz regionu (/region/{slug}).
// Wszystko wyprowadzone deterministycznie z /packages/data. Bez nowych danych.

import { slugify } from './slug.js';
import type { Entity, TypeConfig } from './types.js';

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
  const base = baseUrl.replace(/\/+$/, '');
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
 */
export function listRegions(datasets: SitemapLikeDataset[]): RegionRef[] {
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
 */
export function buildRegionModel(
  region: string,
  datasets: SitemapLikeDataset[],
  baseUrl = '',
): RegionModel {
  const sections: ClusterSection[] = [];
  const allLinks: ClusterLink[] = [];

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
    title: `${region} — miejsca i obiekty`,
    description: `Katalog miejsc w regionie ${region}: ${allLinks.length} obiektow pogrupowanych wedlug typu.`,
    intro: `Jesli szukasz miejsc w regionie ${region}, ta strona zbiera wszystkie dostepne obiekty pogrupowane wedlug typu.`,
    canonical: `/region/${slugify(region)}`,
    count: allLinks.length,
    sections,
    jsonLd: buildItemList(`${region} — miejsca`, allLinks, baseUrl),
  };
}
