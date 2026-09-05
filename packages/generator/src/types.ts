// Typy danych (packages/data) i kontrakt modeli widoku.
// Dane sa generowane przez scripts/build/geo-engine.mjs; widok (Astro) renderuje
// wylacznie gotowe modele z tego pakietu. Zero logiki danych w widoku.

export type EntityType = 'parking' | 'beach' | 'trail';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Referencja do obiektu OSM + metadane edycji (provenance). */
export interface OsmRef {
  type: 'node' | 'way' | 'relation';
  id: number;
  /** Data ostatniej edycji obiektu w OSM (ISO). */
  timestamp: string | null;
  version: number | null;
  /** Tag check_date / survey:date — data weryfikacji w terenie. */
  checkDate: string | null;
}

export interface EntityLocation {
  /** Miejscowosc: jawny addr:city albo miasto-hub, gdy obiekt lezy blisko (<=12 km). */
  city: string | null;
  region: string | null;
  /** Slug miasta-huba (strona /city/{hub}/), null gdy poza zasiegiem hubow. */
  hubSlug: string | null;
  hubDistanceKm: number | null;
}

export interface EntityAddress {
  street?: string | null;
  housenumber?: string | null;
  postcode?: string | null;
  city?: string | null;
}

/** Powiazanie przestrzenne: klucz "type/slug" + odleglosc (km, null dla relacji hierarchicznych). */
export interface RelItem {
  key: string;
  km: number | null;
}

export interface EntityRel {
  parkings: RelItem[];
  beaches: RelItem[];
  trails: RelItem[];
  cities: RelItem[];
  /** Szlaki skladowe (superroute -> czlony). */
  parts?: RelItem[];
  /** Szlaki nadrzedne. */
  parents?: RelItem[];
}

/** Wyniki obliczen geometrycznych dla szlaku (OSM relation route=*). */
export interface TrailComputed {
  lengthKm: number | null;
  wayCount: number;
  isLoop: boolean;
  /** Przebieg w OSM sklada sie z rozlacznych czesci (po sklejeniu luk < 120 m). */
  fragmented: boolean;
  /** Jeden spojny przebieg z odgalezieniami (wiecej niz 2 konce). */
  branched?: boolean;
  superroute: boolean;
  start: LatLng | null;
  end: LatLng | null;
  /** [minLat, minLng, maxLat, maxLng] */
  bbox: number[] | null;
  pointCount: number;
}

export type AttrValue = string | string[];

export interface Entity {
  slug: string;
  name: string;
  type: EntityType;
  source: 'osm' | 'curated' | 'curated+osm';
  osm: OsmRef | null;
  location: EntityLocation;
  address: EntityAddress | null;
  coordinates: LatLng;
  /** Opis z tagu OSM `description` albo z pliku curated. Nigdy generowany. */
  description: string | null;
  /** Krotkie notatki redakcyjne (curated). */
  notes: string[];
  /** Surowe wartosci tagow OSM (klucze znormalizowane), tlumaczone dopiero w widoku. */
  attrs: Record<string, AttrValue>;
  computed?: TrailComputed | null;
  rel: EntityRel;
}

export interface CitySeed {
  slug: string;
  name: string;
  type: 'city';
  location: { city: string; region: string; country?: string };
  coordinates: LatLng;
  tags: string[];
}

export interface RegionSeed {
  region: string;
  slug: string;
  capital: string;
  coordinates: LatLng;
  citySeeds: number;
}

export interface DatasetMeta {
  version: number;
  generatedAt: string;
  osmDataFrom: string | null;
  osmDataTo: string | null;
  counts: Record<string, number>;
  sources: Record<string, Record<string, { fetchedAt: string; osmBase: string | null; elements: number }>>;
  curatedMerged?: number;
}

export interface TrailGeometry {
  bbox: number[] | null;
  lines: [number, number][][];
}

/** Komplet danych wczytany raz na build. */
export interface DataBundle {
  parkings: Entity[];
  beaches: Entity[];
  trails: Entity[];
  cities: CitySeed[];
  regions: RegionSeed[];
  meta: DatasetMeta;
  geometry: Record<string, TrailGeometry>;
}

// --- Modele widoku ------------------------------------------------------------

export interface Crumb {
  name: string;
  href: string;
}

export interface Fact {
  label: string;
  value: string;
  href?: string;
  /** Dodatkowy kontekst, np. surowy zapis OSM albo "wartosc obliczona". */
  note?: string;
}

export interface FactGroup {
  heading: string;
  facts: Fact[];
}

export interface LinkItem {
  href: string;
  title: string;
  /** Krotka informacja pod tytulem (np. miasto, typ). */
  sub?: string;
  /** Wartosc po prawej (np. odleglosc, dlugosc). */
  meta?: string;
}

export interface Section {
  id: string;
  heading: string;
  intro?: string;
  items: LinkItem[];
  more?: { href: string; label: string };
}

export interface TableModel {
  id: string;
  heading: string;
  intro?: string;
  columns: string[];
  rows: { cells: (string | { href: string; text: string })[] }[];
}

export interface StaticMapModel {
  zoom: number;
  cols: number;
  rows: number;
  /** URL kafelkow wiersz po wierszu. */
  tiles: string[][];
  widthPx: number;
  heightPx: number;
  pin: { x: number; y: number } | null;
  /** Sciezki SVG (atrybut d) w pikselach mapy. */
  paths: string[];
  markers: { x: number; y: number; label: string }[];
  osmUrl: string;
  googleUrl: string;
  alt: string;
}

export interface Provenance {
  sourceLabel: string;
  osmUrl: string | null;
  osmLabel: string | null;
  lastEdit: string | null;
  checkDate: string | null;
  datasetDate: string;
  editUrl: string | null;
  noteUrl: string | null;
}

export interface QualityAssessment {
  score: number;
  indexable: boolean;
  verdict: 'INDEX' | 'IMPROVE' | 'NOINDEX';
  reasons: string[];
  factCount: number;
}

export interface PlaceModel {
  type: EntityType;
  slug: string;
  canonical: string;
  title: string;
  metaDescription: string;
  h1: string;
  subtitle: string;
  robots: 'index' | 'noindex';
  crumbs: Crumb[];
  /** 1-3 zdania zlozone wylacznie z danych (bez przymiotnikow oceniajacych). */
  summary: string[];
  facts: Fact[];
  factGroups: FactGroup[];
  description: string | null;
  notes: string[];
  notices: string[];
  map: StaticMapModel | null;
  sections: Section[];
  tables: TableModel[];
  provenance: Provenance;
  jsonLd: Record<string, unknown>[];
  quality: QualityAssessment;
}

export interface HubModel {
  canonical: string;
  title: string;
  metaDescription: string;
  h1: string;
  subtitle?: string;
  robots: 'index' | 'noindex';
  crumbs: Crumb[];
  intro: string[];
  stats: Fact[];
  map: StaticMapModel | null;
  sections: Section[];
  tables: TableModel[];
  jsonLd: Record<string, unknown>[];
}
