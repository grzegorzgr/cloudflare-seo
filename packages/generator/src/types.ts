// Wsp\u00f3lne typy dla wszystkich encji SEO (beach, parking, trail).
// Kszta\u0142t danych jest jednolity niezale\u017cnie od typu tematycznego.

// Udogodnienia jako s\u0142ownik flag (boolean | string | null).
// null = brak danych (zasada: nie zgaduj).
export interface EntityAmenities {
  [key: string]: boolean | string | null;
}

export interface EntityAccess {
  [key: string]: boolean | null;
}

export interface EntityFaqItem {
  q: string;
  a: string;
}

export interface EntityLocation {
  city?: string | null;
  region?: string | null;
  country?: string | null;
}

// Adres strukturalny wywiedziony wyłącznie z tagów OSM addr:* (zero inference).
export interface EntityAddress {
  street?: string | null;
  housenumber?: string | null;
  postcode?: string | null;
  city?: string | null;
}

export interface EntityCoordinates {
  lat: number | null;
  lng: number | null;
}

export interface EntitySeo {
  h1?: string;
  title?: string;
  description?: string;
}

export interface Entity {
  id?: string;
  slug: string;
  name: string;
  type?: string;
  /** Identyfikator OSM (np. "node/123"), jesli encja pochodzi z OpenStreetMap. */
  osmId?: string | null;
  seo?: EntitySeo | null;
  location?: EntityLocation;
  /** Adres strukturalny (addr:* z OSM). null = brak danych. */
  address?: EntityAddress | null;
  coordinates?: EntityCoordinates;
  description?: string | null;
  features?: string[];
  amenities?: EntityAmenities;
  tags?: string[];
  access?: EntityAccess | null;
  faq?: EntityFaqItem[];
  /**
   * Graf GEO: precomputed adjacency z geo-engine (budowany w czasie builda).
   * nearby = lista kluczy cross-type, np. ["beach/brzezno", "trail/szlak-x"].
   */
  graph?: {
    nearby?: string[];
  } | null;
}

// Para encji + jej konfiguracja typu. Podstawowa jednostka rejestru danych
// uzywana przez sitemap, cluster, graph i nearby (cross-type).
export interface Dataset {
  entities: Entity[];
  config: TypeConfig;
}

// Konfiguracja per typ tematyczny. Steruje deterministycznie:
// - typem schema.org (@type),
// - etykietami cech (klucz -> tekst PL),
// - rzeczownikiem u\u017cywanym w automatycznie generowanym FAQ.
export interface TypeConfig {
  /** Bazowa \u015bcie\u017cka routingu, np. "beach" -> /beach/[slug]. */
  basePath: string;
  /** schema.org @type, np. "Beach", "ParkingFacility", "TouristAttraction". */
  schemaType: string;
  /** Mapowanie kluczy cech na etykiety wy\u015bwietlane u\u017cytkownikowi. */
  featureLabels: Record<string, string>;
  /** Mapowanie kluczy dost\u0119pu (access) na etykiety, np. public_transport -> Komunikacja miejska. */
  accessLabels?: Record<string, string>;
  /** Rzeczownik w dope\u0142niaczu do generowanego FAQ i sekcji intent, np. "pla\u017cy", "parkingu", "szlaku". */
  entityNoun: string;  /** Rzeczownik w mianowniku (l. poj.) do keyword mappingu, np. "plaża", "parking", "szlak". */
  keywordNoun: string;
  /** Etykieta kolekcji (l. mn.) do stron cluster, np. "Plaże", "Parkingi", "Szlaki". */
  collectionLabel: string;}

// Znormalizowany, gotowy do renderowania model strony.
// Warstwa widoku (Astro) nie zawiera \u017cadnej logiki poza wy\u015bwietleniem.
export interface FeatureView {
  label: string;
  value: boolean | string;
}

export interface LocationView {
  city: string;
  region: string;
  country: string;
}

// Sformatowany adres gotowy do renderowania. null-owe pola pomijane w formatted.
export interface AddressView {
  street: string | null;
  housenumber: string | null;
  postcode: string | null;
  city: string | null;
  /** Jednoliniowy adres, np. "Aleja Krakowska 100, 02-256 Warszawa". */
  formatted: string;
}

// Link do pokrewnej encji (ten sam typ i region). Budowany 1:1 z danych.
export interface NearbyLink {
  href: string;
  label: string;
  city: string;
  /** Typ encji docelowej (basePath), np. "beach". */
  type?: string;
  /** Odleglosc w km od encji zrodlowej, jesli obie maja wspolrzedne. */
  distanceKm?: number | null;
}

/** Link do kolekcji (collection page). */
export interface CollectionRef {
  href: string;
  label: string;
  count: number;
}

export interface PageModel {
  slug: string;
  type: string;
  h1: string;
  pageTitle: string;
  metaDescription: string;
  canonical: string;
  /** true, gdy encja nie ma opisu ani zadnej wypelnionej cechy (thin content). */
  noindex: boolean;
  intent: string;
  keywords: string[];
  facts: string[];
  features: FeatureView[];
  access: FeatureView[];
  location: LocationView;
  /** Adres strukturalny z danych OSM (addr:*), null gdy brak. */
  address: AddressView | null;
  /** Link do Google Maps wywiedziony ze współrzędnych, null gdy brak. */
  googleMapsUrl: string | null;
  faq: EntityFaqItem[];
  nearby: NearbyLink[];
  /** W pobliżu: cross-type encje z entity.graph.nearby (precomputed). */
  nearbyPlaces: NearbyLink[];
  /** Kolekcje, do których należy ta encja. */
  collections: CollectionRef[];
  jsonLd: Record<string, unknown>;
}
