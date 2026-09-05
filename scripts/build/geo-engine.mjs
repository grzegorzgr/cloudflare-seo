#!/usr/bin/env node
// =============================================================================
// GEO ENGINE v2 — deterministyczny builder datasetu (cache OSM + curated -> data)
// =============================================================================
// Ten skrypt NIE dotyka sieci. Wejscie:
//   scripts/build/cache/osm/{region}.pois.json     (fetch-osm.mjs, out center tags meta)
//   scripts/build/cache/osm/{region}.routes.json   (fetch-osm.mjs, out geom meta)
//   packages/data/curated/{beaches,parkings,trails}.json (recznie utrzymywane)
//   packages/data/cities.json, regions.json        (seed-cities.mjs)
// Wyjscie (generowane, wersjonowane w repo):
//   packages/data/{beaches,parkings,trails}.json   (encje z attrs, provenance, relacje)
//   packages/data/trail-geometry.json              (uproszczona geometria szlakow)
//   packages/data/dataset-meta.json                (data budowy, zrodla, liczniki)
//   scripts/build/reports/*.json                   (raporty diagnostyczne)
//
// ZASADY:
//   - kazde pole encji pochodzi z jawnego tagu OSM albo z pliku curated,
//   - jedyne "nowe" informacje to OBLICZENIA geometryczne (dlugosc, odleglosc,
//     punkt startu/konca, petla, sasiedztwo) — opisane w /metodologia/,
//   - ten sam cache zawsze daje identyczny dataset (sortowanie, zaokraglenia),
//   - brak danych = brak pola (nie zgadujemy).
//
// Uzycie:
//   node scripts/build/geo-engine.mjs            # dry-run: raporty, bez zapisu
//   node scripts/build/geo-engine.mjs --write    # zapis packages/data
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, '../../packages/data');
const CURATED_DIR = resolve(DATA_DIR, 'curated');
const CACHE_DIR = resolve(HERE, 'cache/osm');
const REPORTS_DIR = resolve(HERE, 'reports');

// --- Parametry przestrzenne (km) ----------------------------------------------
const P = {
  hubLinkKm: 25, // POI przypisany do huba w tym promieniu
  hubListKm: 30, // lista "miasta w okolicy" dla POI
  routeCityKm: 10, // miasto "na trasie" szlaku: hub w tym promieniu od linii
  routeKeepKm: 15, // szlak zachowany tylko, gdy jego linia lezy do 15 km od jakiegos huba
  parkingNearParkingKm: 2,
  parkingNearBeachKm: 3,
  beachNearParkingKm: 1.5,
  beachNearBeachKm: 5,
  poiNearRouteKm: 1.5, // parking/plaza "przy szlaku": odleglosc od linii
  routeNearRouteKm: 0.3, // szlaki "laczace sie": zblizenie linii
  simplifyM: 20, // tolerancja Douglas-Peucker dla geometrii (m)
  maxRel: { parkings: 8, beaches: 6, trails: 8, cities: 5, routesForPoi: 6 },
};

