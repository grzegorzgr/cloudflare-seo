// Deterministyczna normalizacja tekstu do slug (URL-safe).
// Uzywana m.in. do budowania sciezek /region/{slug}. Bez losowosci.

const POLISH_CHARS: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

/**
 * Zamienia dowolny tekst na deterministyczny slug:
 * lowercase, polskie znaki -> ASCII, spacje/znaki -> "-".
 * Ten sam input zawsze daje ten sam output.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .split('')
    .map((char) => POLISH_CHARS[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    // Separatory sa juz scalone do pojedynczego "-", wiec wystarczy usunac
    // co najwyzej jeden wiodacy/koncowy myslnik. Bez kwantyfikatora "+"
    // (unikamy polynomial ReDoS na niekontrolowanych nazwach z OSM).
    .replace(/^-|-$/g, '');
}

/**
 * Usuwa koncowe ukosniki z URL/sciezki w czasie liniowym (bez regexa),
 * co eliminuje ryzyko polynomial ReDoS na niekontrolowanym wejsciu.
 */
export function stripTrailingSlashes(input: string): string {
  let end = input.length;
  while (end > 0 && input.charCodeAt(end - 1) === 47 /* '/' */) {
    end -= 1;
  }
  return input.slice(0, end);
}

