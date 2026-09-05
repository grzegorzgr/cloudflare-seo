// Jednorazowe wczytanie danych i zbudowanie indeksu (modul ewaluowany raz na build).
import beaches from '@data/beaches.json';
import parkings from '@data/parkings.json';
import trails from '@data/trails.json';
import cities from '@data/cities.json';
import regions from '@data/regions.json';
import meta from '@data/dataset-meta.json';
import geometry from '@data/trail-geometry.json';
import { buildIndex, type CitySeed, type DataBundle, type DataIndex, type Entity, type RegionSeed, type TrailGeometry } from '@generator';
import { seoConfig } from '@config/seo.config.ts';

export const bundle: DataBundle = {
  parkings: parkings as unknown as Entity[],
  beaches: beaches as unknown as Entity[],
  trails: trails as unknown as Entity[],
  cities: cities as unknown as CitySeed[],
  regions: regions as unknown as RegionSeed[],
  meta: meta as DataBundle['meta'],
  geometry: geometry as unknown as Record<string, TrailGeometry>,
};

export const index: DataIndex = buildIndex(bundle);
export const siteUrl = seoConfig.siteUrl;