const EARTH_RADIUS_KM = 6371;
const POLISH_CHARS = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .split('')
    .map((c) => POLISH_CHARS[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const hasCoords = (c) => !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng);

function haversineKm(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Lokalna projekcja na metry (rownoodleglosciowa) — wystarczajaca dla odleglosci
// punkt-odcinek na skali kilku kilometrow.
function projector(lat0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  return (p) => ({ x: p.lng * kx, y: p.lat * ky });
}
function pointSegmentDistM(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + t * dx;
  const qy = a.y + t * dy;
  return Math.hypot(p.x - qx, p.y - qy);
}
/** Min. odleglosc (km) punktu od lamanej [[lat,lng],...]. */
function pointToLineKm(pt, line) {
  if (!line || line.length === 0) return null;
  const proj = projector(pt.lat);
  const p = proj(pt);
  let best = Infinity;
  let prev = proj({ lat: line[0][0], lng: line[0][1] });
  if (line.length === 1) return Math.hypot(p.x - prev.x, p.y - prev.y) / 1000;
  for (let i = 1; i < line.length; i++) {
    const cur = proj({ lat: line[i][0], lng: line[i][1] });
    const d = pointSegmentDistM(p, prev, cur);
    if (d < best) best = d;
    prev = cur;
  }
  return best / 1000;
}
function pointToLinesKm(pt, lines) {
  let best = null;
  for (const line of lines) {
    const d = pointToLineKm(pt, line);
    if (d !== null && (best === null || d < best)) best = d;
  }
  return best;
}

// --- Douglas-Peucker (w metrach) ---------------------------------------------
function simplifyLine(points, toleranceM) {
  if (points.length <= 2) return points;
  const proj = projector(points[0][0]);
  const pts = points.map((p) => proj({ lat: p[0], lng: p[1] }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegmentDistM(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > toleranceM && idx !== -1) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}
function lineLengthKm(line) {
  let km = 0;
  for (let i = 1; i < line.length; i++) {
    km += haversineKm({ lat: line[i - 1][0], lng: line[i - 1][1] }, { lat: line[i][0], lng: line[i][1] });
  }
  return km;
}
const r5 = (v) => Math.round(v * 1e5) / 1e5;

// -----------------------------------------------------------------------------
// Normalizacja POI (parking / plaza) — tylko jawne tagi
// -----------------------------------------------------------------------------
const PARKING_ATTR_TAGS = {
  parking: 'parking',
  access: 'access',
  fee: 'fee',
  fee_conditional: 'fee:conditional',
  capacity: 'capacity',
  capacity_disabled: 'capacity:disabled',
  capacity_charging: 'capacity:charging',
  capacity_parent: 'capacity:parent',
  capacity_bus: 'capacity:bus',
  maxstay: 'maxstay',
  maxheight: 'maxheight',
  surface: 'surface',
  lit: 'lit',
  supervised: 'supervised',
  covered: 'covered',
  park_ride: 'park_ride',
  opening_hours: 'opening_hours',
  charge: 'charge',
  operator: 'operator',
  operator_type: 'operator:type',
  website: null, // specjalnie nizej (website / contact:website)
  phone: null,
  email: null,
  wheelchair: 'wheelchair',
  hgv: 'hgv',
  bus: 'bus',
  tourist_bus: 'tourist_bus',
  kiss_ride: 'kiss_ride',
  orientation: 'orientation',
  ref: 'ref',
};
const BEACH_ATTR_TAGS = {
  surface: 'surface',
  supervised: 'supervised',
  lifeguard: 'lifeguard',
  dog: 'dog',
  fee: 'fee',
  opening_hours: 'opening_hours',
  operator: 'operator',
  wheelchair: 'wheelchair',
  nudism: 'nudism',
  toilets: 'toilets',
  shower: 'shower',
  access: 'access',
  seasonal: 'seasonal',
};
const PAYMENT_TAGS = [
  ['payment:cash', 'cash'],
  ['payment:coins', 'coins'],
  ['payment:credit_cards', 'cards'],
  ['payment:debit_cards', 'cards'],
  ['payment:cards', 'cards'],
  ['payment:contactless', 'contactless'],
  ['payment:app', 'app'],
  ['payment:mobile_phone', 'app'],
  ['payment:sms', 'sms'],
];

function pickAttrs(tags, map) {
  const attrs = {};
  for (const [key, tag] of Object.entries(map)) {
    if (!tag) continue;
    const v = tags[tag];
    if (v != null && String(v).trim() !== '') attrs[key] = String(v).trim();
  }
  return attrs;
}
function pickContacts(tags, attrs) {
  const website = tags.website ?? tags['contact:website'] ?? tags.url ?? null;
  const phone = tags.phone ?? tags['contact:phone'] ?? null;
  const email = tags.email ?? tags['contact:email'] ?? null;
  if (website && /^https?:\/\//i.test(website)) attrs.website = website.trim();
  if (phone) attrs.phone = String(phone).trim();
  if (email) attrs.email = String(email).trim();
}
function pickPayment(tags, attrs) {
  const methods = [];
  for (const [tag, label] of PAYMENT_TAGS) {
    if (tags[tag] === 'yes' && !methods.includes(label)) methods.push(label);
  }
  if (methods.length) attrs.payment = methods;
}
function resolveAddress(tags) {
  const street = tags['addr:street'] ?? null;
  const housenumber = tags['addr:housenumber'] ?? null;
  const postcode = tags['addr:postcode'] ?? null;
  const city = tags['addr:city'] ?? null;
  if (!street && !housenumber && !postcode && !city) return null;
  return { street, housenumber, postcode, city };
}
function osmMeta(el) {
  return {
    type: el.type,
    id: el.id,
    timestamp: el.timestamp ?? null,
    version: el.version ?? null,
    checkDate: el.tags?.check_date ?? el.tags?.['survey:date'] ?? null,
  };
}
function elCoords(el) {
  if (Number.isFinite(el.lat) && Number.isFinite(el.lon)) return { lat: el.lat, lng: el.lon };
  if (el.center && Number.isFinite(el.center.lat)) return { lat: el.center.lat, lng: el.center.lon };
  if (el.bounds) {
    return { lat: (el.bounds.minlat + el.bounds.maxlat) / 2, lng: (el.bounds.minlon + el.bounds.maxlon) / 2 };
  }
  return null;
}

function normalizePoi(el) {
  const tags = el.tags ?? {};
  const name = tags.name?.trim();
  if (!name) return null;
  let type = null;
  if (tags.amenity === 'parking') type = 'parking';
  else if (tags.natural === 'beach' || tags.leisure === 'beach_resort') type = 'beach';
  if (!type) return null;
  const coordinates = elCoords(el);
  if (!coordinates) return null;
  const attrs = type === 'parking' ? pickAttrs(tags, PARKING_ATTR_TAGS) : pickAttrs(tags, BEACH_ATTR_TAGS);
  if (type === 'beach') attrs.kind = tags.leisure === 'beach_resort' ? 'beach_resort' : 'beach';
  pickContacts(tags, attrs);
  if (type === 'parking') pickPayment(tags, attrs);
  return {
    slug: `${slugify(name)}-${el.id}`,
    name,
    type,
    source: 'osm',
    osm: osmMeta(el),
    location: {
      city: tags['addr:city'] ?? null,
      region: null,
      hubSlug: null,
      hubDistanceKm: null,
    },
    address: resolveAddress(tags),
    coordinates,
    description: tags.description?.trim() || null,
    notes: [],
    attrs,
  };
}

// -----------------------------------------------------------------------------
// Normalizacja szlakow (relation route=*) + przetwarzanie geometrii
// -----------------------------------------------------------------------------
const ROUTE_ATTR_TAGS = {
  route: 'route',
  network: 'network',
  cycle_network: 'cycle_network',
  ref: 'ref',
  colour: 'colour',
  osmc_symbol: 'osmc:symbol',
  symbol: 'symbol',
  distance: 'distance',
  from: 'from',
  to: 'to',
  via: 'via',
  roundtrip: 'roundtrip',
  ascent: 'ascent',
  descent: 'descent',
  operator: 'operator',
  complete: 'complete',
  state: 'state',
  wikipedia: 'wikipedia',
  sac_scale: 'sac_scale',
  mtb_scale: 'mtb:scale',
  pilgrimage: 'pilgrimage',
};
const EXCLUDED_ROLES = new Set([
  'alternative', 'alternate', 'excursion', 'approach', 'connection', 'variant',
  'shortcut', 'link', 'detour', 'platform', 'stop', 'guidepost', 'marker',
]);

function processRouteGeometry(el) {
  const members = Array.isArray(el.members) ? el.members : [];
  const ways = members.filter((m) => m.type === 'way' && Array.isArray(m.geometry) && m.geometry.length > 1);
  const childRelations = members.filter((m) => m.type === 'relation').map((m) => m.ref);
  const roles = new Set(ways.map((m) => m.role ?? ''));
  const hasFwd = roles.has('forward');
  const hasBwd = roles.has('backward');
  const main = ways.filter((m) => {
    const role = m.role ?? '';
    if (EXCLUDED_ROLES.has(role)) return false;
    if (hasFwd && hasBwd && role === 'backward') return false; // nie liczymy dwa razy
    return true;
  });
  const rawLines = main.map((m) => m.geometry.map((g) => [g.lat, g.lon]));

  let lengthKm = 0;
  for (const line of rawLines) lengthKm += lineLengthKm(line);

  // Graf koncow odcinkow -> koncowki, petla, fragmentacja.
  // Tolerancja luk: konce odcinkow oddalone < GAP_M traktujemy jako polaczone
  // (typowe drobne przerwy w mapowaniu nie sa "fragmentacja" szlaku).
  const GAP_M = 120;
  const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const deg = new Map();
  const parent = new Map();
  const find = (k) => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const line of rawLines) {
    const a = key(line[0]);
    const b = key(line[line.length - 1]);
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    deg.set(a, (deg.get(a) ?? 0) + 1);
    deg.set(b, (deg.get(b) ?? 0) + 1);
    union(a, b);
  }
  // Sklejanie luk: pary koncow (stopien 1) blizej niz GAP_M lacza komponenty.
  let endpointKeys = [...deg.entries()].filter(([, d]) => d === 1).map(([k]) => k);
  const endPts = endpointKeys.map((k) => ({ k, p: k.split(',').map(Number) }));
  const gapPairs = [];
  for (let i = 0; i < endPts.length; i++) {
    for (let j = i + 1; j < endPts.length; j++) {
      const d = haversineKm({ lat: endPts[i].p[0], lng: endPts[i].p[1] }, { lat: endPts[j].p[0], lng: endPts[j].p[1] }) * 1000;
      if (d <= GAP_M) gapPairs.push([d, i, j]);
    }
  }
  gapPairs.sort((a, b) => a[0] - b[0]);
  const gapUsed = new Set();
  for (const [, i, j] of gapPairs) {
    if (gapUsed.has(i) || gapUsed.has(j)) continue;
    gapUsed.add(i);
    gapUsed.add(j);
    union(endPts[i].k, endPts[j].k);
    deg.set(endPts[i].k, 2);
    deg.set(endPts[j].k, 2);
  }
  endpointKeys = [...deg.entries()].filter(([, d]) => d === 1).map(([k]) => k);
  const roots = new Set([...parent.keys()].map((k) => find(k)));
  const components = roots.size;

  // Uporzadkowanie odcinkow w lancuch (1 komponent, <=2 konce; luki do GAP_M dozwolone).
  let chain = null;
  if (rawLines.length > 0 && components === 1 && endpointKeys.length <= 2) {
    chain = chainLines(rawLines, endpointKeys[0] ? endpointKeys[0].split(',').map(Number) : rawLines[0][0], GAP_M);
  }
  const isLoop = rawLines.length > 0 && components === 1 && endpointKeys.length === 0;
  const fragmented = rawLines.length > 0 && components > 1;
  const branched = rawLines.length > 0 && components === 1 && endpointKeys.length > 2;

  let start = null;
  let end = null;
  if (chain && !isLoop) {
    start = { lat: r5(chain[0][0]), lng: r5(chain[0][1]) };
    end = { lat: r5(chain[chain.length - 1][0]), lng: r5(chain[chain.length - 1][1]) };
  } else if (branched && endpointKeys.length >= 2) {
    // Odgalezienia: za start/mete przyjmujemy dwa najdalej polozone od siebie konce.
    let best = null;
    const pts = endpointKeys.map((k) => k.split(',').map(Number));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = haversineKm({ lat: pts[i][0], lng: pts[i][1] }, { lat: pts[j][0], lng: pts[j][1] });
        if (!best || d > best.d) best = { d, a: pts[i], b: pts[j] };
      }
    }
    if (best) {
      start = { lat: r5(best.a[0]), lng: r5(best.a[1]) };
      end = { lat: r5(best.b[0]), lng: r5(best.b[1]) };
    }
  }

  // Punkt reprezentatywny: srodek dlugosci lancucha (jesli jest), inaczej srodek bbox.
  let bbox = null;
  for (const line of rawLines) {
    for (const [lat, lng] of line) {
      if (!bbox) bbox = [lat, lng, lat, lng];
      else {
        if (lat < bbox[0]) bbox[0] = lat;
        if (lng < bbox[1]) bbox[1] = lng;
        if (lat > bbox[2]) bbox[2] = lat;
        if (lng > bbox[3]) bbox[3] = lng;
      }
    }
  }
  let center = null;
  if (chain) center = pointAlong(chain, lengthKm / 2);
  else if (bbox) center = { lat: (bbox[0] + bbox[2]) / 2, lng: (bbox[1] + bbox[3]) / 2 };
  else if (el.bounds) center = elCoords(el);

  const lines = (chain ? [chain] : rawLines).map((l) =>
    simplifyLine(l, P.simplifyM).map(([lat, lng]) => [r5(lat), r5(lng)]),
  );
  const pointCount = lines.reduce((a, l) => a + l.length, 0);

  return {
    computed: {
      lengthKm: rawLines.length ? round(lengthKm, 1) : null,
      wayCount: main.length,
      isLoop,
      fragmented,
      branched,
      superroute: rawLines.length === 0 && childRelations.length > 0,
      start,
      end,
      bbox: bbox ? bbox.map(r5) : null,
      pointCount,
    },
    childRelations,
    center: center ? { lat: r5(center.lat), lng: r5(center.lng) } : null,
    lines,
  };
}

function chainLines(lines, startPt, gapM) {
  const remaining = lines.map((l) => l);
  const out = [];
  let cursor = startPt;
  let guard = 0;
  const distM = (a, b) => haversineKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) * 1000;
  while (remaining.length && guard++ < 100000) {
    // Najblizszy koniec dowolnego pozostalego odcinka (dokladny styk ma d=0).
    let bestIdx = -1;
    let bestRev = false;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const l = remaining[i];
      const d0 = distM(cursor, l[0]);
      const d1 = distM(cursor, l[l.length - 1]);
      if (d0 < bestD) { bestD = d0; bestIdx = i; bestRev = false; }
      if (d1 < bestD) { bestD = d1; bestIdx = i; bestRev = true; }
      if (bestD === 0) break;
    }
    if (bestIdx === -1 || bestD > gapM) return null; // przerwany lancuch
    const seg = remaining.splice(bestIdx, 1)[0];
    const pts = bestRev ? [...seg].reverse() : seg;
    for (let i = out.length && bestD === 0 ? 1 : 0; i < pts.length; i++) out.push(pts[i]);
    cursor = pts[pts.length - 1];
  }
  return out;
}
function pointAlong(line, targetKm) {
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = { lat: line[i - 1][0], lng: line[i - 1][1] };
    const b = { lat: line[i][0], lng: line[i][1] };
    const d = haversineKm(a, b);
    if (acc + d >= targetKm && d > 0) {
      const t = (targetKm - acc) / d;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    acc += d;
  }
  const last = line[line.length - 1];
  return { lat: last[0], lng: last[1] };
}

