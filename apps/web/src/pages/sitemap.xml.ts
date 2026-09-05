// Sitemap (SSG): tylko strony indeksowalne, lastmod z danych.
import type { APIRoute } from 'astro';
import { buildSitemapEntries, renderSitemapXml } from '@generator';
import { index, siteUrl } from '../lib/data';

export const GET: APIRoute = () => {
  const xml = renderSitemapXml(buildSitemapEntries(index, siteUrl));
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
