// Konfiguracje typ\u00f3w tematycznych. Steruj\u0105 deterministycznym generowaniem stron.
// Nowy typ = nowa konfiguracja tutaj (bez zmian w logice generatora ani widoku).

import type { TypeConfig } from './types.js';

export const beachConfig: TypeConfig = {
  basePath: 'beach',
  schemaType: 'TouristAttraction',
  entityNoun: 'pla\u017cy',  keywordNoun: 'plaża',
  collectionLabel: 'Plaże',  featureLabels: {
    parking: 'Parking',
    toilets: 'Toalety',
    dog_friendly: 'Przyjazna psom',
    accessibility: 'Dostępność dla niepełnosprawnych',
    paid_entry: 'Płatny wstęp',
    lifeguards: 'Ratownik',
  },
  accessLabels: {
    public_transport: 'Komunikacja miejska',
    car_access: 'Dojazd samochodem',
    bike_access: 'Dojazd rowerem',
  },
};

export const parkingConfig: TypeConfig = {
  basePath: 'parking',
  schemaType: 'ParkingFacility',
  entityNoun: 'parkingu',
  keywordNoun: 'parking',
  collectionLabel: 'Parkingi',
  featureLabels: {
    paid_entry: 'P\u0142atny',
    covered: 'Zadaszony',
    guarded: 'Strze\u017cony',
    parking: 'Parking',
    accessibility: 'Miejsca dla niepe\u0142nosprawnych',
  },
  accessLabels: {
    public_transport: 'Komunikacja miejska',
    car_access: 'Dojazd samochodem',
    bike_access: 'Dojazd rowerem',
  },
};

export const trailConfig: TypeConfig = {
  basePath: 'trail',
  schemaType: 'TouristAttraction',
  entityNoun: 'szlaku',
  keywordNoun: 'szlak',
  collectionLabel: 'Szlaki',
  featureLabels: {
    parking: 'Parking przy szlaku',
    toilets: 'Toalety',
    dog_friendly: 'Przyjazny psom',
    accessibility: 'Dost\u0119pno\u015b\u0107 dla niepe\u0142nosprawnych',
  },
  accessLabels: {
    public_transport: 'Komunikacja miejska',
    car_access: 'Dojazd samochodem',
    bike_access: 'Dojazd rowerem',
  },
};

// Warstwa CITY SEED: konfiguracja wezlow-kotwic (anchor nodes).
// Miasto nie ma wlasnej strony encji [slug] - jest hubem klastra /city/{slug}.
// Sluzy jako punkt zaczepienia grafu (belongs_to_city / belongs_to_region).
export const cityConfig: TypeConfig = {
  basePath: 'city',
  schemaType: 'City',
  entityNoun: 'miasta',
  keywordNoun: 'miasto',
  collectionLabel: 'Miasta',
  featureLabels: {},
  accessLabels: {},
};

// Rejestr wg klucza typu, u\u017cyteczny do generowania wsadowego.
// UWAGA: city celowo NIE jest tutaj - nie generuje stron encji [slug],
// tylko strony klastra /city/{slug} (patrz clusters.ts).
export const typeConfigs = {
  beach: beachConfig,
  parking: parkingConfig,
  trail: trailConfig,
} as const;

export type EntityType = keyof typeof typeConfigs;
