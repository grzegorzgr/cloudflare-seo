// Konfiguracje typ\u00f3w tematycznych. Steruj\u0105 deterministycznym generowaniem stron.
// Nowy typ = nowa konfiguracja tutaj (bez zmian w logice generatora ani widoku).

import type { TypeConfig } from './types.js';

export const beachConfig: TypeConfig = {
  basePath: 'beach',
  schemaType: 'TouristAttraction',
  entityNoun: 'pla\u017cy',
  featureLabels: {
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

// Rejestr wg klucza typu, u\u017cyteczny do generowania wsadowego.
export const typeConfigs = {
  beach: beachConfig,
  parking: parkingConfig,
  trail: trailConfig,
} as const;

export type EntityType = keyof typeof typeConfigs;
