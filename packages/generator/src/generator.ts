// Deterministyczna logika generowania stron SEO.
// Jedna encja danych -> jeden model strony. Brak losowo\u015bci, brak AI.

import type {
  Entity,
  EntityFaqItem,
  FeatureView,
  NearbyLink,
  PageModel,
  TypeConfig,
} from './types.js';
import { buildKeywords } from './keywords.js';

const UNKNOWN = 'nieznane';

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
): FeatureView[] {
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
 * Buduje sekcj\u0119 "Podobne miejsca": encje tego samego typu i regionu,
 * z pomini\u0119ciem bie\u017c\u0105cej. Kolejno\u015b\u0107 wynika z porz\u0105dku datasetu (deterministyczna).
 */
export function buildNearby(
  entity: Entity,
  config: TypeConfig,
  allEntities: Entity[],
): NearbyLink[] {
  const region = entity.location?.region;
  if (!region) {
    return [];
  }
  return allEntities
    .filter(
      (candidate) =>
        candidate.slug !== entity.slug &&
        candidate.location?.region === region,
    )
    .slice(0, NEARBY_LIMIT)
    .map((candidate) => ({
      href: `/${config.basePath}/${candidate.slug}`,
      label: candidate.name,
      city: candidate.location?.city ?? UNKNOWN,
    }));
}

/**
 * G\u0142\u00f3wna funkcja generatora: encja + konfiguracja typu -> model strony.
 * W pe\u0142ni deterministyczna: ten sam wej\u015bciowy JSON zawsze daje ten sam model.
 * Opcjonalny `allEntities` (ten sam typ) w\u0142\u0105cza sekcj\u0119 "Podobne miejsca".
 */
export function buildPageModel(
  entity: Entity,
  config: TypeConfig,
  allEntities: Entity[] = [],
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
    features: mapFlags(entity.amenities, config.featureLabels),
    access: mapFlags(entity.access, config.accessLabels),
    location: {
      city: location.city ?? UNKNOWN,
      region: location.region ?? UNKNOWN,
      country: location.country ?? UNKNOWN,
    },
    faq,
    nearby: buildNearby(entity, config, allEntities),
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
