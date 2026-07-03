// Warstwa NAWIGACJI / INDEX (GEO GRAPH ENTRY POINTS).
// Buduje deterministyczne modele stron wejsciowych (HOME + index pages),
// ktore sa punktami wejscia do grafu SEO. Wszystko wyprowadzone z /packages/data.
//
// ZASADA BEZWZGLEDNA: zero hardcodowanych list miast/regionow, zero fikcji.
//   - regiony/miasta pochodza z listRegions/listCities + warstwy seed,
//   - kategorie pochodza z TypeConfig (collectionLabel),
//   - trasy index (/cities, /regions, /beaches, ...) to konfiguracja nawigacji,
//     nie dane encji (dozwolone).

import { slugify, stripTrailingSlashes } from './slug.js';
import {
  buildClusterModel,
  listCities,
  listRegions,
  type ClusterLink,
  type SitemapLikeDataset,
} from './clusters.js';
import {
  beachConfig,
  parkingConfig,
  trailConfig,
} from './configs.js';
import { listCitySeeds, mergeCityRefs, type CitySeed } from './cities.js';
import type { Entity, TypeConfig } from './types.js';

const UNKNOWN = 'nieznane';

// --- Stale trasy warstwy index (system entry points) ---
export const HOME_PATH = '/';
export const CITIES_PATH = '/cities';
export const REGIONS_PATH = '/regions';
export const COLLECTIONS_PATH = '/collections';

/** Kategoria = para (trasa index w l. mnogiej, konfiguracja typu). */
export interface CategoryIndex {
  path: string;
  config: TypeConfig;
}

/**
 * Rejestr kategorii dla warstwy index. Trasy w l. mnogiej sa kanonicznymi
 * punktami wejscia; etykiety pochodza z konfiguracji typu (collectionLabel).
 */
export const indexCategories: CategoryIndex[] = [
  { path: '/beaches', config: beachConfig },
  { path: '/parking', config: parkingConfig },
  { path: '/trails', config: trailConfig },
];

// --- Typy modelu index ---
export interface IndexNavLink {
  href: string;
  label: string;
  current: boolean;
}

export interface IndexLink {
  href: string;
  name: string;
  sub?: string;
}

export interface IndexSection {
  heading: string;
  /** Opcjonalny link naglowka sekcji (np. do strony regionu). */
  headingHref?: string;
  items: IndexLink[];
}

export interface IndexModel {
  h1: string;
  title: string;
  description: string;
  canonical: string;
  intro: string;
  nav: IndexNavLink[];
  sections: IndexSection[];
  jsonLd: Record<string, unknown>;
}