function normalizeRoute(el) {
  const tags = el.tags ?? {};
  const name = tags.name?.trim();
  if (!name) return null;
  if (!['bicycle', 'hiking', 'mtb', 'foot'].includes(tags.route)) return null;
  const geo = processRouteGeometry(el);
  const coordinates = geo.center ?? elCoords(el);
  if (!coordinates) return null;
  const attrs = pickAttrs(tags, ROUTE_ATTR_TAGS);
  pickContacts(tags, attrs);
  return {
    slug: `${slugify(name)}-${el.id}`,
    name,
    type: 'trail',
    source: 'osm',
    osm: osmMeta(el),
    location: { city: null, region: null, hubSlug: null, hubDistanceKm: null },
    address: null,
    coordinates,
    description: tags.description?.trim() || null,
    notes: [],
    attrs,
    computed: geo.computed,
    _childRelations: geo.childRelations,
    _lines: geo.lines,
  };
}

// -----------------------------------------------------------------------------
// Deduplikacja POI: ta sama nazwa (slug) + odleglosc <= 40 m -> jeden obiekt.
// Zachowujemy obiekt z wieksza liczba atrybutow (remis: way przed node, nizsze id);
// brakujace atrybuty uzupelniamy z duplikatu (fill-only). Deterministyczne.
// -----------------------------------------------------------------------------
function dedupeSameNamePois(list) {
  const DUP_KM = 0.04;
  const byName = new Map();
  for (const e of list) {
    const k = `${e.type}|${slugify(e.name)}`;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(e);
  }
  const kept = [];
  const merged = [];
  const score = (e) => Object.keys(e.attrs).length + (e.address ? 1 : 0) + (e.description ? 1 : 0);
  for (const group of byName.values()) {
    group.sort((a, b) => a.osm.id - b.osm.id);
    const groupKept = [];
    for (const cand of group) {
      const hit = groupKept.find((k) => haversineKm(k.coordinates, cand.coordinates) <= DUP_KM);
      if (!hit) {
        groupKept.push(cand);
        continue;
      }
      // Wybor obiektu wiodacego.
      const candBetter = score(cand) > score(hit) || (score(cand) === score(hit) && hit.osm.type === 'node' && cand.osm.type === 'way');
      const primary = candBetter ? cand : hit;
      const secondary = candBetter ? hit : cand;
      for (const [k, v] of Object.entries(secondary.attrs)) if (primary.attrs[k] == null) primary.attrs[k] = v;
      if (!primary.address && secondary.address) primary.address = secondary.address;
      if (!primary.description && secondary.description) primary.description = secondary.description;
      if (candBetter) groupKept[groupKept.indexOf(hit)] = cand;
      merged.push({ kept: `${primary.osm.type}/${primary.osm.id}`, dropped: `${secondary.osm.type}/${secondary.osm.id}`, name: primary.name });
    }
    kept.push(...groupKept);
  }
  kept.sort((a, b) => a.osm.id - b.osm.id);
  return { kept, merged };
}

