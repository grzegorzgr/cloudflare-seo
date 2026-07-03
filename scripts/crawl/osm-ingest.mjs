#!/usr/bin/env node
// Warstwa SCRIPTS: ingestion OpenStreetMap -> wewnetrzny schemat encji.
//
// ZASADA BEZWZGLEDNA: ZERO inference, ZERO zgadywania.
// Kazde pole wynika WYLACZNIE z jawnych tagow OSM. Brak tagu = null / pominiecie.
//
// Wejscie:  eksport Overpass API w formacie JSON (uzyj `out center;` dla way/relation).
// Wyjscie:  tablica encji w schemacie /packages/data (JSON), deterministycznie posortowana.
//
// Uzycie:
//   node scripts/crawl/osm-ingest.mjs <input.overpass.json> [output.json]
//
// Przyklad zapytania Overpass (wklej na https://overpass-turbo.eu):
//   [out:json];
//   ( node["natural"="beach"](area);
//     way["amenity"="parking"](area);
//     way["highway"~"path|cycleway|footway"](area); );
//   out center;

import { readFileSync, writeFileSync } from 'node:fs';

// --- Deterministyczny slug (kopia packages/generator/src/slug.ts) ---
const POLISH_CHARS = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n',
  ó: 'o', ś: 's', ź: 'z', ż: 'z',
};

function slugify(input) {
  return String(input)
    .toLowerCase()
    .split('')
    .map((char) => POLISH_CHARS[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// --- Mapowanie tagow OSM -> typ wewnetrzny (tylko jawne dopasowania) ---
function resolveType(tags) {
  if (tags.natural === 'beach') return 'beach';
  if (tags.amenity === 'parking') return 'parking';
  if (['path', 'cycleway', 'footway'].includes(tags.highway)) return 'trail';
  if (tags.tourism === 'attraction') return 'attraction';
  return null; // brak jawnego dopasowania -> pomijamy element
}

// Znormalizowana wartosc boolowska z tagu OSM (yes/no). Inne wartosci -> null.
function osmBool(value) {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

// --- Wspolrzedne: node ma lat/lon, way/relation ma center (out center) ---
function resolveCoordinates(element) {
  if (typeof element.lat === 'number' && typeof element.lon === 'number') {
    return { lat: element.lat, lng: element.lon };
  }
  if (element.center &&
      typeof element.center.lat === 'number' &&
      typeof element.center.lon === 'number') {
    return { lat: element.center.lat, lng: element.center.lon };
  }
  return { lat: null, lng: null };
}

// --- Lokalizacja: TYLKO z tagow addr:* (zero inference) ---
function resolveLocation(tags) {
  return {
    city: tags['addr:city'] ?? null,
    region: tags['addr:region'] ?? tags['addr:state'] ?? null,
    country: tags['addr:country'] ?? null,
  };
}

// --- Amenities: TYLKO jawne tagi -> booleany (brak tagu = null) ---
function resolveAmenities(tags) {
  return {
    parking: tags.amenity === 'parking' ? true : null,
    toilets: osmBool(tags.toilets),
    dog_friendly: osmBool(tags.dog),
    accessibility: osmBool(tags.wheelchair),
    paid_entry: osmBool(tags.fee),
    lifeguards: osmBool(tags.supervised),
    covered: osmBool(tags.covered),
    guarded: osmBool(tags.supervised),
  };
}

// --- Features: fakty tekstowe TYLKO z jawnych tagow opisowych ---
function resolveFeatures(tags) {
  const features = [];
  if (tags.surface) features.push(`nawierzchnia: ${tags.surface}`);
  if (tags.length) features.push(`długość: ${tags.length}`);
  if (tags.distance) features.push(`dystans: ${tags.distance}`);
  if (tags.operator) features.push(`operator: ${tags.operator}`);
  if (tags.capacity) features.push(`pojemność: ${tags.capacity}`);
  if (tags.ref) features.push(`oznakowanie: ${tags.ref}`);
  return features;
}

function mapElement(element) {
  const tags = element.tags ?? {};
  const type = resolveType(tags);
  if (!type) return null;
  // Brak nazwy = brak strony (zasada: 1 encja = 1 strona, bez fikcji).
  const name = tags.name;
  if (!name) return null;

  const osmId = `${element.type}/${element.id}`;
  const slug = `${slugify(name)}-${element.id}`;

  return {
    id: slug,
    slug,
    type,
    osmId,
    name,
    location: resolveLocation(tags),
    description: null,
    coordinates: resolveCoordinates(element),
    features: resolveFeatures(tags),
    amenities: resolveAmenities(tags),
    tags: [],
    access: null,
    seo: null,
  };
}

function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath) {
    process.stderr.write(
      'Uzycie: node scripts/crawl/osm-ingest.mjs <input.overpass.json> [output.json]\n',
    );
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(inputPath, 'utf8'));
  const elements = Array.isArray(raw) ? raw : raw.elements ?? [];

  const entities = elements
    .map(mapElement)
    .filter((entity) => entity !== null)
    // Deterministyczna kolejnosc: wg osmId (stala niezaleznie od wejscia).
    .sort((a, b) => (a.osmId < b.osmId ? -1 : a.osmId > b.osmId ? 1 : 0));

  const byType = entities.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1;
    return acc;
  }, {});

  const json = JSON.stringify(entities, null, 2);
  if (outputPath) {
    writeFileSync(outputPath, json + '\n', 'utf8');
    process.stderr.write(`Zapisano ${entities.length} encji -> ${outputPath}\n`);
  } else {
    process.stdout.write(json + '\n');
  }
  process.stderr.write(`Podsumowanie wg typu: ${JSON.stringify(byType)}\n`);
}

main();
