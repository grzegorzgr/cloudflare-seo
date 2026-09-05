// Nazwy wyswietlane i adresy. Bez zaleznosci od indeksu danych (uzywane przez data.ts i place.ts).

import { isGenericName } from './quality.ts';
import type { Entity } from './types.ts';

const attr = (e: Entity, key: string): string | undefined => {
  const v = e.attrs[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
};

export function formatAddress(e: Entity): string | null {
  const a = e.address;
  if (!a) return null;
  const l1 = [a.street, a.housenumber].filter(Boolean).join(' ').trim();
  const l2 = [a.postcode, a.city].filter(Boolean).join(' ').trim();
  const s = [l1, l2].filter(Boolean).join(', ');
  return s || null;
}

/** Nazwa wyswietlana: nazwy kodowe ("P8") wzbogacane o ulice/operatora/miasto z danych. */
export function displayName(e: Entity): string {
  const raw = e.name.trim();
  if (e.type !== 'parking' || !isGenericName(raw)) return raw;
  let label = /parking/i.test(raw) ? raw : `Parking ${raw}`;
  const street = [e.address?.street, e.address?.housenumber].filter(Boolean).join(' ').trim();
  const city = e.address?.city ?? e.location.city ?? null;
  const operator = attr(e, 'operator');
  if (street) return [label, street, city].filter(Boolean).join(', ');
  if (operator && !label.toLowerCase().includes(operator.toLowerCase())) label = `${label} – ${operator}`;
  return [label, city].filter(Boolean).join(', ');
}

/** Kierunek geograficzny (8 stron) z azymutu w stopniach. */
export function compassPl(bearingDeg: number): string {
  const dirs = ['płn.', 'płn.-wsch.', 'wsch.', 'płd.-wsch.', 'płd.', 'płd.-zach.', 'zach.', 'płn.-zach.'];
  const i = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8;
  return dirs[i];
}

export function bearingDeg(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(to.lat));
  const x = Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) - Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
