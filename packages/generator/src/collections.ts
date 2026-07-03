// Modul 3 – Automatic Collection Engine.
// Automatycznie wykrywa kolekcje tematyczne na podstawie istniejacych danych.
// Zero hardkodowanych list – generator sam wykrywa kombinacje.
// Zasada: kolekcja < 3 encji nie jest tworzona.

import { slugify, stripTrailingSlashes } from './slug.js';
import type { CollectionRef, Entity, TypeConfig } from './types.js';
import type { SitemapLikeDataset } from './clusters.js';

/** Minimalna liczba encji w kolekcji. */
const MIN_COLLECTION_SIZE = 3;

/** Element listy w kolekcji. */
export interface CollectionItem {
  href: string;
  name: string;
  city: string;
  region: string;
}

/** FAQ w kolekcji – max 5, budowane z danych. */
export interface CollectionFaqItem {
  q: string;
  a: string;
}

/** Breadcrumb dla JSON-LD. */
export interface Breadcrumb {
  name: string;
  href: string;
}

/** Model strony kolekcji (/collection/{slug}). */
export interface CollectionModel {
  slug: string;
  h1: string;
  title: string;
  description: string;
  intro: string;
  canonical: string;
  count: number;
  items: CollectionItem[];
  faq: CollectionFaqItem[];
  breadcrumbs: Breadcrumb[];
  /** Linki do miast, regionow i powiazanych kolekcji. */
  relatedCities: { href: string; name: string }[];
  relatedRegions: { href: string; name: string }[];
  relatedCollections: CollectionRef[];
  jsonLd: Record<string, unknown>;
}

// --- Wewnetrzne typy definicji kolekcji ---

/**
 * Definicja kolekcji: klucz (unikalny identyfikator logiczny),
 * etykieta H1, opis SEO, predykat filtrujacy encje.
 */
interface CollectionDef {
  /** Unikalny klucz slug (deterministyczny). */
  slugKey: string;
  h1: string;
  description: string;
  filterFn: (entity: Entity) => boolean;
  /** Typ encji (basePath), do ktorego odnosi sie kolekcja. */
  type: string;
}

// --- Helpery ---

function toItem(entity: Entity, config: TypeConfig): CollectionItem {
  return {
    href: `/${config.basePath}/${entity.slug}`,
    name: entity.name,
    city: entity.location?.city ?? 'nieznane',
    region: entity.location?.region ?? 'nieznane',
  };
}

function buildCollectionJsonLd(
  model: Omit<CollectionModel, 'jsonLd'>,
  baseUrl = '',
): Record<string, unknown> {
  const base = stripTrailingSlashes(baseUrl);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: model.breadcrumbs.map((bc, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: bc.name,
          item: `${base}${bc.href}`,
        })),
      },
      {
        '@type': 'ItemList',
        name: model.h1,
        numberOfItems: model.count,
        itemListElement: model.items.map((item, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: item.name,
          url: `${base}${item.href}`,
        })),
      },
      {
        '@type': 'WebPage',
        name: model.title,
        description: model.description,
        url: `${base}${model.canonical}`,
      },
    ],
  };
}

/**
 * Generuje definicje kolekcji dynamicznie na podstawie danych.
 * Kolekcje: amenity=true (per typ), lokalizacja region, lokalizacja miasto.
 * Zero hardkodowania – wszystkie kombinacje wykrywane z danych.
 */
