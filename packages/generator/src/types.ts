// Wsp\u00f3lne typy dla wszystkich encji SEO (beach, parking, trail).
// Kszta\u0142t danych jest jednolity niezale\u017cnie od typu tematycznego.

export interface EntityFeatures {
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
  access?: EntityAccess | null;
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
  /** Mapowanie kluczy dost\u0119pu (access) na etykiety, np. public_transport -> Komunikacja miejska. */
  accessLabels?: Record<string, string>;
  /** Rzeczownik w dope\u0142niaczu do generowanego FAQ i sekcji intent, np. "pla\u017cy", "parkingu", "szlaku". */
  entityNoun: string;
}

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

// Link do pokrewnej encji (ten sam typ i region). Budowany 1:1 z danych.
export interface NearbyLink {
  href: string;
  label: string;
  city: string;
}

export interface PageModel {
  slug: string;
  type: string;
  h1: string;
  pageTitle: string;
  metaDescription: string;
  canonical: string;
  intent: string;
  facts: string[];
  features: FeatureView[];
  access: FeatureView[];
  location: LocationView;
  faq: EntityFaqItem[];
  nearby: NearbyLink[];
  jsonLd: Record<string, unknown>;
}
