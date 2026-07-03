// Deterministyczna logika generowania stron SEO.
// Jedna encja danych -> jeden model strony. Brak losowo\u015bci, brak AI.

import type {
  Entity,
  EntityFaqItem,
  PageModel,
  TypeConfig,
} from './types.js';

const UNKNOWN = 'nieznane';

/**
 * Buduje list\u0119 FAQ deterministycznie.
 * Je\u015bli encja ma zdefiniowane FAQ, u\u017cywa go bez zmian.
 * W przeciwnym razie generuje FAQ z fakt\u00f3w (1 fakt = 1 pytanie/odpowied\u017a).
 */
export function buildFaq(entity: Entity, config: TypeConfig): EntityFaqItem[] {
  if (entity.faq && entity.faq.length > 0) {
    return entity.faq;
  }
  const facts = entity.facts ?? [];
  return facts.map((fact, index) => ({
    q: `Informacja ${index + 1} o ${config.entityNoun} ${entity.name}`,
    a: fact,
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

  if (typeof location.lat === 'number' && typeof location.lng === 'number') {
    jsonLd.geo = {
      '@type': 'GeoCoordinates',
      latitude: location.lat,
      longitude: location.lng,
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
 * G\u0142\u00f3wna funkcja generatora: encja + konfiguracja typu -> model strony.
 * W pe\u0142ni deterministyczna: ten sam wej\u015bciowy JSON zawsze daje ten sam model.
 */
export function buildPageModel(entity: Entity, config: TypeConfig): PageModel {
  const location = entity.location ?? {};
  const faq = buildFaq(entity, config);

  const features = Object.entries(entity.features ?? {}).map(([key, value]) => ({
    label: config.featureLabels[key] ?? key,
    value,
  }));

  return {
    slug: entity.slug,
    h1: entity.seo?.h1 ?? entity.name,
    pageTitle: entity.seo?.title ?? entity.name,
    metaDescription: entity.seo?.description ?? '',
    canonical: `/${config.basePath}/${entity.slug}`,
    facts: entity.facts ?? [],
    features,
    location: {
      city: location.city ?? UNKNOWN,
      region: location.region ?? UNKNOWN,
      country: location.country ?? UNKNOWN,
    },
    faq,
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
