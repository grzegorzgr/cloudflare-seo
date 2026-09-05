// Brama jakosci strony encji: jedna funkcja decyduje o indeksacji, sitemapie
// i klasyfikacji (INDEX / IMPROVE / NOINDEX). Uzywana przez generator stron,
// sitemap ORAZ analizator jakosci (scripts/quality), zeby nie bylo rozjazdu.
//
// Filozofia: strona jest indeksowana tylko, gdy odpowiada na realna potrzebe
// (gdzie to jest + co warto wiedziec), a nie dlatego, ze istnieje rekord.

import { isRestrictedAccess } from './labels.ts';
import type { Entity, QualityAssessment } from './types.ts';

/** Nazwy kodowe / zbyt ogolne, ktore same nie identyfikuja miejsca. */
const GENERIC_NAME = [
  /^p[\s-]?\d+[a-z]?$/i, // P8, P-8, P3A
  /^parking(\s*(nr\.?\s*)?\d+)?$/i,
  /^parking\s+(płatny|bezpłatny|premium|piętrowy|podziemny|strzeżony|dla klientów|dla gości|pracowniczy|hotelowy|buforowy)$/i,
  /^(bis|tir|bus|kiss\s*&\s*ride|k\+r|p\+r|park\s*&\s*ride|parking p\+r|sektor\s*\S+|strefa\s*\S+|poziom\s*[-\d]+)$/i,
  /^(płatny|bezpłatny|darmowy|prywatny|strzeżony|publiczny|gratis|parking (płatny|bezpłatny)\s*\d*)$/i,
  /^parking (dla|przy) (autobusów|autokarów|rowerów|pracowników|klientów|gości|niepełnosprawnych)(\s.*)?$/i,
  /^\S{1,3}$/,
];

export function isGenericName(name: string): boolean {
  const n = name.trim();
  return GENERIC_NAME.some((re) => re.test(n));
}

/** Klucze attrs liczone jako "uzyteczny fakt" dla kazdego typu. */
const USEFUL_ATTRS: Record<string, string[]> = {
  parking: [
    'parking', 'fee', 'fee_conditional', 'capacity', 'capacity_disabled', 'capacity_charging',
    'opening_hours', 'charge', 'access', 'operator', 'surface', 'lit', 'supervised', 'covered',
    'park_ride', 'maxstay', 'maxheight', 'payment', 'wheelchair', 'website', 'phone',
  ],
  beach: [
    'surface', 'supervised', 'lifeguard', 'dog', 'fee', 'opening_hours', 'operator', 'website',
    'wheelchair', 'nudism', 'toilets', 'shower', 'phone', 'seasonal',
  ],
  trail: [
    'route', 'network', 'network_pl', 'ref', 'colour', 'colour_pl', 'osmc_symbol', 'distance', 'from', 'to',
    'roundtrip', 'ascent', 'descent', 'operator', 'website', 'sac_scale', 'mtb_scale', 'cycle_network',
  ],
};

