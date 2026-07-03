// Sitemap generator. Deterministycznie buduje liste URL i XML sitemap
// wylacznie z danych w /packages/data. Bez recznej edycji.

import { slugify } from './slug.js';
import type { Entity, TypeConfig } from './types.js';

export interface SitemapDataset {
  entities: Entity[];
  config: TypeConfig;
}

/**
 * Buduje deterministyczna, uporzadkowana liste sciezek (bez domeny):
 *  - "/"                      strona glowna
 *  - "/{type}/"               strony cluster (lista wg typu)
 *  - "/{type}/{slug}"         strony encji (1 encja = 1 URL)
 *  - "/city/{slug}"           strony cluster wg miasta
 *  - "/region/{slug}"         strony cluster wg regionu
 * Kolejnosc wynika z porzadku datasetow i danych (odtwarzalna).
 * Wynik jest odduplikowany (zasada: brak duplikatow w sitemap).
 */
export function buildSitemapPaths(datasets: SitemapDataset[]): string[] {
  const paths: string[] = ['/'];
  const regions: string[] = [];
  const cities: string[] = [];

  for (const { entities, config } of datasets) {
    paths.push(`/${config.basePath}/`);
    for (const entity of entities) {
      paths.push(`/${config.basePath}/${entity.slug}`);
      const region = entity.location?.region;
      if (region && !regions.includes(region)) {
        regions.push(region);
      }
      const city = entity.location?.city;
      if (city && !cities.includes(city)) {
        cities.push(city);
      }
    }
  }

  for (const city of cities) {
    paths.push(`/city/${slugify(city)}`);
  }

  for (const region of regions) {
    paths.push(`/region/${slugify(region)}`);
  }

  // Deterministyczna deduplikacja z zachowaniem kolejnosci pierwszego wystapienia.
  return paths.filter((path, index) => paths.indexOf(path) === index);
}

/**
 * Serializuje liste datasetow do poprawnego XML sitemap.
 * baseUrl to domena origin (np. https://example.com) bez koncowego "/".
 */
export function buildSitemapXml(
  datasets: SitemapDataset[],
  baseUrl: string,
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const body = buildSitemapPaths(datasets)
    .map((path) => `  <url>\n    <loc>${base}${path}</loc>\n  </url>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
