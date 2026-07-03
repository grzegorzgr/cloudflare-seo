// Warstwa CONFIG: globalna konfiguracja SEO calego systemu.
// Jedyne zrodlo prawdy dla origin domeny i metadanych witryny.
// Uzywane przez generator sitemap, JSON-LD ItemList oraz build Astro.

export interface SeoConfig {
  /** Origin witryny bez koncowego slasha, np. https://example.com. */
  siteUrl: string;
  /** Nazwa witryny (branding, uzywana w tytulach i JSON-LD). */
  siteName: string;
  /** Domyslny jezyk/locale dokumentow. */
  defaultLocale: string;
}

export const seoConfig: SeoConfig = {
  siteUrl: 'https://gdziemy.pl',
  siteName: 'Katalog miejsc',
  defaultLocale: 'pl-PL',
};
