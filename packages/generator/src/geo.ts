// Czysta geometria: odleglosc haversine miedzy punktami.

import type { LatLng } from './types.ts';

const EARTH_RADIUS_KM = 6371;

export function hasCoordinates(c: LatLng | null | undefined): c is LatLng {
  return !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng);
}

/** Odleglosc w km (null, gdy brak wspolrzednych). */
export function distanceKm(a: LatLng | null | undefined, b: LatLng | null | undefined): number | null {
  if (!hasCoordinates(a) || !hasCoordinates(b)) return null;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
