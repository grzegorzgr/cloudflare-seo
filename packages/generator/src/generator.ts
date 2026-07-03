// Deterministyczna logika generowania stron SEO.
// Jedna encja danych -> jeden model strony. Brak losowo\u015bci, brak AI.

import type {  CollectionRef,
  Dataset,  Entity,
  EntityFaqItem,
  FeatureView,
  NearbyLink,
  PageModel,
  TypeConfig,
} from './types.js';
import { buildKeywords } from './keywords.js';
import { byDistanceFrom, distanceKm } from './geo.js';

const UNKNOWN = 'nieznane';
const NO_DATA = 'Brak danych';

/** Maksymalna liczba linków w sekcji "Podobne miejsca". */
const NEARBY_LIMIT = 5;

/**
 * Buduje list\u0119 FAQ deterministycznie.
 * Je\u015bli encja ma zdefiniowane FAQ, u\u017cywa go bez zmian.
 * W przeciwnym razie generuje FAQ z fakt\u00f3w (1 fakt = 1 pytanie/odpowied\u017a).
 */
export function buildFaq(entity: Entity, config: TypeConfig): EntityFaqItem[] {
  if (entity.faq && entity.faq.length > 0) {
    return entity.faq;
  }
  const features = entity.features ?? [];
  return features.map((feature, index) => ({
    q: `Informacja ${index + 1} o ${config.entityNoun} ${entity.name}`,
    a: feature,
  }));
}

/**
 * Buduje zdanie intencji SEO wy\u0142\u0105cznie z danych (typ + lokalizacja).
 * Nie dodaje nowych fakt\u00f3w \u2014 to ramka odpowiadaj\u0105ca na intencj\u0119 wyszukiwania.
 */
export function buildIntent(entity: Entity, config: TypeConfig): string {
  const location = entity.location ?? {};
  const place = location.city || location.region || location.country;
  if (!place) {
    return `Je\u015bli szukasz ${config.entityNoun} \u2014 ta strona zawiera najwa\u017cniejsze informacje.`;
  }
  return `Je\u015bli szukasz ${config.entityNoun} w lokalizacji ${place}, ta strona zawiera najwa\u017cniejsze informacje.`;
}

/**
 * Fallback tytu\u0142u strony, gdy encja nie ma seo.title.
 * Deterministyczny: nazwa encji + g\u0142\u00f3wne s\u0142owo kluczowe (typ + miasto).
 * Nie tworzy nowych fakt\u00f3w \u2014 sk\u0142ada wy\u0142\u0105cznie istniej\u0105ce dane.
 */
export function buildPageTitle(
  entity: Entity,
  keywords: { primary: string },
): string {
  if (!keywords.primary) {
    return entity.name;
  }
  return `${entity.name} \u2013 ${keywords.primary}`;
}

/**
 * Mapuje rekord flag (features/access) na widok, pomijaj\u0105c warto\u015bci null
 * (zasada: brak danych = pomi\u0144). Klucze bez etykiety u\u017cywaj\u0105 surowego klucza.
 */
function mapFlags(
  source: Record<string, boolean | string | null> | null | undefined,
  labels: Record<string, string> | undefined,
  fillMissing = false,
): FeatureView[] {
  if (fillMissing && labels) {
    // Pokazuj WSZYSTKIE zdefiniowane udogodnienia; brak wartosci = "Brak danych".
    return Object.entries(labels).map(([key, label]) => {
      const value = source?.[key];
      return {
        label,
        value: value === null || value === undefined ? NO_DATA : (value as boolean | string),
      };
    });
  }
  return Object.entries(source ?? {})
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ({
      label: labels?.[key] ?? key,
      value: value as boolean | string,
    }));
}

/**
 * Buduje dane strukturalne JSON-LD (schema.org) wy\u0142\u0105cznie z danych encji.
 * Pola bez danych s\u0105 pomijane (zasada: nie zgaduj).
 */
export function buildJsonLd(
  entity: Entity,
  config: TypeConfig,
  faq: EntityFaqItem[],
): Record<string, unknown> {
  const location = entity.location ?? {};
  const coordinates = entity.coordinates;
  const description = entity.seo?.description;

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': config.schemaType,
    name: entity.name,
  };

  if (description) {
    jsonLd.description = description;
  }

  if (location.city || location.region || location.country) {
    jsonLd.address = {
      '@type': 'PostalAddress',
      addressLocality: location.city || undefined,
      addressRegion: location.region || undefined,
      addressCountry: location.country || undefined,
    };
  }

  if (
    typeof coordinates?.lat === 'number' &&
    typeof coordinates?.lng === 'number'
  ) {
    jsonLd.geo = {
      '@type': 'GeoCoordinates',
      latitude: coordinates.lat,
      longitude: coordinates.lng,
    };
  }

  if (faq.length > 0) {
    jsonLd.subjectOf = {
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.a,
        },
      })),
    };
  }

  return jsonLd;
}