// -----------------------------------------------------------------------------
// Curated
// -----------------------------------------------------------------------------
function loadCurated(file, type) {
  const p = resolve(CURATED_DIR, `${file}.json`);
  if (!existsSync(p)) return [];
  return readJson(p).map((c) => ({
    slug: c.slug,
    name: c.name,
    type,
    source: 'curated',
    osm: null,
    location: { city: c.location?.city ?? null, region: c.location?.region ?? null, hubSlug: null, hubDistanceKm: null },
    address: c.address ?? null,
    coordinates: c.coordinates,
    description: c.description ?? null,
    notes: Array.isArray(c.notes) ? c.notes : [],
    attrs: { ...(c.attrs ?? {}) },
    ...(type === 'trail' ? { computed: null, _lines: [] } : {}),
  }));
}

/** Dopasowanie kandydata OSM do encji curated (ta sama nazwa + bliskosc). */
function matchCurated(cand, curatedList) {
  const nameSlug = slugify(cand.name);
  for (const cur of curatedList) {
    if (slugify(cur.name) !== nameSlug) continue;
    const d = haversineKm(cand.coordinates, cur.coordinates);
    const limit = cand.type === 'trail' ? 60 : 1.5;
    if (d <= limit) return cur;
  }
  return null;
}
function mergeIntoCurated(cur, cand) {
  cur.source = 'curated+osm';
  cur.osm = cand.osm;
  for (const [k, v] of Object.entries(cand.attrs)) if (cur.attrs[k] == null) cur.attrs[k] = v;
  if (!cur.description && cand.description) cur.description = cand.description;
  if (!cur.address && cand.address) cur.address = cand.address;
  if (cand.type === 'trail') {
    cur.computed = cand.computed;
    cur._lines = cand._lines;
    cur._childRelations = cand._childRelations;
    if (cand.coordinates) cur.coordinates = cand.coordinates;
  }
}

