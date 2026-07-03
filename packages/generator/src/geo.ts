// Warstwa GEO: deterministyczne obliczenia przestrzenne.
// Wylacznie czysta matematyka na istniejacych wspolrzednych z /packages/data.
// Zero inference, zero zgadywania - jesli brak wspolrzednych, funkcje zwracaja null.

import type { Entity, EntityCoordinates } from './types.js';

/** Promien Ziemi w kilometrach (WGS84, wartosc stala). */
const EARTH_RADIUS_KM = 6371;

/** Zwraca true, gdy wspolrzedne sa kompletne i liczbowe. */
export function hasCoordinates(
  coordinates: EntityCoordinates | null | undefined,
): coordinates is { lat: number; lng: number } {
  return (
    !!coordinates &&
    typeof coordinates.lat === 'number' &&
    typeof coordinates.lng === 'number' &&
    Number.isFinite(coordinates.lat) &&
    Number.isFinite(coordinates.lng)
  );
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

/**
 * Deterministyczny dystans haversine w kilometrach miedzy dwiema encjami.
 * Zwraca null, gdy ktorakolwiek encja nie ma kompletnych wspolrzednych
 * (zasada: nie zgaduj odleglosci bez danych).
 */
export function distanceKm(a: Entity, b: Entity): number | null {
  if (!hasCoordinates(a.coordinates) || !hasCoordinates(b.coordinates)) {
    return null;
  }
  const lat1 = a.coordinates.lat;
  const lng1 = a.coordinates.lng;
  const lat2 = b.coordinates.lat;
  const lng2 = b.coordinates.lng;

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);

  const h =
    sinLat * sinLat +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * sinLng * sinLng;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Deterministyczny komparator odleglosci wzgledem encji origin.
 * Encje z brakiem wspolrzednych (dystans null) laduja na koncu.
 * Remisy rozstrzyga slug alfabetycznie -> pelna odtwarzalnosc.
 */
export function byDistanceFrom(
  origin: Entity,
): (a: Entity, b: Entity) => number {
  return (a, b) => {
    const da = distanceKm(origin, a);
    const db = distanceKm(origin, b);
    if (da === null && db === null) {
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    }
    if (da === null) return 1;
    if (db === null) return -1;
    if (da !== db) return da - db;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  };
}
