// Deterministyczna logika generowania stron SEO.
// Jedna encja danych -> jeden model strony. Brak losowo\u015bci, brak AI.

import type {  CollectionRef,
  Dataset,  Entity,
  EntityAddress,
  EntityCoordinates,
  EntityFaqItem,
  AddressView,
  FeatureView,
  NearbyLink,
  PageModel,
  TypeConfig,
} from './types.js';
import { buildKeywords } from './keywords.js';
import { byDistanceFrom, distanceKm } from './geo.js';
import { withTrailingSlash } from './slug.js';

const UNKNOWN = 'nieznane';

/** Liczba wypelnionych sygnalow tresci (cechy + udogodnienia) encji. */
function richSignalCount(entity: Entity): number {
  const featureCount = (entity.features ?? []).length;
  const amenityCount = Object.values(entity.amenities ?? {}).filter(
    (value) => value !== null && value !== undefined,
  ).length;
  return featureCount + amenityCount;
}

/** Minimalna liczba wypelnionych sygnalow (cechy + udogodnienia), gdy brak opisu. */
const MIN_SIGNALS_WITHOUT_DESCRIPTION = 3;

/**
 * Prog "wystarczajacych danych" do indeksowania strony encji.
 * Strona bez opisu i bez co najmniej kilku wypelnionych cech/udogodnien jest
 * w praktyce cienka tresc (thin content) na skale tysiecy stron — dokladnie
 * to, co AdSense i Google Search flaguja jako auto-generated low value
 * content. Taka strona zostaje wygenerowana (bez fikcji w danych), ale
 * oznaczona jako noindex i wykluczona z sitemap, dopoki dane sie nie
 * uzupelnia.
 */
export function hasSufficientContent(entity: Entity): boolean {
  if (entity.seo?.description || entity.description) {
    return true;
  }
  return richSignalCount(entity) >= MIN_SIGNALS_WITHOUT_DESCRIPTION;
}

/**
 * Polska odmiana rzeczownika po liczebniku: 2-4 (i x2-x4 poza 12-14) -> forma
 * "few" (np. "plaże"), reszta -> forma "many" (np. "plaż"). Deterministyczna.
 */
function polishPlural(n: number, forms: { few: string; many: string }): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
    return forms.few;
  }
  return forms.many;
}

/** Formatuje odleglosc w km na czytelny tekst: <1 km -> metry, >=1 km -> "x,y km". */
function formatDistance(km: number): string {
  if (km < 1) return `ok. ${Math.round(km * 1000)} m`;
  return `ok. ${km.toFixed(1).replace('.', ',')} km`;
}

/**
 * Zdania faktograficzne wyprowadzone deterministycznie z grafu GEO.
 * Kazde zdanie sklada wylacznie istniejace dane (odleglosci, liczebnosc) -
 * zero nowych faktow, ale tekst jest unikalny per strona (thin content fix).
 */
export function buildDerivedFacts(
  entity: Entity,
  config: TypeConfig,
  allEntities: Entity[],
  nearbyPlaces: NearbyLink[],
  allDatasets: Dataset[] = [],
): string[] {
  const facts: string[] = [];

  // Najblizsza encja kazdego INNEGO typu (z precomputed grafu geo-engine).
  // Fraza ("Najblizszy parking w katalogu") pochodzi z configu typu docelowego.
  const seenTypes = new Set<string>();
  for (const place of nearbyPlaces) {
    if (!place.type || place.type === config.basePath) continue;
    if (seenTypes.has(place.type)) continue;
    seenTypes.add(place.type);
    if (place.distanceKm === null || place.distanceKm === undefined) continue;
    const targetConfig = allDatasets.find(
      (d) => d.config.basePath === place.type,
    )?.config;
    if (!targetConfig?.nearestPhrase) continue;
    facts.push(
      `${targetConfig.nearestPhrase}: ${place.label} (${formatDistance(place.distanceKm)}).`,
    );
    if (facts.length >= 2) break;
  }

  // Liczebnosc tego samego typu w tym samym miescie (wlacznie z ta encja).
  const city = entity.location?.city;
  if (city && config.countForms) {
    const count = allEntities.filter((e) => e.location?.city === city).length;
    if (count >= 2) {
      facts.push(
        `W miejscowości ${city} nasz katalog obejmuje ${count} ${polishPlural(count, config.countForms)} tego typu.`,
      );
    }
  }

  return facts;
}

/** Zoom kafelka mapy OSM dla stron encji. */
const MAP_TILE_ZOOM = 15;

