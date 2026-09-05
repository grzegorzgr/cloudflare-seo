// Inwarianty wygenerowanego datasetu (packages/data) — testy integracyjne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildIndex } from '../packages/generator/src/data.ts';
import { buildPlaceModel } from '../packages/generator/src/place.ts';
import { buildCityModel, buildCityTypeModel, buildHomeModel } from '../packages/generator/src/hubs.ts';
import { buildSitemapEntries } from '../packages/generator/src/sitemap.ts';
import { assessEntity } from '../packages/generator/src/quality.ts';

const DATA = resolve(import.meta.dirname, '../packages/data');
const load = (f) => JSON.parse(readFileSync(resolve(DATA, f), 'utf8'));
const bundle = {
  parkings: load('parkings.json'),
  beaches: load('beaches.json'),
  trails: load('trails.json'),
  cities: load('cities.json'),
  regions: load('regions.json'),
  meta: load('dataset-meta.json'),
  geometry: load('trail-geometry.json'),
};
const index = buildIndex(bundle);
const SITE = 'https://gdziemy.pl';

test('dataset: unikalne slugi, wspolrzedne, brak sladow street-segmentow', () => {
  for (const [name, list] of Object.entries({ parkings: bundle.parkings, beaches: bundle.beaches, trails: bundle.trails })) {
    const slugs = new Set();
    for (const e of list) {
      assert.ok(!slugs.has(e.slug), `${name}: duplikat slug ${e.slug}`);
      slugs.add(e.slug);
      assert.ok(Number.isFinite(e.coordinates.lat) && Number.isFinite(e.coordinates.lng), `${name}/${e.slug}: brak wspolrzednych`);
      assert.ok(e.name.trim().length > 0);
      assert.ok(e.rel && Array.isArray(e.rel.parkings));
    }
  }
  // Szlaki to relacje route=*, nie pojedyncze drogi.
  for (const t of bundle.trails) {
    assert.ok(!t.osm || t.osm.type === 'relation', `trail ${t.slug} nie jest relacja`);
    assert.ok(['bicycle', 'hiking', 'mtb', 'foot'].includes(t.attrs.route), `trail ${t.slug} bez route=*`);
  }
});

test('dataset: relacje wskazuja istniejace encje', () => {
  for (const list of [bundle.parkings, bundle.beaches, bundle.trails]) {
    for (const e of list) {
      for (const k of ['parkings', 'beaches', 'trails', 'parts', 'parents']) {
        for (const r of e.rel[k] ?? []) assert.ok(index.byKey.has(r.key), `${e.type}/${e.slug} -> ${r.key} nie istnieje`);
      }
      for (const r of e.rel.cities ?? []) assert.ok(index.cityBySlug.has(r.key.replace('city/', '')), `${e.slug} -> ${r.key}`);
    }
  }
});

test('dataset: dlugosci szlakow zgodne z tagiem distance (tolerancja 15%)', () => {
  let checked = 0;
  let off = 0;
  for (const t of bundle.trails) {
    const tag = Number(String(t.attrs.distance ?? '').replace(',', '.'));
    if (!t.computed?.lengthKm || !tag || t.computed.fragmented || t.computed.superroute) continue;
    checked++;
    if (Math.abs(t.computed.lengthKm - tag) / tag > 0.15) off++;
  }
  if (checked >= 10) assert.ok(off / checked < 0.35, `zbyt wiele rozjazdow dlugosci: ${off}/${checked}`);
});

test('modele: kazda encja buduje poprawny model strony', () => {
  const sample = [...bundle.parkings.slice(0, 40), ...bundle.trails.slice(0, 40), ...bundle.beaches.slice(0, 20)];
  for (const e of sample) {
    const m = buildPlaceModel(e, index, SITE);
    assert.ok(m.title.length >= 10 && m.title.length <= 90, `${e.slug}: title ${m.title.length}`);
    assert.ok(m.metaDescription.length >= 40 && m.metaDescription.length <= 300, `${e.slug}: description ${m.metaDescription.length}`);
    assert.equal(m.canonical, `/${e.type}/${e.slug}/`);
    assert.ok(m.crumbs.length >= 3);
    assert.ok(m.facts.length >= 2);
    assert.ok(m.map, `${e.slug}: brak mapy`);
    assert.equal(m.jsonLd.length, 2);
    assert.ok(!/nieznane|undefined|null/.test(m.summary.join(' ')), `${e.slug}: podsumowanie zawiera brak danych: ${m.summary.join(' ')}`);
    assert.equal(m.robots, assessEntity(e).indexable ? 'index' : 'noindex');
  }
});

test('modele: miasta i sitemap spojne', () => {
  const home = buildHomeModel(index, SITE);
  assert.ok(home.sections.length >= 3);
  for (const c of bundle.cities) {
    const m = buildCityModel(c.slug, index, SITE);
    assert.equal(m.canonical, `/city/${c.slug}/`);
    const p = buildCityTypeModel(c.slug, 'parking', index, SITE);
    if (p) assert.ok(p.tables.length >= 1 || p.sections.length >= 1);
  }
  const entries = buildSitemapEntries(index, SITE);
  const locs = new Set(entries.map((e) => e.loc));
  assert.equal(locs.size, entries.length, 'duplikaty w sitemap');
  for (const e of entries) assert.match(e.lastmod, /^\d{4}-\d{2}-\d{2}$/);
  const idx = bundle.parkings.filter((e) => assessEntity(e).indexable).length;
  assert.ok(entries.filter((e) => e.loc.includes('/parking/')).length >= idx);
});
