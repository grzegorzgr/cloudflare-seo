// Sitemap generator. Deterministycznie buduje liste URL i XML sitemap
// wylacznie z danych w /packages/data. Bez recznej edycji.

import { slugify, stripTrailingSlashes, withTrailingSlash } from './slug.js';
import { hasSufficientContent } from './generator.js';
import type { Entity, TypeConfig } from './types.js';

export interface SitemapDataset {
  entities: Entity[];
  config: TypeConfig;
}

/**
 * Buduje deterministyczna, uporzadkowana liste sciezek (bez domeny):
 *  - "/"                      strona glowna (GEO graph index node)
 *  - indexPaths               strony wejsciowe index (np. /cities, /beaches)
 *  - "/{type}/{slug}"         strony encji (1 encja = 1 URL)
 *  - "/city/{slug}"           strony cluster wg miasta
 *  - "/region/{slug}"         strony cluster wg regionu
 *  - "/collection/{slug}"     strony kolekcji automatycznych
 * Kolejnosc wynika z porzadku datasetow i danych (odtwarzalna).
 * Wynik jest odduplikowany (zasada: brak duplikatow w sitemap).
 */
export function buildSitemapPaths(
  datasets: SitemapDataset[],
  citySeeds: Entity[] = [],
  indexPaths: string[] = [],
  collectionSlugs: string[] = [],
): string[] {
  const paths: string[] = ['/'];
  const regions: string[] = [];
  const cities: string[] = [];

  // Warstwa index (entry points): /cities, /regions, /beaches, /parking, /trails.
  for (const indexPath of indexPaths) {
    paths.push(withTrailingSlash(indexPath));
  }

  for (const { entities, config } of datasets) {
    for (const entity of entities) {
      // Strony bez opisu i bez zadnej cechy (same "Brak danych") sa
      // wylaczone z sitemap, dopoki dane sie nie uzupelnia (thin content).
      if (hasSufficientContent(entity)) {
        paths.push(withTrailingSlash(`/${config.basePath}/${entity.slug}`));
      }
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

  // Warstwa seed: kazde miasto-hub ma strone /city/{slug}, kazdy region /region/{slug}.
  for (const seed of citySeeds) {
    const city = seed.location?.city ?? seed.name;
    if (city && !cities.includes(city)) {
      cities.push(city);
    }
    const region = seed.location?.region;
    if (region && !regions.includes(region)) {
      regions.push(region);
    }
  }

  for (const city of cities) {
    paths.push(withTrailingSlash(`/city/${slugify(city)}`));
  }

  for (const region of regions) {
    paths.push(withTrailingSlash(`/region/${slugify(region)}`));
  }

  // Warstwa kolekcji automatycznych.
  for (const slug of collectionSlugs) {
    paths.push(withTrailingSlash(`/collection/${slug}`));
  }

  // Deterministyczna deduplikacja z zachowaniem kolejnosci pierwszego wystapienia.
  return paths.filter((path, index) => paths.indexOf(path) === index);
}

/**
 * Serializuje liste datasetow do poprawnego XML sitemap.
 * baseUrl to domena origin (np. https://example.com) bez koncowego "/".
 * lastmod (opcjonalny, format YYYY-MM-DD) jest wpisywany do kazdego <url>.
 */
export function buildSitemapXml(
  datasets: SitemapDataset[],
  baseUrl: string,
  citySeeds: Entity[] = [],
  indexPaths: string[] = [],
  collectionSlugs: string[] = [],
  lastmod?: string,
): string {
  const base = stripTrailingSlashes(baseUrl);
  const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
  const body = buildSitemapPaths(datasets, citySeeds, indexPaths, collectionSlugs)
    .map((path) => `  <url>\n    <loc>${base}${path}</loc>${lastmodTag}\n  </url>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