/**
 * Wyznacza kafelek OSM (slippy map) dla wspolrzednych encji oraz pozycje
 * pinezki wewnatrz kafelka (w %). Deterministyczne; null bez wspolrzednych.
 */
export function buildMapTile(
  coordinates?: EntityCoordinates,
): { url: string; pinXPct: number; pinYPct: number } | null {
  const lat = coordinates?.lat;
  const lng = coordinates?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const z = MAP_TILE_ZOOM;
  const n = 2 ** z;
  const xFloat = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xFloat);
  const y = Math.floor(yFloat);
  return {
    url: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    pinXPct: Math.round((xFloat - x) * 1000) / 10,
    pinYPct: Math.round((yFloat - y) * 1000) / 10,
  };
}

/** Maksymalna liczba linków w sekcji "Podobne miejsca". */
const NEARBY_LIMIT = 5;

/**
 * Buduje list\u0119 FAQ deterministycznie.
 * Zwraca WYL\u0104CZNIE realne FAQ zdefiniowane w danych encji (entity.faq).
 * Brak generowania syntetycznych pyta\u0144 z cech ("Informacja N o...") \u2014
 * takie sztuczne FAQ + FAQPage schema.org na skali tysi\u0119cy stron to
 * dokladnie profil "auto-generated low value content" flagowany przez
 * AdSense/Google, a nie prawdziwe FAQ.
 */
export function buildFaq(entity: Entity, _config: TypeConfig): EntityFaqItem[] {
  return entity.faq ?? [];
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
  name: string,
  keywords: { primary: string },
): string {
  if (!keywords.primary) {
    return name;
  }
  return `${name} – ${keywords.primary}`;
}

// Nazwy zbyt ogólne / kodowe (np. "P8", "P-8", "Parking płatny", "BIS"),
// które same z siebie nie mówią użytkownikowi gdzie jest parking.
// Takie nazwy wzbogacamy o adres / operatora / miasto — WYŁĄCZNIE z danych.
const GENERIC_NAME_PATTERNS: RegExp[] = [
  /^p[\s-]?\d+/i, // P8, P-8, P 8, P3 A, P2 długoterminowy
  /^parking\s*\d+$/i, // Parking 4
  /^parking\s+(płatny|premium|piętrowy|podziemny|strzeżony)$/i,
  /^parking$/i,
  /^bis$/i,
];
function isGenericName(name: string): boolean {
  const n = name.trim();
  if (n.length <= 3) return true;
  return GENERIC_NAME_PATTERNS.some((re) => re.test(n));
}