export function countUsefulFacts(entity: Entity): number {
  const keys = USEFUL_ATTRS[entity.type] ?? [];
  let n = 0;
  for (const k of keys) if (entity.attrs[k] != null && entity.attrs[k] !== '') n++;
  if (entity.address?.street) n++;
  if (entity.description) n++;
  if (entity.notes.length) n++;
  if (entity.type === 'trail' && entity.computed?.lengthKm) n++;
  return n;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/**
 * Ocena encji. Progi indeksacji:
 *  - parking: publiczny (nie private/no/permit), >=3 faktow, nazwa nie-kodowa albo adres/operator
 *  - plaza:   >=1 fakt albo parking w poblizu (mapa + dojazd = realna odpowiedz)
 *  - szlak:   znana dlugosc >= 1 km i >=3 faktow (dlugosc + typ + cos jeszcze)
 */
export function assessEntity(entity: Entity): QualityAssessment {
  const reasons: string[] = [];
  const facts = countUsefulFacts(entity);
  const rel = entity.rel ?? { parkings: [], beaches: [], trails: [], cities: [] };
  const relCount = rel.parkings.length + rel.beaches.length + rel.trails.length;
  let indexable = true;

  if (!entity.coordinates || !Number.isFinite(entity.coordinates.lat)) {
    indexable = false;
    reasons.push('brak współrzędnych');
  }

  if (entity.type === 'parking') {
    const access = typeof entity.attrs.access === 'string' ? entity.attrs.access : undefined;
    if (isRestrictedAccess(access)) {
      indexable = false;
      reasons.push(`parking bez dostępu publicznego (access=${access})`);
    }
    if (facts < 3) {
      indexable = false;
      reasons.push(`za mało faktów (${facts} < 3)`);
    }
    if (isGenericName(entity.name) && !entity.address?.street && !entity.attrs.operator) {
      indexable = false;
      reasons.push('nazwa kodowa bez adresu i operatora');
    }
  } else if (entity.type === 'beach') {
    if (facts < 1 && rel.parkings.length === 0) {
      indexable = false;
      reasons.push('brak faktów i brak parkingu w pobliżu');
    }
  } else if (entity.type === 'trail') {
    const len = entity.computed?.lengthKm ?? (entity.attrs.distance ? Number(String(entity.attrs.distance).replace(',', '.')) : null);
    if (!len || !(len >= 1)) {
      indexable = false;
      reasons.push('brak wiarygodnej długości (< 1 km lub nieznana)');
    }
    if (facts < 3) {
      indexable = false;
      reasons.push(`za mało faktów (${facts} < 3)`);
    }
    if (entity.computed?.superroute && !entity.rel.parts?.length && !len) {
      indexable = false;
      reasons.push('superroute bez członów i długości');
    }
    const state = typeof entity.attrs.state === 'string' ? entity.attrs.state : undefined;
    if (state && ['proposed', 'construction', 'disused', 'abandoned'].includes(state)) {
      indexable = false;
      reasons.push(`szlak o statusie ${state} (nieoznakowany / nieużywany)`);
    }
  }

  // Punktacja 0-100 (przyblizenie wag z briefu; miary strony HTML dolicza analizator).
  const dataValue = clamp((facts / 8) * 20, 0, 20);
  const originalValue = clamp(
    (entity.type === 'trail' && entity.computed?.lengthKm ? 8 : 0) +
      Math.min(relCount, 6) * 1.5 +
      (entity.description ? 3 : 0),
    0,
    20,
  );
  const intent =
    entity.type === 'parking'
      ? clamp((entity.attrs.fee ? 6 : 0) + (entity.attrs.capacity ? 5 : 0) + (entity.attrs.opening_hours ? 4 : 0) + (entity.attrs.parking ? 3 : 0) + (entity.address?.street ? 2 : 0), 0, 20)
      : entity.type === 'trail'
        ? clamp((entity.computed?.lengthKm || entity.attrs.distance ? 8 : 0) + (entity.attrs.route ? 5 : 0) + (entity.attrs.colour || entity.attrs.osmc_symbol || entity.attrs.colour_pl ? 4 : 0) + (entity.attrs.from || entity.computed?.start ? 3 : 0), 0, 20)
        : clamp((rel.parkings.length ? 8 : 0) + (entity.attrs.lifeguard || entity.attrs.supervised ? 5 : 0) + (entity.attrs.dog ? 3 : 0) + (entity.attrs.fee ? 2 : 0) + (entity.attrs.surface ? 2 : 0), 0, 20);
  const context = clamp(Math.min(rel.cities.length, 2) * 2 + Math.min(relCount, 6), 0, 10);
  const trust = clamp((entity.osm?.timestamp ? 5 : entity.source === 'curated' ? 3 : 0) + (entity.osm?.checkDate ? 3 : 0) + (entity.attrs.website ? 2 : 0), 0, 10);
  const discovery = clamp((entity.location.hubSlug ? 5 : 2) + Math.min(relCount, 5), 0, 10);
  const ux = 8; // mapa + tabela faktow + breadcrumbs sa zawsze (statyczny szablon)

  const score = Math.round(dataValue + originalValue + intent + context + trust + discovery + ux);
  const verdict: QualityAssessment['verdict'] = !indexable ? 'NOINDEX' : score >= 60 ? 'INDEX' : 'IMPROVE';
  return { score, indexable, verdict, reasons, factCount: facts };
}
