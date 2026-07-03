// Warstwa keyword mapping. Deterministycznie wyprowadza slowa kluczowe
// wylacznie z danych encji (typ + lokalizacja). Nie tworzy nowych faktow.

import type { Entity, TypeConfig } from './types.js';

export interface KeywordMap {
  /** Glowne slowo kluczowe: "{type} {city}". */
  primary: string;
  /** Slowa kluczowe pomocnicze wyprowadzone z lokalizacji. */
  secondary: string[];
  /** Pelna, odduplikowana lista slow kluczowych (primary + secondary). */
  all: string[];
}

/**
 * Buduje mape slow kluczowych z encji i konfiguracji typu.
 * Wzorce (deterministyczne, oparte wylacznie o dane):
 *  - primary:   "{noun} {city}"
 *  - secondary: "{noun} w {region}", "najlepsze {noun} {city}", "{noun} blisko mnie"
 * Pola bez danych sa pomijane (zasada: nie zgaduj).
 */
export function buildKeywords(entity: Entity, config: TypeConfig): KeywordMap {
  const noun = config.keywordNoun;
  const city = entity.location?.city ?? '';
  const region = entity.location?.region ?? '';

  const primary = [noun, city].filter(Boolean).join(' ');

  const secondary: string[] = [];
  if (region) {
    secondary.push(`${noun} w ${region}`);
  }
  if (city) {
    secondary.push(`najlepsze ${noun} ${city}`);
  }
  secondary.push(`${noun} blisko mnie`);

  const all = [primary, ...secondary].filter(
    (value, index, list) => value.length > 0 && list.indexOf(value) === index,
  );

  return { primary, secondary, all };
}
