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
    lifeguard: 'Ratownik',
    dogFriendly: 'Przyjazna psom',
    accessible: 'Dost\u0119pno\u015b\u0107 dla niepe\u0142nosprawnych',
    showers: 'Prysznice',
  },
};

export const parkingConfig: TypeConfig = {
  basePath: 'parking',
  schemaType: 'ParkingFacility',
  entityNoun: 'parkingu',
  featureLabels: {
    paid: 'P\u0142atny',
    covered: 'Zadaszony',
    guarded: 'Strze\u017cony',
    evCharging: '\u0141adowarka EV',
    disabledSpots: 'Miejsca dla niepe\u0142nosprawnych',
    lighting: 'O\u015bwietlenie',
  },
};

export const trailConfig: TypeConfig = {
  basePath: 'trail',
  schemaType: 'TouristAttraction',
  entityNoun: 'szlaku',
  featureLabels: {
    marked: 'Oznakowany',
    loop: 'P\u0119tla',
    dogFriendly: 'Przyjazny psom',
    familyFriendly: 'Przyjazny rodzinom',
    parking: 'Parking przy szlaku',
    waterSource: '\u0179r\u00f3d\u0142o wody',
  },
};

// Rejestr wg klucza typu, u\u017cyteczny do generowania wsadowego.
export const typeConfigs = {
  beach: beachConfig,
  parking: parkingConfig,
  trail: trailConfig,
} as const;

export type EntityType = keyof typeof typeConfigs;
