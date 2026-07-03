#!/usr/bin/env node
// Warstwa SCRIPTS: generuje deterministyczny raport deduplikacji z /packages/data.
// Wykrywa: duplikaty nazw, zblizone wspolrzedne (< 50 m), te same osmId oraz sieroty.
// NIE modyfikuje danych zrodlowych - tylko raportuje (wynik do przegladu przed czyszczeniem).
//
// Uzycie:
//   node scripts/build/dedupe-report.mjs
//   -> zapisuje scripts/build/dedupe-report.json

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, '../../packages/data');
const OUT = resolve(HERE, 'dedupe-report.json');

const SAME_COORD_KM = 0.05;
const EARTH_RADIUS_KM = 6371;

const POLISH_CHARS = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n',
  ó: 'o', ś: 's', ź: 'z', ż: 'z',
};

function slugify(input) {
  return String(input)
    .toLowerCase()
    .split('')
    .map((c) => POLISH_CHARS[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hasCoords(c) {
  return c && Number.isFinite(c.lat) && Number.isFinite(c.lng);
}

function distanceKm(a, b) {
  if (!hasCoords(a.coordinates) || !hasCoords(b.coordinates)) return null;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.coordinates.lat - a.coordinates.lat);
  const dLng = toRad(b.coordinates.lng - a.coordinates.lng);
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h =
    sLat * sLat +
    Math.cos(toRad(a.coordinates.lat)) *
      Math.cos(toRad(b.coordinates.lat)) *
      sLng * sLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function load(name, type) {
  const path = resolve(DATA_DIR, `${name}.json`);
  const list = JSON.parse(readFileSync(path, 'utf8'));
  return list.map((entity) => ({
    entity,
    ref: {
      key: `${type}/${entity.slug}`,
      type,
      slug: entity.slug,
      name: entity.name,
    },
  }));
}

function groupBy(indexed, reason, keyOf) {
  const order = [];
  const groups = new Map();
  for (const item of indexed) {
    const key = keyOf(item);
    if (key === null || key === undefined) continue;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(item);
  }
  return order
    .map((k) => groups.get(k))
    .filter((m) => m.length > 1)
    .map((m) => ({
      reason,
      primary: m[0].ref,
      duplicates: m.slice(1).map((x) => x.ref),
    }));
}

function coordinateDuplicates(indexed) {
  const withCoords = indexed.filter((i) => hasCoords(i.entity.coordinates));
  const assigned = new Set();
  const groups = [];
  for (let i = 0; i < withCoords.length; i++) {
    if (assigned.has(withCoords[i].ref.key)) continue;
    const duplicates = [];
    for (let j = i + 1; j < withCoords.length; j++) {
      if (assigned.has(withCoords[j].ref.key)) continue;
      const d = distanceKm(withCoords[i].entity, withCoords[j].entity);
      if (d !== null && d <= SAME_COORD_KM) {
        duplicates.push(withCoords[j].ref);
        assigned.add(withCoords[j].ref.key);
      }
    }
    if (duplicates.length > 0) {
      assigned.add(withCoords[i].ref.key);
      groups.push({ reason: 'coordinates', primary: withCoords[i].ref, duplicates });
    }
  }
  return groups;
}

function orphans(indexed) {
  return indexed
    .filter((item) => {
      const city = item.entity.location?.city ?? null;
      const region = item.entity.location?.region ?? null;
      if (!city && !region) return true;
      return !indexed.some((other) => {
        if (other.ref.key === item.ref.key) return false;
        const oc = other.entity.location?.city ?? null;
        const or = other.entity.location?.region ?? null;
        return (city && oc === city) || (region && or === region);
      });
    })
    .map((item) => item.ref);
}

function main() {
  const indexed = [
    ...load('beaches', 'beach'),
    ...load('parkings', 'parking'),
    ...load('trails', 'trail'),
  ];

  const report = {
    totalEntities: indexed.length,
    duplicateGroups: [
      ...groupBy(indexed, 'osmId', (i) => (i.entity.osmId ? String(i.entity.osmId) : null)),
      ...groupBy(indexed, 'name', (i) => slugify(i.entity.name)),
      ...coordinateDuplicates(indexed),
    ],
    orphans: orphans(indexed),
  };

  writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  process.stderr.write(
    `Encji: ${report.totalEntities} | grup duplikatow: ${report.duplicateGroups.length} | sierot: ${report.orphans.length}\n`,
  );
  process.stderr.write(`Raport zapisany -> ${OUT}\n`);
}

main();
