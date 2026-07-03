// Sitemap endpoint (SSG). Prerenderowany do /sitemap.xml na etapie build.
// Deterministycznie generowany z /packages/data przez warstwe generatora.
import type { APIRoute } from 'astro';
import beaches from '@data/beaches.json';
import parkings from '@data/parkings.json';
import trails from '@data/trails.json';
import cities from '@data/cities.json';
import {
  beachConfig,
  parkingConfig,
  trailConfig,
  buildSitemapXml,
  buildAllCollections,
  indexCategories,
  CITIES_PATH,
  REGIONS_PATH,
  COLLECTIONS_PATH,
  type Entity,
} from '@generator';
import { seoConfig } from '@config/seo.config.ts';

export const GET: APIRoute = () => {
  const datasets = [
    { entities: beaches as Entity[], config: beachConfig },
    { entities: parkings as Entity[], config: parkingConfig },
    { entities: trails as Entity[], config: trailConfig },
  ];

  const indexPaths = [
    CITIES_PATH,
    REGIONS_PATH,
    COLLECTIONS_PATH,
    ...indexCategories.map((category) => category.path),
  ];

  const collections = buildAllCollections(datasets, seoConfig.siteUrl);
  const collectionSlugs = collections.map((col) => col.slug);

  const xml = buildSitemapXml(
    datasets,
    seoConfig.siteUrl,
    cities as Entity[],
    indexPaths,
    collectionSlugs,
  );

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