function generateCollectionDefs(
  entities: Entity[],
  config: TypeConfig,
): CollectionDef[] {
  const defs: CollectionDef[] = [];

  // 1) Kolekcje wg amenity/feature (flagi booleowskie = true).
  //    Tylko klucze zdefiniowane w featureLabels (schema-driven).
  const featureKeys = Object.keys(config.featureLabels);
  for (const key of featureKeys) {
    const label = config.featureLabels[key];
    const matching = entities.filter(
      (e) => e.amenities && e.amenities[key] === true,
    );
    if (matching.length < MIN_COLLECTION_SIZE) continue;

    const slugKey = slugify(`${config.basePath}-${key}`);
    defs.push({
      slugKey,
      h1: `${config.collectionLabel} – ${label}`,
      description: `${config.collectionLabel} posiadające udogodnienie: ${label}. Lista ${matching.length} obiektów.`,
      filterFn: (e) => !!(e.amenities && e.amenities[key] === true),
      type: config.basePath,
    });
  }

  // 2) Kolekcje wg regionu.
  const regionCounts = new Map<string, number>();
  for (const e of entities) {
    const r = e.location?.region;
    if (!r) continue;
    regionCounts.set(r, (regionCounts.get(r) ?? 0) + 1);
  }
  for (const [region, count] of regionCounts) {
    if (count < MIN_COLLECTION_SIZE) continue;
    const rSlug = slugify(region);
    const slugKey = slugify(`${config.basePath}-region-${rSlug}`);
    defs.push({
      slugKey,
      h1: `${config.collectionLabel} w ${region}`,
      description: `Wszystkie ${config.collectionLabel.toLowerCase()} w województwie ${region}. Liczba obiektów: ${count}.`,
      filterFn: (e) => e.location?.region === region,
      type: config.basePath,
    });
  }

  // 3) Kolekcje wg miasta.
  const cityCounts = new Map<string, number>();
  for (const e of entities) {
    const c = e.location?.city;
    if (!c) continue;
    cityCounts.set(c, (cityCounts.get(c) ?? 0) + 1);
  }
  for (const [city, count] of cityCounts) {
    if (count < MIN_COLLECTION_SIZE) continue;
    const cSlug = slugify(city);
    const slugKey = slugify(`${config.basePath}-miasto-${cSlug}`);
    defs.push({
      slugKey,
      h1: `${config.collectionLabel} w ${city}`,
      description: `Wszystkie ${config.collectionLabel.toLowerCase()} w miejscowości ${city}. Liczba obiektów: ${count}.`,
      filterFn: (e) => e.location?.city === city,
      type: config.basePath,
    });
  }

  return defs;
}

/**
 * Buduje FAQ dla kolekcji (max 5 Q/A, wylacznie z danych).
 * Pytania dotycza liczby, regionow i udogodnien – zero inference.
 */
function buildCollectionFaq(
  items: CollectionItem[],
  h1: string,
): CollectionFaqItem[] {
  const faq: CollectionFaqItem[] = [];

  faq.push({
    q: `Ile miejsc zawiera kolekcja "${h1}"?`,
    a: `Kolekcja zawiera ${items.length} obiektów.`,
  });

  const regions = [...new Set(items.map((i) => i.region).filter((r) => r !== 'nieznane'))];
  if (regions.length > 0) {
    faq.push({
      q: `W jakich regionach znajdują się te miejsca?`,
      a: `Obiekty pochodzą z następujących regionów: ${regions.join(', ')}.`,
    });
  }

  const cities = [...new Set(items.map((i) => i.city).filter((c) => c !== 'nieznane'))];
  if (cities.length > 0 && cities.length <= 10) {
    faq.push({
      q: `W jakich miastach można znaleźć te obiekty?`,
      a: `Obiekty znajdują się w: ${cities.join(', ')}.`,
    });
  }

  return faq.slice(0, 5);
}

/**
 * Buduje model kolekcji z definicji i listy pasujacych encji.
 */