// -----------------------------------------------------------------------------
// Powiazanie z miastami-hubami
// -----------------------------------------------------------------------------
function linkToHub(entity, seeds) {
  const declared = entity.location.city;
  if (declared) {
    const s = seeds.find((x) => x.slug === slugify(declared));
    if (s) {
      return { city: s.name, region: s.region, hubSlug: s.slug, hubDistanceKm: round(haversineKm(entity.coordinates, s.coordinates), 1) };
    }
  }
  let best = null;
  for (const s of seeds) {
    const d = haversineKm(entity.coordinates, s.coordinates);
    if (d > P.hubLinkKm) continue;
    if (!best || d < best.d || (d === best.d && s.slug < best.s.slug)) best = { s, d };
  }
  if (best) {
    return {
      // Zachowujemy jawne addr:city (jesli bylo) jako miejscowosc; hub to osobne pole.
      city: declared ?? (best.d <= 12 ? best.s.name : null),
      region: best.s.region,
      hubSlug: best.s.slug,
      hubDistanceKm: round(best.d, 1),
    };
  }
  return { city: declared ?? null, region: entity.location.region ?? null, hubSlug: null, hubDistanceKm: null };
}

// -----------------------------------------------------------------------------
// Relacje przestrzenne (grid hashing na uproszczonej geometrii)
// -----------------------------------------------------------------------------
const CELL_LAT = 0.009; // ~1 km
const CELL_LNG = 0.015; // ~1 km na szerokosci Polski
const cellOf = (lat, lng) => `${Math.floor(lat / CELL_LAT)}:${Math.floor(lng / CELL_LNG)}`;
function cellsAround(lat, lng, radiusKm) {
  const n = Math.ceil(radiusKm / 1) + 1;
  const ci = Math.floor(lat / CELL_LAT);
  const cj = Math.floor(lng / CELL_LNG);
  const out = [];
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) out.push(`${ci + i}:${cj + j}`);
  return out;
}
function buildPointIndex(entities) {
  const idx = new Map();
  for (const e of entities) {
    const c = cellOf(e.coordinates.lat, e.coordinates.lng);
    if (!idx.has(c)) idx.set(c, []);
    idx.get(c).push(e);
  }
  return idx;
}
function nearbyPoints(pt, index, radiusKm, exclude = null) {
  const out = [];
  const seen = new Set();
  for (const cell of cellsAround(pt.lat, pt.lng, radiusKm)) {
    for (const e of index.get(cell) ?? []) {
      if (e === exclude || seen.has(e.slug)) continue;
      seen.add(e.slug);
      const d = haversineKm(pt, e.coordinates);
      if (d <= radiusKm) out.push({ e, km: d });
    }
  }
  return out.sort((a, b) => a.km - b.km || (a.e.slug < b.e.slug ? -1 : 1));
}
function buildLineIndex(trails) {
  const idx = new Map();
  for (const t of trails) {
    const cells = new Set();
    for (const line of t._lines ?? []) {
      for (let i = 0; i < line.length; i++) {
        cells.add(cellOf(line[i][0], line[i][1]));
        // odcinki dluzsze niz komorka: probkuj punkty posrednie
        if (i > 0) {
          const [aLat, aLng] = line[i - 1];
          const [bLat, bLng] = line[i];
          const steps = Math.ceil(Math.max(Math.abs(bLat - aLat) / CELL_LAT, Math.abs(bLng - aLng) / CELL_LNG));
          for (let s = 1; s < steps; s++) {
            cells.add(cellOf(aLat + ((bLat - aLat) * s) / steps, aLng + ((bLng - aLng) * s) / steps));
          }
        }
      }
    }
    t._cells = cells;
    for (const c of cells) {
      if (!idx.has(c)) idx.set(c, []);
      idx.get(c).push(t);
    }
  }
  return idx;
}
function routesNearPoint(pt, lineIndex, radiusKm) {
  const cand = new Map();
  for (const cell of cellsAround(pt.lat, pt.lng, radiusKm)) {
    for (const t of lineIndex.get(cell) ?? []) cand.set(t.slug, t);
  }
  const out = [];
  for (const t of cand.values()) {
    const km = pointToLinesKm(pt, t._lines);
    if (km !== null && km <= radiusKm) out.push({ e: t, km });
  }
  return out.sort((a, b) => a.km - b.km || (a.e.slug < b.e.slug ? -1 : 1));
}
function minLineDistanceKm(a, b) {
  // przyblizenie: punkty A do odcinkow B i odwrotnie
  let best = Infinity;
  for (const la of a._lines) {
    for (const p of la) {
      const d = pointToLinesKm({ lat: p[0], lng: p[1] }, b._lines);
      if (d !== null && d < best) best = d;
      if (best < 0.02) return best;
    }
  }
  for (const lb of b._lines) {
    for (const p of lb) {
      const d = pointToLinesKm({ lat: p[0], lng: p[1] }, a._lines);
      if (d !== null && d < best) best = d;
      if (best < 0.02) return best;
    }
  }
  return best === Infinity ? null : best;
}
const relItem = (type, e, km) => ({ key: `${type}/${e.slug}`, km: round(km, km < 1 ? 2 : 1) });

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------
function loadCache(kind) {
  if (!existsSync(CACHE_DIR)) return [];
  return readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith(`.${kind}.json`))
    .sort()
    .map((f) => ({ file: f, ...readJson(resolve(CACHE_DIR, f)) }));
}