/**
 * Buduje sekcje "Podobne miejsca" (GEO GRAPH nearby, LEVEL 1).
 * Deterministyczny algorytm rankingowy wg wymagan graph engine:
 *   Tier 1: ten sam typ + to samo miasto
 *   Tier 2: ten sam typ + ten sam region
 * W obrebie tieru sortowanie po dystansie haversine (najblizsze pierwsze),
 * remisy rozstrzyga slug alfabetycznie -> pelna odtwarzalnosc.
 * Uzywa WYLACZNIE istniejacych encji z datasetu (zero nowych punktow).
 */
export function buildNearby(
  entity: Entity,
  config: TypeConfig,
  allEntities: Entity[],
): NearbyLink[] {
  const city = entity.location?.city ?? null;
  const region = entity.location?.region ?? null;
  if (!city && !region) {
    return [];
  }

  const candidates = allEntities.filter(
    (candidate) => candidate.slug !== entity.slug,
  );

  const sameCity = city
    ? candidates.filter((c) => c.location?.city === city)
    : [];
  const sameRegionOnly = region
    ? candidates.filter(
        (c) =>
          c.location?.region === region &&
          (!city || c.location?.city !== city),
      )
    : [];

  const sortByProximity = byDistanceFrom(entity);
  const ranked = [
    ...sameCity.sort(sortByProximity),
    ...sameRegionOnly.sort(sortByProximity),
  ];

  const seen = new Set<string>();
  const nearby: NearbyLink[] = [];
  for (const candidate of ranked) {
    if (seen.has(candidate.slug)) {
      continue;
    }
    seen.add(candidate.slug);
    nearby.push({
      href: `/${config.basePath}/${candidate.slug}`,
      label: candidate.name,
      city: candidate.location?.city ?? UNKNOWN,
      type: config.basePath,
      distanceKm: distanceKm(entity, candidate),
    });
    if (nearby.length >= NEARBY_LIMIT) {
      break;
    }
  }
  return nearby;
}

/**
 * Modul 1 – Nearby Graph Engine (cross-type).
 * Rozwiazuje entity.graph.nearby (precomputed przez geo-engine) na linki
 * do wszystkich typow encji (beach / parking / trail).
 * Wynik: sekcja "W poblizu" z typem, odlegloscia i linkiem.
 * Zero inference – tylko encje istniejace w datasetach.
 */
export function buildCrossTypeNearby(
  entity: Entity,
  allDatasets: Dataset[],
): NearbyLink[] {
  const keys = entity.graph?.nearby ?? [];
  if (keys.length === 0) return [];

  // Buduj indeks key -> {entity, config} ze wszystkich datasetow.
  const index = new Map<string, { entity: Entity; config: TypeConfig }>();
  for (const { entities, config } of allDatasets) {
    for (const e of entities) {
      index.set(`${config.basePath}/${e.slug}`, { entity: e, config });
    }
  }

  const result: NearbyLink[] = [];
  for (const key of keys) {
    const found = index.get(key);
    if (!found) continue;
    const { entity: target, config } = found;
    result.push({
      href: `/${config.basePath}/${target.slug}`,
      label: target.name,
      city: target.location?.city ?? 'nieznane',
      type: config.basePath,
      distanceKm: distanceKm(entity, target),
    });
  }
  return result;
}

/**
 * Glowna funkcja generatora: encja + konfiguracja typu -> model strony.
 * W pelni deterministyczna: ten sam wejsciowy JSON zawsze daje ten sam model.
 * Opcjonalny `allEntities` (ten sam typ) wlacza sekcje "Podobne miejsca".
 * Opcjonalny `allDatasets` (cross-type) wlacza sekcje "W poblizu".
 * Opcjonalny `entityCollections` wlacza linki do kolekcji.
 */
export function buildPageModel(
  entity: Entity,
  config: TypeConfig,
  allEntities: Entity[] = [],
  allDatasets: Dataset[] = [],
  entityCollections: CollectionRef[] = [],
): PageModel {
  const location = entity.location ?? {};
  const faq = buildFaq(entity, config);
  const keywords = buildKeywords(entity, config);
  const intent = buildIntent(entity, config);

  return {
    slug: entity.slug,
    type: entity.type ?? config.basePath,
    h1: entity.seo?.h1 ?? entity.name,
    pageTitle: entity.seo?.title ?? buildPageTitle(entity, keywords),
    metaDescription: entity.seo?.description ?? intent,
    canonical: `/${config.basePath}/${entity.slug}`,
    intent,
    keywords: keywords.all,
    facts: entity.features ?? [],
    features: mapFlags(entity.amenities, config.featureLabels, true),
    access: mapFlags(entity.access, config.accessLabels),
    location: {
      city: location.city ?? UNKNOWN,
      region: location.region ?? UNKNOWN,
      country: location.country ?? UNKNOWN,
    },
    faq,
    nearby: buildNearby(entity, config, allEntities),
    nearbyPlaces: buildCrossTypeNearby(entity, allDatasets),
    collections: entityCollections,
    jsonLd: buildJsonLd(entity, config, faq),
  };
}

/**
 * Helper dla Astro getStaticPaths(): generuje wszystkie \u015bcie\u017cki SSG
 * ze zbioru encji (jedna encja = jedna strona).
 */
export function toStaticPaths(entities: Entity[]) {
  return entities.map((entity) => ({
    params: { slug: entity.slug },
    props: { entity },
  }));
}
