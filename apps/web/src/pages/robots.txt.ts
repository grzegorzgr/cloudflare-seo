// robots.txt endpoint (SSG). Prerenderowany do /robots.txt na etapie build.
// Domena pochodzi z config/seo.config.ts (jedno zrodlo prawdy).
// Uwaga: Cloudflare moze doklejac wlasny "Managed content" (Content Signals)
// przed trescia tego pliku — to ustawienie dashboardu, nie kodu.
import type { APIRoute } from 'astro';
import { seoConfig } from '@config/seo.config.ts';

export const GET: APIRoute = () => {
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${seoConfig.siteUrl}/sitemap.xml`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