function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');

  const seeds = readJson(resolve(DATA_DIR, 'cities.json'))
    .filter((c) => c.type === 'city' && hasCoords(c.coordinates))
    .map((c) => ({
      name: c.location?.city ?? c.name,
      region: c.location?.region ?? null,
      slug: c.slug ?? slugify(c.location?.city ?? c.name),
      coordinates: c.coordinates,
      hub: Array.isArray(c.tags) && c.tags.includes('hub'),
    }));
  const regions = readJson(resolve(DATA_DIR, 'regions.json'));

  const poiCache = loadCache('pois');
  const routeCache = loadCache('routes');
  const sources = { pois: {}, routes: {} };
  for (const c of poiCache) sources.pois[c.region] = { fetchedAt: c.fetchedAt, osmBase: c.osmBase, elements: c.elements.length };
  for (const c of routeCache) sources.routes[c.region] = { fetchedAt: c.fetchedAt, osmBase: c.osmBase, elements: c.elements.length };

  // STAGE 1: unikalne elementy OSM (ten sam obiekt moze wpasc z 2 regionow).
  const seen = new Set();
  const rawPois = [];
  for (const c of poiCache) for (const el of c.elements) {
    const k = `${el.type}/${el.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rawPois.push(el);
  }
  const rawRoutes = [];
  for (const c of routeCache) for (const el of c.elements) {
    const k = `${el.type}/${el.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rawRoutes.push(el);
  }
  rawPois.sort((a, b) => a.id - b.id);
  rawRoutes.sort((a, b) => a.id - b.id);

  // STAGE 2: normalizacja + deduplikacja POI o tej samej nazwie w tym samym miejscu
  // (np. parking zmapowany jako node i way, albo dwa poziomy pod jedna nazwa).
  const osmPoisAll = rawPois.map(normalizePoi).filter(Boolean);
  const { kept: osmPois, merged: poiDupes } = dedupeSameNamePois(osmPoisAll);
  const osmRoutes = rawRoutes.map(normalizeRoute).filter(Boolean);

  // STAGE 3: curated + merge.
  const curated = {
    beach: loadCurated('beaches', 'beach'),
    parking: loadCurated('parkings', 'parking'),
    trail: loadCurated('trails', 'trail'),
  };
  const merged = { beach: [...curated.beach], parking: [...curated.parking], trail: [...curated.trail] };
  const mergeLog = [];
  for (const cand of [...osmPois, ...osmRoutes]) {
    const hit = matchCurated(cand, curated[cand.type]);
    if (hit) {
      mergeIntoCurated(hit, cand);
      mergeLog.push({ curated: hit.slug, osm: `${cand.osm.type}/${cand.osm.id}` });
    } else {
      merged[cand.type].push(cand);
    }
  }
  // Slug musi byc unikalny globalnie w typie.
  for (const type of Object.keys(merged)) {
    const s = new Set();
    for (const e of merged[type]) {
      if (s.has(e.slug)) throw new Error(`Duplikat slug ${type}/${e.slug}`);
      s.add(e.slug);
    }
  }

  // STAGE 4: powiazanie z hubami/regionami.
  const all = [...merged.beach, ...merged.parking, ...merged.trail];
  for (const e of all) {
    const link = linkToHub(e, seeds);
    e.location = {
      city: link.city,
      region: link.region ?? e.location.region ?? null,
      hubSlug: link.hubSlug,
      hubDistanceKm: link.hubDistanceKm,
    };
  }
  // Szlaki: hub = najblizsze miasto do LINII (nie do srodka). Szlaki dalej niz
  // routeKeepKm od kazdego huba odpadaja (nie maja strony miasta -> brak kontekstu).
  const keptTrails = [];
  for (const t of merged.trail) {
    if (!t._lines?.length) {
      if (t.location.hubSlug || t.source !== 'osm') keptTrails.push(t);
      continue;
    }
    let best = null;
    for (const s of seeds) {
      const d = pointToLinesKm(s.coordinates, t._lines);
      if (d === null || d > P.routeKeepKm) continue;
      if (!best || d < best.d) best = { s, d };
    }
    if (best) {
      t.location.hubSlug = best.s.slug;
      t.location.hubDistanceKm = round(best.d, 1);
      t.location.region = best.s.region;
      if (!t.location.city && best.d <= P.routeCityKm) t.location.city = best.s.name;
      keptTrails.push(t);
    } else if (t.source !== 'osm') {
      keptTrails.push(t);
    }
  }
  merged.trail = keptTrails;

  // STAGE 5: relacje przestrzenne.
  const parkingIdx = buildPointIndex(merged.parking);
  const beachIdx = buildPointIndex(merged.beach);
  const lineIdx = buildLineIndex(merged.trail);
  const seedEntities = seeds.map((s) => ({ slug: s.slug, name: s.name, coordinates: s.coordinates }));
  const seedIdx = buildPointIndex(seedEntities);
  const byOsmRelId = new Map(merged.trail.filter((t) => t.osm?.type === 'relation').map((t) => [t.osm.id, t]));

  for (const pk of merged.parking) {
    pk.rel = {
      parkings: nearbyPoints(pk.coordinates, parkingIdx, P.parkingNearParkingKm, pk).slice(0, P.maxRel.parkings).map((x) => relItem('parking', x.e, x.km)),
      beaches: nearbyPoints(pk.coordinates, beachIdx, P.parkingNearBeachKm).slice(0, P.maxRel.beaches).map((x) => relItem('beach', x.e, x.km)),
      trails: routesNearPoint(pk.coordinates, lineIdx, P.poiNearRouteKm).slice(0, P.maxRel.routesForPoi).map((x) => relItem('trail', x.e, x.km)),
      cities: nearbyPoints(pk.coordinates, seedIdx, P.hubListKm).slice(0, P.maxRel.cities).map((x) => relItem('city', x.e, x.km)),
    };
  }
  for (const b of merged.beach) {
    b.rel = {
      parkings: nearbyPoints(b.coordinates, parkingIdx, P.beachNearParkingKm).slice(0, P.maxRel.parkings).map((x) => relItem('parking', x.e, x.km)),
      beaches: nearbyPoints(b.coordinates, beachIdx, P.beachNearBeachKm, b).slice(0, P.maxRel.beaches).map((x) => relItem('beach', x.e, x.km)),
      trails: routesNearPoint(b.coordinates, lineIdx, P.poiNearRouteKm).slice(0, P.maxRel.routesForPoi).map((x) => relItem('trail', x.e, x.km)),
      cities: nearbyPoints(b.coordinates, seedIdx, P.hubListKm).slice(0, P.maxRel.cities).map((x) => relItem('city', x.e, x.km)),
    };
  }
  for (const t of merged.trail) {
    const lines = t._lines ?? [];
    const rel = { parkings: [], beaches: [], trails: [], cities: [], parts: [], parents: [] };
    if (lines.length) {
      // POI przy linii: kandydaci z komorek trasy + sasiednich.
      const candCells = new Set();
      for (const c of t._cells) {
        const [i, j] = c.split(':').map(Number);
        for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) candCells.add(`${i + di}:${j + dj}`);
      }
      const collect = (idx, type, radius, limit) => {
        const out = [];
        const s = new Set();
        for (const c of candCells) for (const e of idx.get(c) ?? []) {
          if (s.has(e.slug)) continue;
          s.add(e.slug);
          const km = pointToLinesKm(e.coordinates, lines);
          if (km !== null && km <= radius) out.push({ e, km });
        }
        return out.sort((a, b) => a.km - b.km || (a.e.slug < b.e.slug ? -1 : 1)).slice(0, limit).map((x) => relItem(type, x.e, x.km));
      };
      rel.parkings = collect(parkingIdx, 'parking', P.poiNearRouteKm, P.maxRel.parkings);
      rel.beaches = collect(beachIdx, 'beach', P.poiNearRouteKm, P.maxRel.beaches);
      // Miasta-huby w promieniu routeCityKm od linii (kolejnosc: odleglosc).
      const cities = [];
      for (const s of seeds) {
        const d = pointToLinesKm(s.coordinates, lines);
        if (d !== null && d <= P.routeCityKm) cities.push({ e: s, km: d });
      }
      rel.cities = cities.sort((a, b) => a.km - b.km).slice(0, P.maxRel.cities).map((x) => relItem('city', x.e, x.km));
      // Szlak bez miasta w promieniu routeCityKm dostaje najblizszy hub (<= routeKeepKm),
      // zeby zawsze mial strone miasta, na ktorej jest wymieniony.
      if (rel.cities.length === 0 && t.location.hubSlug) {
        const hub = seeds.find((s) => s.slug === t.location.hubSlug);
        if (hub) rel.cities.push(relItem('city', hub, t.location.hubDistanceKm ?? 0));
      }
      // Szlaki laczace sie: wspolne komorki -> dokladna odleglosc linii.
      const candTrails = new Map();
      for (const c of t._cells) for (const o of lineIdx.get(c) ?? []) if (o !== t) candTrails.set(o.slug, o);
      const links = [];
      for (const o of candTrails.values()) {
        const d = minLineDistanceKm(t, o);
        if (d !== null && d <= P.routeNearRouteKm) links.push({ e: o, km: d });
      }
      rel.trails = links.sort((a, b) => a.km - b.km || (a.e.slug < b.e.slug ? -1 : 1)).slice(0, P.maxRel.trails).map((x) => relItem('trail', x.e, x.km));
    } else {
      rel.cities = nearbyPoints(t.coordinates, seedIdx, P.hubListKm).slice(0, P.maxRel.cities).map((x) => relItem('city', x.e, x.km));
    }
    for (const childId of t._childRelations ?? []) {
      const child = byOsmRelId.get(childId);
      if (child) rel.parts.push({ key: `trail/${child.slug}`, km: null });
    }
    t.rel = rel;
  }
  for (const t of merged.trail) {
    for (const part of t.rel.parts) {
      const child = merged.trail.find((x) => `trail/${x.slug}` === part.key);
      if (child) child.rel.parents.push({ key: `trail/${t.slug}`, km: null });
    }
  }

  // STAGE 6: sortowanie deterministyczne + zapis.
  for (const type of Object.keys(merged)) merged[type].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const geometry = {};
  for (const t of merged.trail) {
    if (t._lines?.length) geometry[t.slug] = { bbox: t.computed?.bbox ?? null, lines: t._lines };
  }
  const strip = ({ _lines, _cells, _childRelations, ...rest }) => rest;
  const out = {
    beaches: merged.beach.map(strip),
    parkings: merged.parking.map(strip),
    trails: merged.trail.map(strip),
  };

  const generatedAt = new Date().toISOString().slice(0, 10);
  const osmBaseDates = Object.values({ ...sources.pois, ...sources.routes }).map((s) => s.osmBase).filter(Boolean).sort();
  const meta = {
    version: 2,
    generatedAt,
    osmDataFrom: osmBaseDates[0]?.slice(0, 10) ?? null,
    osmDataTo: osmBaseDates[osmBaseDates.length - 1]?.slice(0, 10) ?? null,
    counts: {
      beaches: out.beaches.length,
      parkings: out.parkings.length,
      trails: out.trails.length,
      trailsWithGeometry: Object.keys(geometry).length,
      hubs: seeds.length,
      regions: regions.length,
    },
    sources,
    curatedMerged: mergeLog.length,
  };

  const report = {
    generatedAt,
    raw: { pois: rawPois.length, routes: rawRoutes.length },
    normalized: { pois: osmPois.length, routes: osmRoutes.length, poiDuplicatesMerged: poiDupes.length },
    poiDuplicates: poiDupes,
    counts: meta.counts,
    trails: {
      withGeometry: out.trails.filter((t) => t.computed?.lengthKm).length,
      loops: out.trails.filter((t) => t.computed?.isLoop).length,
      fragmented: out.trails.filter((t) => t.computed?.fragmented).length,
      branched: out.trails.filter((t) => t.computed?.branched).length,
      withStartEnd: out.trails.filter((t) => t.computed?.start).length,
      superroutes: out.trails.filter((t) => t.computed?.superroute).length,
      byRoute: out.trails.reduce((a, t) => ((a[t.attrs.route ?? '?'] = (a[t.attrs.route ?? '?'] ?? 0) + 1), a), {}),
    },
    parkings: {
      withHub: out.parkings.filter((p) => p.location.hubSlug).length,
      byAccess: out.parkings.reduce((a, p) => ((a[p.attrs.access ?? '(brak)'] = (a[p.attrs.access ?? '(brak)'] ?? 0) + 1), a), {}),
      withRoutesNearby: out.parkings.filter((p) => p.rel.trails.length).length,
      withBeachNearby: out.parkings.filter((p) => p.rel.beaches.length).length,
    },
    beaches: { withParkingNearby: out.beaches.filter((b) => b.rel.parkings.length).length },
    curatedMerged: mergeLog,
  };
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(resolve(REPORTS_DIR, 'geo-engine-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');

  if (write) {
    writeFileSync(resolve(DATA_DIR, 'beaches.json'), JSON.stringify(out.beaches, null, 1) + '\n', 'utf8');
    writeFileSync(resolve(DATA_DIR, 'parkings.json'), JSON.stringify(out.parkings, null, 1) + '\n', 'utf8');
    writeFileSync(resolve(DATA_DIR, 'trails.json'), JSON.stringify(out.trails, null, 1) + '\n', 'utf8');
    writeFileSync(resolve(DATA_DIR, 'trail-geometry.json'), JSON.stringify(geometry) + '\n', 'utf8');
    writeFileSync(resolve(DATA_DIR, 'dataset-meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
    process.stderr.write('[--write] zapisano packages/data\n');
  } else {
    process.stderr.write('[dry-run] bez zapisu (uzyj --write)\n');
  }
  process.stderr.write(
    `GEO ENGINE v2: plaze ${out.beaches.length}, parkingi ${out.parkings.length}, szlaki ${out.trails.length} ` +
      `(z geometria ${Object.keys(geometry).length}, petle ${report.trails.loops}, fragmenty ${report.trails.fragmented}); ` +
      `curated scalone z OSM: ${mergeLog.length}\n`,
  );
}

main();
