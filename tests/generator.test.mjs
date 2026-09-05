// Testy jednostkowe generatora (node:test, Node >= 22 ze strip-types).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatKm,
  formatMaxstay,
  formatOpeningHours,
  formatFeeConditional,
  formatOsmcSymbol,
  estimateDuration,
  labels,
  inCity,
  countOf,
} from '../packages/generator/src/labels.ts';
import { assessEntity, isGenericName } from '../packages/generator/src/quality.ts';
import { buildStaticMap, zoomForBbox } from '../packages/generator/src/map.ts';
import { slugify, withTrailingSlash } from '../packages/generator/src/slug.ts';
import { distanceKm } from '../packages/generator/src/geo.ts';

const entity = (over = {}) => ({
  slug: 'x-1',
  name: 'Parking Testowy',
  type: 'parking',
  source: 'osm',
  osm: { type: 'way', id: 1, timestamp: '2026-01-01T00:00:00Z', version: 1, checkDate: null },
  location: { city: 'Gdańsk', region: 'Pomorskie', hubSlug: 'gdansk', hubDistanceKm: 1 },
  address: null,
  coordinates: { lat: 54.35, lng: 18.65 },
  description: null,
  notes: [],
  attrs: {},
  rel: { parkings: [], beaches: [], trails: [], cities: [] },
  ...over,
});

test('labels: tlumaczenia i formatery', () => {
  assert.equal(labels.surface('paving_stones'), 'kostka brukowa');
  assert.equal(labels.surface('unknown_value'), 'unknown_value');
  assert.equal(labels.parkingType('multi-storey'), 'parking wielopoziomowy');
  assert.equal(labels.access('customers'), 'dla klientów');
  assert.equal(formatMaxstay('2 minutes'), '2 min');
  assert.equal(formatMaxstay('2 days'), '2 dni');
  assert.equal(formatMaxstay('no'), 'bez limitu');
  assert.equal(formatOpeningHours('24/7'), 'całodobowo');
  assert.equal(formatOpeningHours('Mo-Fr 07:00-17:00'), 'pon.–pt. 07:00–17:00');
  assert.equal(formatFeeConditional('yes @ (Mo-Fr 07:00-17:00)'), 'płatny: pon.–pt. 07:00–17:00');
  assert.equal(formatFeeConditional('no @ (stay < 2 hours)'), 'bezpłatny: postój do 2 godz.');
  assert.equal(formatOsmcSymbol('red:white:red_bar'), 'czerwony pasek poziomy na białym tle');
  assert.equal(formatKm(0.42), '420 m');
  assert.equal(formatKm(46.2), '46,2 km');
  assert.equal(formatKm(118.9), '119 km');
  assert.equal(estimateDuration(30, 'bicycle').text, 'ok. 2 godz.');
  assert.equal(estimateDuration(10, 'hiking').text, 'ok. 2 godz. 30 min');
  assert.equal(inCity('Gdańsk'), 'w Gdańsku');
  assert.equal(countOf(5, 'parking'), '5 parkingów');
  assert.equal(countOf(2, 'trail'), '2 szlaki');
});

test('quality: nazwy kodowe', () => {
  assert.equal(isGenericName('P8'), true);
  assert.equal(isGenericName('TIR'), true);
  assert.equal(isGenericName('sektor I1'), true);
  assert.equal(isGenericName('Parking Millennium Towers'), false);
});

test('quality: parking prywatny nie jest indeksowany', () => {
  const q = assessEntity(entity({ attrs: { access: 'private', fee: 'yes', capacity: '10', parking: 'surface' } }));
  assert.equal(q.indexable, false);
  assert.match(q.reasons.join(' '), /dostępu publicznego/);
});

test('quality: parking z >=3 faktami jest indeksowany, z 2 nie', () => {
  assert.equal(assessEntity(entity({ attrs: { fee: 'yes', capacity: '10', parking: 'surface' } })).indexable, true);
  assert.equal(assessEntity(entity({ attrs: { fee: 'yes', capacity: '10' } })).indexable, false);
});

test('quality: szlak bez dlugosci nie jest indeksowany; z dlugoscia i 3 faktami tak', () => {
  const base = entity({ type: 'trail', name: 'Szlak X', attrs: { route: 'hiking', colour: 'red' } });
  assert.equal(assessEntity({ ...base, computed: null }).indexable, false);
  const ok = { ...base, computed: { lengthKm: 12.3, wayCount: 5, isLoop: false, fragmented: false, superroute: false, start: null, end: null, bbox: null, pointCount: 10 } };
  assert.equal(assessEntity(ok).indexable, true);
  assert.equal(assessEntity({ ...ok, computed: { ...ok.computed, lengthKm: 0.4 } }).indexable, false);
});

test('quality: plaza bez faktow ale z parkingiem w poblizu jest indeksowana', () => {
  const b = entity({ type: 'beach', name: 'Plaża Y', rel: { parkings: [{ key: 'parking/a', km: 0.3 }], beaches: [], trails: [], cities: [] } });
  assert.equal(assessEntity(b).indexable, true);
  assert.equal(assessEntity({ ...b, rel: { parkings: [], beaches: [], trails: [], cities: [] } }).indexable, false);
});

test('map: mozaika wysrodkowana, pinezka w srodku, sciezka w pikselach', () => {
  const m = buildStaticMap({ center: { lat: 54.35, lng: 18.65 }, zoom: 16, cols: 3, rows: 2, alt: 'x' });
  assert.equal(m.tiles.length, 3);
  assert.equal(m.tiles[0].length, 4);
  assert.ok(m.tiles[0][0].startsWith('https://tile.openstreetmap.org/16/'));
  assert.ok(Math.abs(m.pin.x - 384) <= 1 && Math.abs(m.pin.y - 256) <= 1);
  const g = buildStaticMap({ center: { lat: 54.35, lng: 18.65 }, zoom: 13, alt: 'x', pin: false, geometry: { bbox: null, lines: [[[54.34, 18.64], [54.36, 18.66]]] } });
  assert.equal(g.paths.length, 1);
  assert.match(g.paths[0], /^M-?\d+ -?\d+ L-?\d+ -?\d+$/);
  assert.ok(zoomForBbox([54.3, 18.5, 54.4, 18.8], 3, 2) <= 12);
});

test('slug + geo', () => {
  assert.equal(slugify('Plaża Brzeźno – Gdańsk'), 'plaza-brzezno-gdansk');
  assert.equal(withTrailingSlash('/city/gdansk'), '/city/gdansk/');
  const d = distanceKm({ lat: 54.352, lng: 18.6466 }, { lat: 54.5189, lng: 18.5305 });
  assert.ok(d > 19 && d < 21, `Gdansk-Gdynia ~20 km, got ${d}`);
});
