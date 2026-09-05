// Statyczna mapa bez JavaScriptu: mozaika kafelkow OSM (slippy map) + pinezka
// i/lub sciezka SVG w pikselach. Wszystko liczone deterministycznie na etapie
// builda; w przegladarce sa tylko <img> i <svg>.

import type { LatLng, StaticMapModel, TrailGeometry } from './types.ts';

const TILE = 256;
const TILE_URL = 'https://tile.openstreetmap.org';

function lngToX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}
function latToY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

export function osmUrl(c: LatLng, zoom = 16): string {
  return `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lng}#map=${zoom}/${c.lat}/${c.lng}`;
}
export function googleMapsUrl(c: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`;
}
export function googleDirectionsUrl(c: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
}

/** Dobiera zoom tak, aby bbox miescil sie w siatce cols x rows kafelkow. */
export function zoomForBbox(bbox: number[], cols: number, rows: number, maxZoom = 15, minZoom = 8): number {
  const [minLat, minLng, maxLat, maxLng] = bbox;
  for (let z = maxZoom; z >= minZoom; z--) {
    const w = (lngToX(maxLng, z) - lngToX(minLng, z)) * TILE;
    const h = (latToY(minLat, z) - latToY(maxLat, z)) * TILE;
    if (w <= cols * TILE * 0.9 && h <= rows * TILE * 0.9) return z;
  }
  return minZoom;
}

export interface StaticMapOptions {
  center: LatLng;
  zoom: number;
  cols?: number;
  rows?: number;
  pin?: boolean;
  geometry?: TrailGeometry | null;
  markers?: { point: LatLng; label: string }[];
  alt: string;
}

/**
 * Buduje mozaike kafelkow wysrodkowana na `center`. Zwraca URL-e kafelkow,
 * pozycje pinezki i sciezki SVG (geometria szlaku) w pikselach mapy.
 */
export function buildStaticMap(opts: StaticMapOptions): StaticMapModel {
  const cols = opts.cols ?? 3;
  const rows = opts.rows ?? 2;
  const z = opts.zoom;
  const cx = lngToX(opts.center.lng, z);
  const cy = latToY(opts.center.lat, z);
  const n = 2 ** z;
  // Lewy gorny kafelek tak, aby center byl w srodku mozaiki.
  const originX = Math.floor(cx - cols / 2);
  const originY = Math.floor(cy - rows / 2);
  // Przesuniecie w pikselach, zeby center trafil dokladnie w srodek (nie w srodek kafelka).
  const shiftX = Math.round((cx - cols / 2 - originX) * TILE);
  const shiftY = Math.round((cy - rows / 2 - originY) * TILE);

  const tiles: string[][] = [];
  for (let r = 0; r <= rows; r++) {
    const row: string[] = [];
    for (let c = 0; c <= cols; c++) {
      const tx = ((originX + c) % n + n) % n;
      const ty = Math.max(0, Math.min(n - 1, originY + r));
      row.push(`${TILE_URL}/${z}/${tx}/${ty}.png`);
    }
    tiles.push(row);
  }
  const widthPx = cols * TILE;
  const heightPx = rows * TILE;
  const toPx = (p: LatLng) => ({
    x: Math.round((lngToX(p.lng, z) - originX) * TILE - shiftX),
    y: Math.round((latToY(p.lat, z) - originY) * TILE - shiftY),
  });

  const paths: string[] = [];
  if (opts.geometry?.lines?.length) {
    for (const line of opts.geometry.lines) {
      const pts = line.map(([lat, lng]) => toPx({ lat, lng }));
      // Odfiltruj punkty daleko poza mapa, zeby nie rysowac gigantycznych sciezek.
      const d = pts
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`)
        .join(' ');
      if (pts.length >= 2) paths.push(d);
    }
  }
  const markers = (opts.markers ?? []).map((m) => ({ ...toPx(m.point), label: m.label }));

  return {
    zoom: z,
    cols,
    rows,
    tiles,
    widthPx,
    heightPx,
    pin: opts.pin === false ? null : toPx(opts.center),
    paths,
    markers,
    osmUrl: osmUrl(opts.center, z),
    googleUrl: googleMapsUrl(opts.center),
    alt: opts.alt,
    // shift used by the view to offset the tile grid
    ...({ shiftX, shiftY } as object),
  } as StaticMapModel & { shiftX: number; shiftY: number };
}
