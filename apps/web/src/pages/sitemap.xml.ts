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
  indexCategories,
  CITIES_PATH,
  REGIONS_PATH,
  type Entity,
} from '@generator';
import { seoConfig } from '@config/seo.config.ts';

export const GET: APIRoute = () => {
  const indexPaths = [
    CITIES_PATH,
    REGIONS_PATH,
    ...indexCategories.map((category) => category.path),
  ];
  const xml = buildSitemapXml(
    [
      { entities: beaches as Entity[], config: beachConfig },
      { entities: parkings as Entity[], config: parkingConfig },
      { entities: trails as Entity[], config: trailConfig },
    ],
    seoConfig.siteUrl,
    cities as Entity[],
    indexPaths,
  );

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
