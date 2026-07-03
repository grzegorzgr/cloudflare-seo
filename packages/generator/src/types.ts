// Wsp\u00f3lne typy dla wszystkich encji SEO (beach, parking, trail).
// Kszta\u0142t danych jest jednolity niezale\u017cnie od typu tematycznego.

export interface EntityFeatures {
  [key: string]: boolean;
}

export interface EntityFaqItem {
  q: string;
  a: string;
}

export interface EntityLocation {
  city?: string;
  region?: string;
  country?: string;
  lat?: number;
  lng?: number;
}

export interface EntitySeo {
  h1?: string;
  title?: string;
  description?: string;
}

export interface Entity {
  slug: string;
  name: string;
  type?: string;
  seo?: EntitySeo;
  location?: EntityLocation;
  features?: EntityFeatures;
  facts?: string[];
  faq?: EntityFaqItem[];
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
  /** Rzeczownik w dope\u0142niaczu do generowanego FAQ, np. "pla\u017cy", "parkingu", "szlaku". */
  entityNoun: string;
}

// Znormalizowany, gotowy do renderowania model strony.
// Warstwa widoku (Astro) nie zawiera \u017cadnej logiki poza wy\u015bwietleniem.
export interface FeatureView {
  label: string;
  value: boolean;
}

export interface LocationView {
  city: string;
  region: string;
  country: string;
}

export interface PageModel {
  slug: string;
  h1: string;
  pageTitle: string;
  metaDescription: string;
  canonical: string;
  facts: string[];
  features: FeatureView[];
  location: LocationView;
  faq: EntityFaqItem[];
  jsonLd: Record<string, unknown>;
}