function buildCollectionModel(
  def: CollectionDef,
  matching: Entity[],
  config: TypeConfig,
  allDefs: CollectionDef[],
  baseUrl = '',
): CollectionModel {
  // Sortowanie alfabetyczne (deterministyczne).
  const sorted = [...matching].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const items = sorted.map((e) => toItem(e, config));

  const relatedCities = [
    ...new Set(items.map((i) => i.city).filter((c) => c !== 'nieznane')),
  ].map((city) => ({ href: `/city/${slugify(city)}`, name: city }));

  const relatedRegions = [
    ...new Set(items.map((i) => i.region).filter((r) => r !== 'nieznane')),
  ].map((region) => ({ href: `/region/${slugify(region)}`, name: region }));

  // Powiazane kolekcje: inne kolekcje tego samego typu.
  const relatedCollections: CollectionRef[] = allDefs
    .filter((d) => d.slugKey !== def.slugKey && d.type === def.type)
    .slice(0, 6)
    .map((d) => ({
      href: `/collection/${d.slugKey}`,
      label: d.h1,
      count: 0, // Uzupelniane po zbudowaniu wszystkich modeli.
    }));

  const breadcrumbs: Breadcrumb[] = [
    { name: 'Start', href: '/' },
    { name: config.collectionLabel, href: `/${config.basePath === 'beach' ? 'beaches' : config.basePath === 'trail' ? 'trails' : 'parking'}` },
    { name: def.h1, href: `/collection/${def.slugKey}` },
  ];

  const faq = buildCollectionFaq(items, def.h1);

  const partial: Omit<CollectionModel, 'jsonLd'> = {
    slug: def.slugKey,
    h1: def.h1,
    title: `${def.h1} – katalog obiektów`,
    description: def.description,
    intro: `Poniższa lista zawiera ${items.length} obiektów spełniających kryteria: ${def.h1}.`,
    canonical: `/collection/${def.slugKey}`,
    count: items.length,
    items,
    faq,
    breadcrumbs,
    relatedCities,
    relatedRegions,
    relatedCollections,
  };

  return {
    ...partial,
    jsonLd: buildCollectionJsonLd(partial, baseUrl),
  };
}

/**
 * Glowna funkcja Modulu 3.
 * Przyjmuje wszystkie datasety, zwraca liste modeli kolekcji.
 * Kolekcje < MIN_COLLECTION_SIZE encji sa pomijane.
 * Dziala automatycznie dla kazdej nowej encji i kazdego nowego pola danych.
 */
export function buildAllCollections(
  datasets: SitemapLikeDataset[],
  baseUrl = '',
): CollectionModel[] {
  const allModels: CollectionModel[] = [];

  for (const { entities, config } of datasets) {
    const defs = generateCollectionDefs(entities, config);

    // Buduj modele – relatedCollections.count uzupelnimy ponizej.
    for (const def of defs) {
      const matching = entities.filter(def.filterFn);
      if (matching.length < MIN_COLLECTION_SIZE) continue;
      const model = buildCollectionModel(def, matching, config, defs, baseUrl);
      allModels.push(model);
    }
  }

  // Uzupelniamy count w relatedCollections (po zbudowaniu wszystkich modeli).
  const countBySlug = new Map(allModels.map((m) => [m.slug, m.count]));
  for (const model of allModels) {
    for (const ref of model.relatedCollections) {
      const refSlug = ref.href.replace('/collection/', '');
      ref.count = countBySlug.get(refSlug) ?? 0;
    }
    // Usuwamy related z count=0 (kolekcja nieistniejaca lub za mala).
    model.relatedCollections = model.relatedCollections.filter((r) => r.count >= MIN_COLLECTION_SIZE);
  }

  return allModels;
}

/**
 * Wyszukuje kolekcje, do ktorych nalezy encja (cross-reference).
 * Uzywane przez buildPageModel do sekcji "Kolekcje".
 */
export function findEntityCollections(
  entity: Entity,
  config: TypeConfig,
  allCollections: CollectionModel[],
): CollectionRef[] {
  return allCollections
    .filter(
      (col) =>
        col.items.some((item) => item.href === `/${config.basePath}/${entity.slug}`),
    )
    .map((col) => ({
      href: col.canonical,
      label: col.h1,
      count: col.count,
    }));
}

/**
 * Buduje zbiorczy CollectionRef[] dla sitemap i nawigacji.
 */
export function listCollectionRefs(collections: CollectionModel[]): CollectionRef[] {
  return collections.map((col) => ({
    href: col.canonical,
    label: col.h1,
    count: col.count,
  }));
}
