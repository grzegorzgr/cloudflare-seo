// Konfiguracja typow encji i schematu URL. Jedno zrodlo prawdy dla sciezek.

import type { EntityType } from './types.ts';

export interface TypeConfig {
  type: EntityType;
  /** Segment URL strony encji: /{basePath}/{slug}/ */
  basePath: string;
  /** Strona indeksu kategorii. */
  indexPath: string;
  /** Segment podstrony miasta: /city/{miasto}/{citySegment}/ */
  citySegment: string;
  label: string; // l.mn., np. "Parkingi"
  labelOne: string; // l.poj., np. "parking"
  genitive: string; // dopelniacz l.poj., np. "parkingu"
  schemaType: string;
}

export const typeConfigs: Record<EntityType, TypeConfig> = {
  parking: {
    type: 'parking',
    basePath: 'parking',
    indexPath: '/parking/',
    citySegment: 'parkingi',
    label: 'Parkingi',
    labelOne: 'parking',
    genitive: 'parkingu',
    schemaType: 'ParkingFacility',
  },
  trail: {
    type: 'trail',
    basePath: 'trail',
    indexPath: '/trails/',
    citySegment: 'szlaki',
    label: 'Szlaki',
    labelOne: 'szlak',
    genitive: 'szlaku',
    schemaType: 'TouristAttraction',
  },
  beach: {
    type: 'beach',
    basePath: 'beach',
    indexPath: '/beaches/',
    citySegment: 'plaze',
    label: 'Plaże',
    labelOne: 'plaża',
    genitive: 'plaży',
    schemaType: 'Beach',
  },
};

export const TYPE_ORDER: EntityType[] = ['parking', 'trail', 'beach'];

export const paths = {
  home: '/',
  cities: '/cities/',
  regions: '/regions/',
  about: '/o-nas/',
  contact: '/kontakt/',
  sources: '/zrodla-danych/',
  methodology: '/metodologia/',
  privacy: '/polityka-prywatnosci/',
  terms: '/regulamin/',
  entity: (type: EntityType, slug: string) => `/${typeConfigs[type].basePath}/${slug}/`,
  city: (slug: string) => `/city/${slug}/`,
  cityType: (slug: string, type: EntityType) => `/city/${slug}/${typeConfigs[type].citySegment}/`,
  region: (slug: string) => `/region/${slug}/`,
};

export const site = {
  name: 'gdziemy.pl',
  tagline: 'Parkingi, szlaki i plaże w Polsce — na danych OpenStreetMap',
  contactEmail: 'contact@digital.gda.pl',
  /**
   * Data ostatniej istotnej zmiany szablonow/tresci stron (YYYY-MM-DD).
   * Sitemap lastmod = max(data edycji obiektu w OSM, ta data). Podbijac przy
   * zmianach, ktore realnie zmieniaja tresc stron (nie przy kazdym buildzie).
   */
  contentVersion: '2026-09-05',
};

/** Glowna nawigacja (naglowek). */
export const mainNav = [
  { href: paths.home, label: 'Start' },
  { href: typeConfigs.parking.indexPath, label: 'Parkingi' },
  { href: typeConfigs.trail.indexPath, label: 'Szlaki' },
  { href: typeConfigs.beach.indexPath, label: 'Plaże' },
  { href: paths.cities, label: 'Miasta' },
  { href: paths.regions, label: 'Województwa' },
];

export const footerNav = [
  { href: paths.about, label: 'O serwisie' },
  { href: paths.methodology, label: 'Metodologia' },
  { href: paths.sources, label: 'Źródła danych' },
  { href: paths.contact, label: 'Kontakt' },
  { href: paths.terms, label: 'Regulamin' },
  { href: paths.privacy, label: 'Polityka prywatności' },
];
