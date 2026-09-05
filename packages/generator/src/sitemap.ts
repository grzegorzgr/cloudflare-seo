// Sitemap: tylko strony indeksowalne, lastmod z danych (nie z daty builda).

import { paths, site, TYPE_ORDER, typeConfigs } from './configs.ts';
import { buildCityModel, buildCityTypeModel } from './hubs.ts';
import { assessEntity } from './quality.ts';
import type { DataIndex } from './data.ts';
import type { EntityType } from './types.ts';

export interface SitemapEntry {
  loc: string;
  lastmod: string;
}

const STATIC_PATHS = [
  paths.home,
  paths.cities,
  paths.regions,
  ...TYPE_ORDER.map((t) => typeConfigs[t].indexPath),
  paths.about,
  paths.methodology,
  paths.sources,
  paths.contact,
  paths.terms,
  paths.privacy,
];

export function buildSitemapEntries(index: DataIndex, siteUrl: string): SitemapEntry[] {
  const base = siteUrl.replace(/\/+$/, '');
  const dataDate = index.bundle.meta.generatedAt;
  const entries: SitemapEntry[] = [];
  const seen = new Set<string>();
  const push = (path: string, lastmod: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    entries.push({ loc: `${base}${path}`, lastmod });
  };

  for (const p of STATIC_PATHS) push(p, dataDate);

  for (const region of index.bundle.regions) push(paths.region(region.slug), dataDate);

  for (const city of index.bundle.cities) {
    const model = buildCityModel(city.slug, index, siteUrl);
    if (model.robots === 'index') push(paths.city(city.slug), dataDate);
    for (const type of TYPE_ORDER as EntityType[]) {
      const m = buildCityTypeModel(city.slug, type, index, siteUrl);
      if (m && m.robots === 'index') push(paths.cityType(city.slug, type), dataDate);
    }
  }

  for (const list of [index.bundle.parkings, index.bundle.trails, index.bundle.beaches]) {
    for (const e of list) {
      if (!assessEntity(e).indexable) continue;
      // lastmod = ostatnia realna zmiana strony: nowsza z (edycja obiektu w OSM,
      // wersja tresci/szablonow). Nigdy "data builda" dla wszystkiego.
      const edit = e.osm?.timestamp?.slice(0, 10) ?? '';
      const candidates = [edit, site.contentVersion].filter(Boolean).filter((d) => d <= dataDate);
      const lastmod = candidates.length ? candidates.sort().reverse()[0] : dataDate;
      push(paths.entity(e.type, e.slug), lastmod);
    }
  }
  return entries;
}

export function renderSitemapXml(entries: SitemapEntry[]): string {
  const body = entries
    .map((e) => `  <url>\n    <loc>${e.loc}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
