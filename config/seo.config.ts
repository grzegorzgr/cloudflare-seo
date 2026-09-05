// Globalna konfiguracja SEO: jedyne zrodlo prawdy dla origin domeny.

export interface SeoConfig {
  /** Origin witryny bez koncowego slasha. */
  siteUrl: string;
  siteName: string;
  defaultLocale: string;
}

export const seoConfig: SeoConfig = {
  siteUrl: 'https://gdziemy.pl',
  siteName: 'gdziemy.pl',
  defaultLocale: 'pl-PL',
};
