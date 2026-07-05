// Pomocnicze funkcje tekstowe PL: deterministyczna odmiana liczebnikow.
// Zasady polskiej pluralizacji:
//  - 1                                  -> forma pojedyncza ("1 obiekt")
//  - konc. 2-4, poza 12-14              -> forma mnoga "few" ("22 obiekty")
//  - pozostale (0, 5-21, 25-31, ...)    -> forma mnoga "many" ("5 obiektow")

/** Zwraca poprawna forme rzeczownika dla liczby n. */
export function pluralPl(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  if (abs === 1) return one;
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** "N obiekt/obiekty/obiektów" — najczestszy licznik w katalogu. */
export function countObjectsPl(n: number): string {
  return `${n} ${pluralPl(n, 'obiekt', 'obiekty', 'obiektów')}`;
}

/** "N region/regiony/regionów". */
export function countRegionsPl(n: number): string {
  return `${n} ${pluralPl(n, 'region', 'regiony', 'regionów')}`;
}

/** "N miasto/miasta/miast". */
export function countCitiesPl(n: number): string {
  return `${n} ${pluralPl(n, 'miasto', 'miasta', 'miast')}`;
}