// Wyciąga operatora z listy feature'ów ("operator: X") — realny tag OSM.
function operatorFromFeatures(features?: string[]): string | null {
  for (const f of features ?? []) {
    const m = /^operator:\s*(.+)$/i.exec(f);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Formatuje adres strukturalny do jednej linii, np. "Aleja Krakowska 100, 02-256 Warszawa".
 * Pola bez danych są pomijane. Zwraca null, gdy adres pusty.
 */
export function formatAddress(address?: EntityAddress | null): string | null {
  if (!address) return null;
  const line1 = [address.street, address.housenumber].filter(Boolean).join(' ').trim();
  const line2 = [address.postcode, address.city].filter(Boolean).join(' ').trim();
  const formatted = [line1, line2].filter(Boolean).join(', ').trim();
  return formatted.length > 0 ? formatted : null;
}

function buildAddressView(address?: EntityAddress | null): AddressView | null {
  const formatted = formatAddress(address);
  if (!formatted) return null;
  return {
    street: address?.street ?? null,
    housenumber: address?.housenumber ?? null,
    postcode: address?.postcode ?? null,
    city: address?.city ?? null,
    formatted,
  };
}

/**
 * Buduje deterministyczny link do Google Maps ze współrzędnych encji.
 * Zwraca null, gdy brak współrzędnych (zasada: brak danych = brak linku).
 */
export function buildGoogleMapsUrl(coordinates?: EntityCoordinates): string | null {
  const lat = coordinates?.lat;
  const lng = coordinates?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * Buduje czytelną nazwę wyświetlaną (H1/title/meta).
 * Dla nazw opisowych zwraca oryginał bez zmian.
 * Dla nazw ogólnych/kodowych (np. "P8") wzbogaca je o realne dane:
 *   z adresem:    "Parking P8, Aleja Krakowska 100, Warszawa"
 *   bez adresu:   "Parking P8 – {operator}, Warszawa" lub "Parking P8, Warszawa"
 * ZERO halucynacji — wszystkie człony pochodzą wyłącznie z danych encji.
 */
export function buildDisplayName(entity: Entity, config: TypeConfig): string {
  const rawName = (entity.name ?? '').trim();
  if (!isGenericName(rawName)) return rawName;

  let label = rawName;
  if (config.basePath === 'parking' && !/parking/i.test(rawName)) {
    label = `Parking ${rawName}`;
  }

  const addr = entity.address ?? null;
  const streetLine = [addr?.street, addr?.housenumber].filter(Boolean).join(' ').trim();
  const city = addr?.city ?? entity.location?.city ?? null;

  const parts: string[] = [];
  if (streetLine) {
    parts.push(label, streetLine);
    if (city) parts.push(city);
  } else {
    const operator = operatorFromFeatures(entity.features);
    if (operator && !label.toLowerCase().includes(operator.toLowerCase())) {
      parts.push(`${label} – ${operator}`);
    } else {
      parts.push(label);
    }
    if (city) parts.push(city);
  }
  return parts.join(', ');
}

/**
 * Mapuje rekord flag (features/access) na widok, pomijaj\u0105c warto\u015bci null
 * (zasada: brak danych = pomi\u0144). Klucze bez etykiety u\u017cywaj\u0105 surowego klucza.
 */
function mapFlags(
  source: Record<string, boolean | string | null> | null | undefined,
  labels: Record<string, string> | undefined,
): FeatureView[] {
  // Tylko realne wartosci z danych i tylko klucze ze zdefiniowana etykieta
  // (schema-driven). Zadnych wierszy "Brak danych" - brak danych = brak wiersza.
  return Object.entries(source ?? {})
    .filter(([key, value]) =>
      value !== null && value !== undefined && (!labels || key in labels),
    )
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

  if (location.city || location.region || location.country || entity.address) {
    const streetAddress = [entity.address?.street, entity.address?.housenumber]
      .filter(Boolean)
      .join(' ')
      .trim();
    jsonLd.address = {
      '@type': 'PostalAddress',
      streetAddress: streetAddress || undefined,
      postalCode: entity.address?.postcode || undefined,
      addressLocality: location.city || entity.address?.city || undefined,
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
    const mapUrl = buildGoogleMapsUrl(coordinates);
    if (mapUrl) {
      jsonLd.hasMap = mapUrl;
    }
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
      href: withTrailingSlash(`/${config.basePath}/${candidate.slug}`),
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
      href: withTrailingSlash(`/${config.basePath}/${target.slug}`),
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
  const displayName = buildDisplayName(entity, config);
  const addressView = buildAddressView(entity.address);
  const googleMapsUrl = buildGoogleMapsUrl(entity.coordinates);

  // Fallback meta description (gdy encja nie ma seo.description): składa
  // wyłącznie istniejące dane (display name + lokalizacja) — zero halucynacji.
  const metaPlace = location.city ?? location.region ?? null;
  const metaFallback = `Informacje o ${config.entityNoun} „${displayName}”${
    metaPlace ? ` w lokalizacji ${metaPlace}` : ''
  }: lokalizacja, dojazd i udogodnienia.`;

  const nearbyPlaces = buildCrossTypeNearby(entity, allDatasets);

  // Opis z danych: natywny opis OSM (jesli jest) + fakty tekstowe z tagow.
  const facts = [
    ...(entity.description ? [entity.description] : []),
    ...(entity.features ?? []),
  ];

  return {
    slug: entity.slug,
    type: entity.type ?? config.basePath,
    h1: entity.seo?.h1 ?? displayName,
    pageTitle: entity.seo?.title ?? buildPageTitle(displayName, keywords),
    metaDescription: entity.seo?.description ?? metaFallback,
    canonical: withTrailingSlash(`/${config.basePath}/${entity.slug}`),
    noindex: !hasSufficientContent(entity),
    intent,
    keywords: keywords.all,
    facts,
    derivedFacts: buildDerivedFacts(entity, config, allEntities, nearbyPlaces, allDatasets),
    features: mapFlags(entity.amenities, config.featureLabels),
    access: mapFlags(entity.access, config.accessLabels),
    location: {
      city: location.city ?? UNKNOWN,
      region: location.region ?? UNKNOWN,
      country: location.country ?? UNKNOWN,
    },
    address: addressView,
    googleMapsUrl,
    mapTile: buildMapTile(entity.coordinates),
    faq,
    nearby: buildNearby(entity, config, allEntities),
    nearbyPlaces,
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