// --- JSON-LD (schema.org) helpery ---
function breadcrumbNode(
  items: { name: string; url: string }[],
  baseUrl = '',
): Record<string, unknown> {
  const base = stripTrailingSlashes(baseUrl);
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${base}${it.url}`,
    })),
  };
}

function itemListNode(
  name: string,
  links: { name: string; href: string }[],
  baseUrl = '',
): Record<string, unknown> {
  const base = stripTrailingSlashes(baseUrl);
  return {
    '@type': 'ItemList',
    name,
    numberOfItems: links.length,
    itemListElement: links.map((link, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: link.name,
      url: `${base}${link.href}`,
    })),
  };
}

function graph(nodes: Record<string, unknown>[]): Record<string, unknown> {
  return { '@context': 'https://schema.org', '@graph': nodes };
}

function flatten(sections: IndexSection[]): { name: string; href: string }[] {
  return sections.flatMap((s) => s.items.map((i) => ({ name: i.name, href: i.href })));
}

// --- Nawigacja miedzy stronami index (graph navigation) ---
/**
 * Buduje pasek nawigacji laczacy wszystkie punkty wejscia index.
 * `current` oznacza aktywna trase (renderowana bez linku).
 */
export function buildIndexNav(
  categories: CategoryIndex[],
  current: string,
): IndexNavLink[] {
  const links: IndexNavLink[] = [
    { href: HOME_PATH, label: 'Start', current: current === HOME_PATH },
    { href: CITIES_PATH, label: 'Miasta', current: current === CITIES_PATH },
    { href: REGIONS_PATH, label: 'Regiony', current: current === REGIONS_PATH },
    { href: COLLECTIONS_PATH, label: 'Kolekcje', current: current === COLLECTIONS_PATH },
  ];
  for (const category of categories) {
    links.push({
      href: category.path,
      label: category.config.collectionLabel,
      current: current === category.path,
    });
  }
  return links;
}

// --- Miasta-huby (SEKCJA 2 na HOME) ---
/**
 * Miasta oznaczone tagiem "hub" w warstwie seed. Kolejnosc = kolejnosc danych
 * (deterministyczna). Zero hardcodowania - filtr po tagach z /packages/data.
 */
export function listHubCities(citySeeds: CitySeed[]) {
  return citySeeds
    .filter((seed) => Array.isArray(seed.tags) && seed.tags.includes('hub'))
    .map((seed) => ({
      city: seed.location?.city ?? seed.name,
      region: seed.location?.region ?? null,
      slug: seed.slug ?? slugify(seed.location?.city ?? seed.name),
    }));
}

// --- HOME (GEO GRAPH INDEX NODE) ---
/**
 * Model strony glownej: root grafu SEO. Trzy sekcje (Regiony / Miasta-huby /
 * Kategorie) budowane wylacznie z danych. Bez statycznych list i fikcji.
 */
export function buildHomeModel(
  datasets: SitemapLikeDataset[],
  citySeeds: CitySeed[],
  categories: CategoryIndex[],
  baseUrl = '',
): IndexModel {
  const regions = listRegions(datasets, citySeeds);
  const cityRefs = mergeCityRefs(listCities(datasets), listCitySeeds(citySeeds));
  const hubs = listHubCities(citySeeds);
  const totalEntities = datasets.reduce((sum, d) => sum + d.entities.length, 0);

  const sections: IndexSection[] = [
    {
      heading: 'Regiony',
      headingHref: REGIONS_PATH,
      items: regions.map((r) => ({
        href: `/region/${r.slug}`,
        name: r.region,
        sub: `${r.count} obiektów`,
      })),
    },
    {
      heading: 'Miasta (huby)',
      headingHref: CITIES_PATH,
      items: hubs.map((c) => ({
        href: `/city/${c.slug}`,
        name: c.city,
        sub: c.region ?? undefined,
      })),
    },
    {
      heading: 'Kategorie',
      items: categories.map((c) => ({
        href: c.path,
        name: c.config.collectionLabel,
      })),
    },
  ];

  return {
    h1: 'Katalog miejsc — GEO graf',
    title: 'Katalog miejsc — regiony, miasta i kategorie',
    description: `Punkt wejscia do katalogu: ${regions.length} regiony, ${cityRefs.length} miast, ${totalEntities} obiektow.`,
    canonical: HOME_PATH,
    intro: `Deterministyczny katalog GEO: ${regions.length} regiony, ${cityRefs.length} miast oraz ${totalEntities} obiektow. Wybierz region, miasto lub kategorie, aby przejsc do listy.`,
    nav: buildIndexNav(categories, HOME_PATH),
    sections,
    jsonLd: graph([
      breadcrumbNode([{ name: 'Start', url: HOME_PATH }], baseUrl),
      itemListNode('Katalog miejsc', flatten(sections), baseUrl),
    ]),
  };
}

// --- /cities (wszystkie miasta, grupowanie per region) ---
export function buildCitiesIndexModel(
  datasets: SitemapLikeDataset[],
  citySeeds: CitySeed[],
  categories: CategoryIndex[],
  baseUrl = '',
): IndexModel {
  const cityRefs = mergeCityRefs(listCities(datasets), listCitySeeds(citySeeds));

  const order: string[] = [];
  const grouped = new Map<string, IndexLink[]>();
  for (const ref of cityRefs) {
    const region = ref.region ?? UNKNOWN;
    if (!grouped.has(region)) {
      grouped.set(region, []);
      order.push(region);
    }
    grouped.get(region)!.push({
      href: `/city/${ref.slug}`,
      name: ref.city,
      sub: `${ref.count} obiektów`,
    });
  }

  const sections: IndexSection[] = order.map((region) => ({
    heading: region,
    headingHref: region === UNKNOWN ? undefined : `/region/${slugify(region)}`,
    items: grouped.get(region)!,
  }));

  return {
    h1: 'Miasta',
    title: 'Miasta — pelny indeks katalogu',
    description: `Indeks ${cityRefs.length} miast pogrupowanych wedlug regionu, z linkami do stron miast.`,
    canonical: CITIES_PATH,
    intro: `Pelny indeks ${cityRefs.length} miast w katalogu, pogrupowany wedlug regionu. Kazde miasto prowadzi do listy obiektow (/city/{miasto}).`,
    nav: buildIndexNav(categories, CITIES_PATH),
    sections,
    jsonLd: graph([
      breadcrumbNode(
        [
          { name: 'Start', url: HOME_PATH },
          { name: 'Miasta', url: CITIES_PATH },
        ],
        baseUrl,
      ),
      itemListNode('Miasta', flatten(sections), baseUrl),
    ]),
  };
}

// --- /regions (regiony, grupowanie miast per region) ---
export function buildRegionsIndexModel(
  datasets: SitemapLikeDataset[],
  citySeeds: CitySeed[],
  categories: CategoryIndex[],
  baseUrl = '',
): IndexModel {
  const regions = listRegions(datasets, citySeeds);
  const cityRefs = mergeCityRefs(listCities(datasets), listCitySeeds(citySeeds));

  const sections: IndexSection[] = regions.map((r) => ({
    heading: r.region,
    headingHref: `/region/${r.slug}`,
    items: cityRefs
      .filter((c) => c.region === r.region)
      .map((c) => ({
        href: `/city/${c.slug}`,
        name: c.city,
        sub: `${c.count} obiektów`,
      })),
  }));

  return {
    h1: 'Regiony',
    title: 'Regiony — indeks katalogu',
    description: `Indeks ${regions.length} regionow z miastami przypisanymi do kazdego regionu.`,
    canonical: REGIONS_PATH,
    intro: `Indeks ${regions.length} regionow. Kazdy region prowadzi do strony zbiorczej (/region/{region}) oraz listuje nalezace do niego miasta.`,
    nav: buildIndexNav(categories, REGIONS_PATH),
    sections,
    jsonLd: graph([
      breadcrumbNode(
        [
          { name: 'Start', url: HOME_PATH },
          { name: 'Regiony', url: REGIONS_PATH },
        ],
        baseUrl,
      ),
      itemListNode('Regiony', flatten(sections), baseUrl),
    ]),
  };
}

// --- /beaches, /parking, /trails (kategorie) ---
/**
 * Model index kategorii: pelna lista encji danego typu pogrupowana wg regionu.
 * Reuzywa buildClusterModel (grupowanie + kolejnosc), dokleja nawigacje grafu
 * oraz JSON-LD BreadcrumbList + ItemList. Kanoniczny URL = trasa index (l. mn.).
 */
export function buildCategoryIndexModel(
  entities: Entity[],
  config: TypeConfig,
  path: string,
  categories: CategoryIndex[],
  baseUrl = '',
): IndexModel {
  const cluster = buildClusterModel(entities, config, baseUrl);

  const sections: IndexSection[] = cluster.sections.map((s) => ({
    heading: s.heading,
    headingHref: s.heading === UNKNOWN ? undefined : `/region/${slugify(s.heading)}`,
    items: s.items.map((i: ClusterLink) => ({
      href: i.href,
      name: i.name,
      sub: i.city,
    })),
  }));

  const label = config.collectionLabel;

  return {
    h1: label,
    title: `${label} — indeks katalogu`,
    description: `Pelna lista (${entities.length}) obiektow typu ${label.toLowerCase()} pogrupowana wedlug regionu.`,
    canonical: path,
    intro: `Pelna lista obiektow typu ${label.toLowerCase()} (${entities.length}) pogrupowana wedlug regionu. Kazdy obiekt ma osobna strone.`,
    nav: buildIndexNav(categories, path),
    sections,
    jsonLd: graph([
      breadcrumbNode(
        [
          { name: 'Start', url: HOME_PATH },
          { name: label, url: path },
        ],
        baseUrl,
      ),
      itemListNode(label, flatten(sections), baseUrl),
    ]),
  };
}

// --- /collections (index wszystkich kolekcji automatycznych) ---
/**
 * Model strony indeksu kolekcji automatycznych (/collections).
 * Grupuje kolekcje wg typu (beach/parking/trail).
 */
export function buildCollectionsIndexModel(
  collections: { slug: string; h1: string; count: number; items: { region: string }[] }[],
  categories: CategoryIndex[],
  baseUrl = '',
): IndexModel {
  // Grupuj po prefiksie slug (beach-..., parking-..., trail-...).
  const typeOrder: string[] = [];
  const grouped = new Map<string, { href: string; name: string; sub: string }[]>();

  for (const col of collections) {
    // Wykryj typ na podstawie prefiksu slug.
    let typeKey = 'inne';
    if (col.slug.startsWith('beach')) typeKey = 'Plaże';
    else if (col.slug.startsWith('parking')) typeKey = 'Parkingi';
    else if (col.slug.startsWith('trail')) typeKey = 'Szlaki';

    if (!grouped.has(typeKey)) {
      grouped.set(typeKey, []);
      typeOrder.push(typeKey);
    }
    grouped.get(typeKey)!.push({
      href: `/collection/${col.slug}`,
      name: col.h1,
      sub: `${col.count} obiektów`,
    });
  }

  const sections: IndexSection[] = typeOrder.map((type) => ({
    heading: type,
    items: grouped.get(type)!,
  }));

  return {
    h1: 'Kolekcje',
    title: 'Kolekcje — automatyczne zestawienia obiektów',
    description: `Automatyczne kolekcje tematyczne (${collections.length}): zestawienia wg udogodnień, regionu i miasta.`,
    canonical: COLLECTIONS_PATH,
    intro: `Kolekcje są automatycznie generowane z danych. Każda kolekcja zawiera obiekty spełniające określone kryteria (udogodnienia, region, miasto).`,
    nav: buildIndexNav(categories, COLLECTIONS_PATH),
    sections,
    jsonLd: graph([
      breadcrumbNode(
        [
          { name: 'Start', url: HOME_PATH },
          { name: 'Kolekcje', url: COLLECTIONS_PATH },
        ],
        baseUrl,
      ),
      itemListNode('Kolekcje', flatten(sections), baseUrl),
    ]),
  };
}
