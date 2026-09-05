// Model strony encji (parking / szlak / plaza). Sklada WYLACZNIE dane encji,
// relacje przestrzenne (precomputed) i jawnie oznaczone obliczenia.
// Zadnego tekstu wypelniajacego: kazde zdanie ma za soba konkretne pole danych.

import { paths, site, typeConfigs } from './configs.ts';
import {
  cityOfEntity,
  numericAttr,
  regionSlugOf,
  resolveCities,
  resolveRel,
  trailLengthKm,
  uniqueName,
  type DataIndex,
  type ResolvedRel,
} from './data.ts';
import { displayName, formatAddress } from './names.ts';
export { displayName, formatAddress } from './names.ts';
import {
  estimateDuration,
  formatCharge,
  formatFeeConditional,
  formatKm,
  formatInt,
  formatMaxheight,
  formatMaxstay,
  formatOpeningHours,
  formatOsmcSymbol,
  inCity,
  isRestrictedAccess,
  labels,
  countOf,
} from './labels.ts';
import { buildStaticMap, googleDirectionsUrl, googleMapsUrl, osmUrl, zoomForBbox } from './map.ts';
import { assessEntity } from './quality.ts';
import type {
  Crumb,
  Entity,
  Fact,
  FactGroup,
  LinkItem,
  PlaceModel,
  Provenance,
  Section,
  StaticMapModel,
  TableModel,
} from './types.ts';

const attr = (e: Entity, key: string): string | undefined => {
  const v = e.attrs[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
};
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

/** Kolor oznakowania: tylko nazwane kolory (hex z OSM nie jest informacja dla czytelnika). */
function colourLabel(e: Entity): string | undefined {
  const pl = attr(e, 'colour_pl');
  if (pl) return pl;
  const c = attr(e, 'colour');
  if (!c || /^#/.test(c) || /^[0-9a-f]{6}$/i.test(c)) return undefined;
  const l = labels.colour(c);
  return l === c && /[^a-ząęółśżźćń]/i.test(c) ? undefined : l;
}

function withBrand(title: string): string {
  const t = `${title} – ${site.name}`;
  return t.length <= 62 ? t : title;
}

/** "{nazwa} – {typ}, {miejsce}" bez powtarzania miejsca zawartego w nazwie; limit ~70 znakow. */
function titleFor(name: string, typeWord: string, place: string | null, keepType = false): string {
  const hasPlace = place && name.toLowerCase().includes(place.toLowerCase());
  const hasType = !keepType && name.toLowerCase().includes(typeWord.toLowerCase().split(' ')[0]);
  let t = hasType && hasPlace ? name : hasType ? `${name}${place ? `, ${place}` : ''}` : `${name} – ${typeWord}${place && !hasPlace ? `, ${place}` : ''}`;
  if (t.length > 70) t = `${name} – ${typeWord}`;
  // Nazwy nie skracamy: unikalnosc title jest wazniejsza niz limit wyswietlania.
  if (t.length > 70) t = name;
  return withBrand(t);
}

function provenanceOf(e: Entity, index: DataIndex): Provenance {
  const osm = e.osm;
  const sourceLabel =
    e.source === 'osm'
      ? 'OpenStreetMap (licencja ODbL)'
      : e.source === 'curated+osm'
        ? 'lista redakcyjna gdziemy.pl uzupełniona danymi OpenStreetMap (ODbL)'
        : 'lista redakcyjna gdziemy.pl (wpis nie pochodzi z OpenStreetMap)';
  return {
    sourceLabel,
    osmUrl: osm ? `https://www.openstreetmap.org/${osm.type}/${osm.id}` : null,
    osmLabel: osm ? `${osm.type}/${osm.id}` : null,
    lastEdit: dateOnly(osm?.timestamp),
    checkDate: osm?.checkDate ?? null,
    datasetDate: index.bundle.meta.generatedAt,
    editUrl: osm ? `https://www.openstreetmap.org/edit?${osm.type}=${osm.id}` : null,
    noteUrl: `https://www.openstreetmap.org/note/new#map=18/${e.coordinates.lat}/${e.coordinates.lng}`,
  };
}

function crumbsOf(e: Entity, index: DataIndex, h1: string): Crumb[] {
  const cfg = typeConfigs[e.type];
  const crumbs: Crumb[] = [{ name: 'Start', href: paths.home }, { name: cfg.label, href: cfg.indexPath }];
  const city = cityOfEntity(index, e);
  if (city) {
    crumbs.push({ name: city.name, href: paths.cityType(city.slug, e.type) });
  } else if (e.location.region) {
    const rs = regionSlugOf(index, e.location.region);
    if (rs) crumbs.push({ name: e.location.region, href: paths.region(rs) });
  }
  crumbs.push({ name: h1, href: paths.entity(e.type, e.slug) });
  return crumbs;
}

function parkingShort(p: Entity): string {
  const bits: string[] = [];
  const fee = attr(p, 'fee');
  if (fee === 'yes') bits.push('płatny');
  else if (fee === 'no') bits.push('bezpłatny');
  const capN = numericAttr(p, 'capacity');
  if (capN) bits.push(`${formatInt(capN)} miejsc`);
  const type = attr(p, 'parking');
  if (type && type !== 'surface') bits.push(labels.parkingType(type).replace(/^parking /, ''));
  const access = attr(p, 'access');
  if (access && access !== 'yes' && access !== 'public') bits.push(labels.access(access));
  return bits.join(' · ');
}

function trailShort(t: Entity): string {
  const bits: string[] = [];
  const route = attr(t, 'route');
  if (route) bits.push(labels.routeType(route));
  const len = trailLengthKm(t);
  if (len) bits.push(formatKm(len));
  const colour = colourLabel(t);
  if (colour) bits.push(`znaki: ${colour}`);
  return bits.join(' · ');
}

function beachShort(b: Entity): string {
  const bits: string[] = [];
  if (attr(b, 'lifeguard') === 'yes' || attr(b, 'supervised') === 'yes') bits.push('strzeżona');
  if (attr(b, 'dog') === 'yes') bits.push('dozwolone psy');
  if (attr(b, 'dog') === 'no') bits.push('zakaz wprowadzania psów');
  if (attr(b, 'fee') === 'no') bits.push('wstęp bezpłatny');
  if (attr(b, 'fee') === 'yes') bits.push('wstęp płatny');
  return bits.join(' · ');
}

export function shortInfo(e: Entity): string {
  return e.type === 'parking' ? parkingShort(e) : e.type === 'trail' ? trailShort(e) : beachShort(e);
}

function linkItems(index: DataIndex, rels: ResolvedRel[], kmLabel: (km: number) => string = formatKm): LinkItem[] {
  return rels.map(({ entity, km }) => ({
    href: paths.entity(entity.type, entity.slug),
    title: uniqueName(index, entity),
    sub: shortInfo(entity) || (entity.location.city ?? undefined),
    meta: km != null ? kmLabel(km) : undefined,
  }));
}

// -----------------------------------------------------------------------------
// PARKING
// -----------------------------------------------------------------------------
function parkingFacts(e: Entity): { facts: Fact[]; groups: FactGroup[] } {
  const facts: Fact[] = [];
  const g = (k: string) => attr(e, k);
  if (g('parking')) facts.push({ label: 'Rodzaj', value: labels.parkingType(g('parking')!) });
  if (g('access')) facts.push({ label: 'Dostęp', value: labels.access(g('access')!) });
  if (g('fee')) facts.push({ label: 'Opłata', value: g('fee') === 'yes' ? 'płatny' : g('fee') === 'no' ? 'bezpłatny' : g('fee')! });
  if (g('fee_conditional')) facts.push({ label: 'Opłata – warunki', value: formatFeeConditional(g('fee_conditional')!), note: `zapis OSM: ${g('fee_conditional')}` });
  if (g('charge')) {
    const v = g('charge')!;
    facts.push(/^https?:\/\//i.test(v) ? { label: 'Cennik', value: 'zobacz cennik operatora', href: v } : { label: 'Cennik', value: formatCharge(v) });
  }
  if (g('capacity')) facts.push({ label: 'Liczba miejsc', value: g('capacity')! });
  if (g('capacity_disabled')) {
    const v = g('capacity_disabled')!;
    facts.push({ label: 'Miejsca dla osób z niepełnosprawnością', value: v === 'yes' ? 'tak (liczba nieznana)' : v === 'no' || v === '0' ? 'brak' : v });
  }
  if (g('capacity_charging')) facts.push({ label: 'Stanowiska ładowania EV', value: g('capacity_charging') === 'no' ? 'brak' : g('capacity_charging')! });
  const cnt = (v: string) => (v === 'no' || v === '0' ? 'brak' : v === 'yes' ? 'tak (liczba nieznana)' : v);
  if (g('capacity_parent')) facts.push({ label: 'Miejsca rodzinne', value: cnt(g('capacity_parent')!) });
  if (g('capacity_bus')) facts.push({ label: 'Miejsca dla autokarów', value: cnt(g('capacity_bus')!) });
  if (g('opening_hours')) facts.push({ label: 'Godziny otwarcia', value: formatOpeningHours(g('opening_hours')!) });
  if (g('maxstay')) facts.push({ label: 'Maksymalny czas postoju', value: formatMaxstay(g('maxstay')!) });
  if (g('maxheight')) facts.push({ label: 'Limit wysokości pojazdu', value: formatMaxheight(g('maxheight')!) });
  if (g('park_ride')) facts.push({ label: 'Parkuj i Jedź (P+R)', value: labels.yesNoOr(g('park_ride')!) });
  if (g('kiss_ride')) facts.push({ label: 'Kiss & Ride', value: labels.yesNoOr(g('kiss_ride')!) });
  if (g('supervised')) facts.push({ label: 'Dozorowany', value: labels.yesNoOr(g('supervised')!) });
  if (g('covered')) facts.push({ label: 'Zadaszony', value: labels.yesNoOr(g('covered')!) });
  if (g('lit')) facts.push({ label: 'Oświetlenie', value: labels.yesNoOr(g('lit')!) });
  if (g('surface')) facts.push({ label: 'Nawierzchnia', value: labels.surface(g('surface')!) });
  if (g('wheelchair')) facts.push({ label: 'Dostępność dla wózków', value: labels.wheelchair(g('wheelchair')!) });
  if (Array.isArray(e.attrs.payment) && e.attrs.payment.length) {
    facts.push({ label: 'Formy płatności', value: e.attrs.payment.map((p) => labels.payment(p)).join(', ') });
  }
  if (g('bus')) facts.push({ label: 'Autobusy', value: labels.yesNoOr(g('bus')!) });
  if (g('tourist_bus')) facts.push({ label: 'Autokary turystyczne', value: labels.yesNoOr(g('tourist_bus')!) });
  if (g('hgv')) facts.push({ label: 'Pojazdy ciężarowe', value: labels.yesNoOr(g('hgv')!) });
  if (g('operator')) {
    const t = g('operator_type');
    const tl = t === 'public' || t === 'government' ? ' (podmiot publiczny)' : t === 'private' ? ' (podmiot prywatny)' : '';
    facts.push({ label: 'Operator', value: `${g('operator')}${tl}` });
  }
  if (g('website')) facts.push({ label: 'Strona WWW', value: g('website')!.replace(/^https?:\/\//, '').replace(/\/$/, ''), href: g('website') });
  if (g('phone')) facts.push({ label: 'Telefon', value: g('phone')!, href: `tel:${g('phone')!.replace(/[^+\d]/g, '')}` });
  if (g('email')) facts.push({ label: 'E-mail', value: g('email')!, href: `mailto:${g('email')}` });
  return { facts, groups: [] };
}

// -----------------------------------------------------------------------------
// TRAIL
// -----------------------------------------------------------------------------
function trailFacts(e: Entity): { facts: Fact[]; groups: FactGroup[]; notices: string[] } {
  const facts: Fact[] = [];
  const notices: string[] = [];
  const g = (k: string) => attr(e, k);
  const route = g('route');
  if (route) facts.push({ label: 'Rodzaj szlaku', value: labels.routeType(route) });
  const computedKm = e.computed?.lengthKm ?? null;
  const tagKm = numericAttr(e, 'distance');
  if (computedKm) {
    facts.push({ label: 'Długość (wg geometrii OSM)', value: formatKm(computedKm), note: e.computed?.fragmented ? 'suma odcinków; przebieg w OSM niekompletny' : 'obliczona z przebiegu' });
  }
  if (tagKm) facts.push({ label: computedKm ? 'Długość wg opisu szlaku' : 'Długość', value: formatKm(tagKm), note: e.source === 'curated' ? 'lista redakcyjna' : 'tag OSM distance' });
  const len = computedKm ?? tagKm;
  if (len && route) {
    const d = estimateDuration(len, route);
    if (d) facts.push({ label: 'Szacowany czas', value: d.text, note: `przy średnio ${d.speedKmh} km/h, bez postojów` });
  }
  if (g('from') || g('to')) facts.push({ label: 'Przebieg', value: [g('from'), g('via'), g('to')].filter(Boolean).join(' – ') });
  if (e.computed?.isLoop || g('roundtrip') === 'yes') facts.push({ label: 'Trasa okrężna (pętla)', value: 'tak' });
  else if (g('roundtrip') === 'no') facts.push({ label: 'Trasa okrężna (pętla)', value: 'nie' });
  const colour = colourLabel(e);
  if (g('osmc_symbol')) facts.push({ label: 'Oznakowanie', value: formatOsmcSymbol(g('osmc_symbol')!), note: `osmc:symbol ${g('osmc_symbol')}` });
  else if (colour) facts.push({ label: 'Kolor oznakowania', value: colour });
  if (g('symbol') && !g('osmc_symbol')) facts.push({ label: 'Symbol', value: g('symbol')! });
  if (g('ref')) facts.push({ label: 'Numer / oznaczenie', value: g('ref')! });
  if (g('network')) facts.push({ label: 'Ranga', value: labels.network(g('network')!) });
  else if (g('network_pl')) facts.push({ label: 'Ranga', value: `szlak ${g('network_pl')}` });
  if (g('cycle_network')) facts.push({ label: 'Sieć rowerowa', value: g('cycle_network')! });
  if (g('ascent')) facts.push({ label: 'Suma podjazdów', value: `${g('ascent')} m` });
  if (g('descent')) facts.push({ label: 'Suma zjazdów', value: `${g('descent')} m` });
  if (g('sac_scale')) facts.push({ label: 'Trudność (skala SAC)', value: labels.sacScale(g('sac_scale')!) });
  if (g('mtb_scale')) facts.push({ label: 'Trudność (skala MTB)', value: labels.mtbScale(g('mtb_scale')!) });
  if (g('operator')) facts.push({ label: 'Operator / opiekun', value: g('operator')! });
  if (g('pilgrimage') === 'yes') facts.push({ label: 'Szlak pielgrzymkowy', value: 'tak' });
  if (g('website')) facts.push({ label: 'Strona WWW', value: g('website')!.replace(/^https?:\/\//, '').replace(/\/$/, ''), href: g('website') });
  if (g('wikipedia')) {
    const m = /^([a-z]{2}):(.+)$/.exec(g('wikipedia')!);
    if (m) facts.push({ label: 'Wikipedia', value: m[2], href: `https://${m[1]}.wikipedia.org/wiki/${encodeURIComponent(m[2].replace(/ /g, '_'))}` });
  }
  if (e.computed?.start) {
    const s = e.computed.start;
    facts.push({ label: 'Punkt początkowy (wg OSM)', value: `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`, href: osmUrl(s, 16), note: 'kolejność końców wynika z danych OSM, nie z oznakowania' });
  }
  if (e.computed?.end && !e.computed.isLoop) {
    const s = e.computed.end;
    facts.push({ label: 'Punkt końcowy (wg OSM)', value: `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`, href: osmUrl(s, 16) });
  }
  if (e.computed?.fragmented) notices.push('Przebieg szlaku w OpenStreetMap składa się z rozłącznych fragmentów. Długość to suma odcinków; punkty początkowy i końcowy mogą być niepełne.');
  if (e.computed?.branched) notices.push('Przebieg ma odgałęzienia (np. dojścia do schronisk lub warianty bez oznaczenia roli). Długość obejmuje wszystkie odcinki; za start i metę przyjęto dwa najdalej położone końce.');
  if (g('complete') === 'no') notices.push('Wg autorów mapy relacja szlaku w OSM jest oznaczona jako niekompletna (complete=no).');
  if (g('state')) {
    const st = g('state')!;
    const label = st === 'proposed' ? 'proponowany (nieoznakowany w terenie)' : st === 'construction' ? 'w budowie' : st === 'disused' || st === 'abandoned' ? 'nieużywany' : st;
    facts.push({ label: 'Status szlaku', value: label, note: `tag OSM state=${st}` });
    if (['proposed', 'construction', 'disused', 'abandoned'].includes(st)) notices.push(`Szlak ma w OpenStreetMap status „${label}” – przebieg może nie być oznakowany ani przejezdny.`);
  }
  if (e.computed?.superroute) notices.push('To szlak nadrzędny złożony z odcinków (superroute). Szczegóły przebiegu znajdują się na stronach odcinków.');
  return { facts, groups: [], notices };
}

// -----------------------------------------------------------------------------
// BEACH
// -----------------------------------------------------------------------------
function beachFacts(e: Entity): { facts: Fact[]; groups: FactGroup[] } {
  const facts: Fact[] = [];
  const g = (k: string) => attr(e, k);
  facts.push({ label: 'Rodzaj', value: g('kind') === 'beach_resort' ? 'kąpielisko / ośrodek plażowy' : 'plaża' });
  if (g('surface')) facts.push({ label: 'Nawierzchnia', value: labels.surface(g('surface')!) });
  const lifeguard = g('lifeguard') ?? g('supervised');
  if (lifeguard) facts.push({ label: 'Plaża strzeżona', value: labels.yesNoOr(lifeguard) });
  if (g('seasonal')) facts.push({ label: 'Sezonowość', value: labels.yesNoOr(g('seasonal')!) });
  if (g('dog')) facts.push({ label: 'Psy', value: g('dog') === 'yes' ? 'dozwolone' : g('dog') === 'no' ? 'zakaz' : g('dog') === 'leashed' ? 'tylko na smyczy' : g('dog')! });
  if (g('fee')) facts.push({ label: 'Wstęp', value: g('fee') === 'yes' ? 'płatny' : g('fee') === 'no' ? 'bezpłatny' : g('fee')! });
  if (g('opening_hours')) facts.push({ label: 'Godziny', value: formatOpeningHours(g('opening_hours')!) });
  if (g('toilets')) facts.push({ label: 'Toalety', value: labels.yesNoOr(g('toilets')!) });
  if (g('shower')) facts.push({ label: 'Prysznice', value: labels.yesNoOr(g('shower')!) });
  if (g('wheelchair')) facts.push({ label: 'Dostępność dla wózków', value: labels.wheelchair(g('wheelchair')!) });
  if (g('nudism') === 'yes') facts.push({ label: 'Plaża naturystyczna', value: 'tak' });
  if (g('access')) facts.push({ label: 'Dostęp', value: labels.access(g('access')!) });
  if (g('operator')) facts.push({ label: 'Operator', value: g('operator')! });
  if (g('website')) facts.push({ label: 'Strona WWW', value: g('website')!.replace(/^https?:\/\//, '').replace(/\/$/, ''), href: g('website') });
  if (g('phone')) facts.push({ label: 'Telefon', value: g('phone')!, href: `tel:${g('phone')!.replace(/[^+\d]/g, '')}` });
  return { facts, groups: [] };
}

// -----------------------------------------------------------------------------
// Wspolne: mapa, tabele, JSON-LD
// -----------------------------------------------------------------------------
function mapFor(e: Entity, index: DataIndex, h1: string, markerRels: ResolvedRel[]): StaticMapModel | null {
  const markers = markerRels
    .slice(0, 9)
    .map((r, i) => ({ point: r.entity.coordinates, label: String(i + 1) }));
  if (e.type === 'trail') {
    const geom = index.bundle.geometry[e.slug];
    if (geom?.bbox) {
      const [minLat, minLng, maxLat, maxLng] = geom.bbox;
      const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
      const zoom = zoomForBbox(geom.bbox, 3, 2, 14, 7);
      const extra = [] as { point: { lat: number; lng: number }; label: string }[];
      if (e.computed?.start && !e.computed.isLoop) extra.push({ point: e.computed.start, label: 'S' });
      return buildStaticMap({ center, zoom, cols: 3, rows: 2, pin: false, geometry: geom, markers: [...extra, ...markers], alt: `Mapa przebiegu: ${h1}` });
    }
    return buildStaticMap({ center: e.coordinates, zoom: 12, cols: 3, rows: 2, pin: true, markers, alt: `Mapa okolicy: ${h1}` });
  }
  return buildStaticMap({ center: e.coordinates, zoom: 16, cols: 3, rows: 2, pin: true, markers, alt: `Mapa: ${h1}` });
}

function parkingTable(index: DataIndex, id: string, heading: string, intro: string | undefined, rows: ResolvedRel[], self?: Entity): TableModel | null {
  if (rows.length === 0) return null;
  const all = self ? [{ entity: self, km: 0 }, ...rows] : rows;
  return {
    id,
    heading,
    intro,
    columns: ['#', 'Parking', 'Odległość', 'Opłata', 'Miejsca', 'Godziny', 'Rodzaj'],
    rows: all.map(({ entity: p, km }, i) => ({
      cells: [
        self && i === 0 ? '●' : String(self ? i : i + 1),
        self && i === 0 ? `${uniqueName(index, p)} (ta strona)` : { href: paths.entity('parking', p.slug), text: uniqueName(index, p) },
        self && i === 0 ? '—' : km != null ? formatKm(km) : '—',
        attr(p, 'fee') === 'yes' ? 'płatny' : attr(p, 'fee') === 'no' ? 'bezpłatny' : '—',
        attr(p, 'capacity') ?? '—',
        attr(p, 'opening_hours') ? formatOpeningHours(attr(p, 'opening_hours')!) : '—',
        attr(p, 'parking') ? labels.parkingType(attr(p, 'parking')!).replace(/^parking /, '') : '—',
      ],
    })),
  };
}

function jsonLdFor(e: Entity, index: DataIndex, h1: string, crumbs: Crumb[], siteUrl: string, description: string): Record<string, unknown>[] {
  const cfg = typeConfigs[e.type];
  const city = cityOfEntity(index, e);
  const main: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': cfg.schemaType,
    name: h1,
    url: `${siteUrl}${paths.entity(e.type, e.slug)}`,
    geo: { '@type': 'GeoCoordinates', latitude: e.coordinates.lat, longitude: e.coordinates.lng },
    hasMap: googleMapsUrl(e.coordinates),
  };
  if (e.description) main.description = e.description;
  else main.description = description;
  const sameAs: string[] = [];
  if (e.osm) sameAs.push(`https://www.openstreetmap.org/${e.osm.type}/${e.osm.id}`);
  if (attr(e, 'website')) sameAs.push(attr(e, 'website')!);
  if (sameAs.length) main.sameAs = sameAs.length === 1 ? sameAs[0] : sameAs;
  const addr: Record<string, unknown> = { '@type': 'PostalAddress', addressCountry: 'PL' };
  const street = [e.address?.street, e.address?.housenumber].filter(Boolean).join(' ').trim();
  if (street) addr.streetAddress = street;
  if (e.address?.postcode) addr.postalCode = e.address.postcode;
  if (e.location.city || e.address?.city) addr.addressLocality = e.address?.city ?? e.location.city;
  if (e.location.region) addr.addressRegion = e.location.region;
  if (Object.keys(addr).length > 2) main.address = addr;
  if (city) main.containedInPlace = { '@type': 'City', name: city.name, url: `${siteUrl}${paths.city(city.slug)}` };
  if (e.type === 'parking') {
    if (attr(e, 'fee') === 'no') main.isAccessibleForFree = true;
    if (attr(e, 'fee') === 'yes') main.isAccessibleForFree = false;
    const access = attr(e, 'access');
    if (access) main.publicAccess = !isRestrictedAccess(access);
    if (attr(e, 'opening_hours')) main.openingHours = attr(e, 'opening_hours');
    if (attr(e, 'phone')) main.telephone = attr(e, 'phone');
    if (attr(e, 'capacity')) main.maximumAttendeeCapacity = numericAttr(e, 'capacity') ?? undefined;
  }
  if (e.type === 'trail') {
    const route = attr(e, 'route');
    if (route) main.touristType = route === 'bicycle' || route === 'mtb' ? 'cyclists' : 'hikers';
  }
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${siteUrl}${c.href}` })),
  };
  return [main, breadcrumb];
}

// -----------------------------------------------------------------------------
// GLOWNA FUNKCJA
// -----------------------------------------------------------------------------
export function buildPlaceModel(e: Entity, index: DataIndex, siteUrl: string): PlaceModel {
  const cfg = typeConfigs[e.type];
  const h1 = uniqueName(index, e);
  const city = cityOfEntity(index, e);
  // Szlak: miasto = najblizsze miasto na trasie (spojne z breadcrumbs); POI: addr:city albo hub.
  const cityName = e.type === 'trail' ? (city?.name ?? e.location.city ?? null) : (e.location.city ?? city?.name ?? null);
  const region = e.location.region;
  const quality = assessEntity(e);
  const crumbs = crumbsOf(e, index, h1);
  const notices: string[] = [];
  const sections: Section[] = [];
  const tables: TableModel[] = [];

  const parkings = resolveRel(index, e.rel?.parkings);
  const beaches = resolveRel(index, e.rel?.beaches);
  const trails = resolveRel(index, e.rel?.trails);
  const cities = resolveCities(index, e.rel?.cities);
  const parts = resolveRel(index, e.rel?.parts);
  const parents = resolveRel(index, e.rel?.parents);

  let facts: Fact[] = [];
  let groups: FactGroup[] = [];
  let summary: string[] = [];
  let title = '';
  let metaDescription = '';
  let subtitle = '';
  let markerRels: ResolvedRel[] = [];

  const where = cityName ? inCity(cityName) : region ? `(${region})` : '';
  const address = formatAddress(e);

  if (e.type === 'parking') {
    ({ facts, groups } = parkingFacts(e));
    const type = attr(e, 'parking');
    const capN = numericAttr(e, 'capacity');
    const fee = attr(e, 'fee');
    const hours = attr(e, 'opening_hours');
    const access = attr(e, 'access');
    const head = `${cap(type ? labels.parkingType(type) : 'Parking')} ${where}`.trim() + (address ? `, ${address}` : '') + '.';
    const bits: string[] = [];
    if (capN) bits.push(`${formatInt(capN)} ${capN === 1 ? 'miejsce' : 'miejsc'}`);
    if (fee === 'yes') bits.push(attr(e, 'charge') && !/^https?:/.test(attr(e, 'charge')!) ? `płatny (${formatCharge(attr(e, 'charge')!)})` : 'płatny');
    if (fee === 'no') bits.push('bezpłatny');
    if (hours) bits.push(hours === '24/7' ? 'otwarty całodobowo' : `godziny: ${formatOpeningHours(hours)}`);
    if (attr(e, 'park_ride') === 'yes') bits.push('parking Parkuj i Jedź (P+R)');
    if (attr(e, 'capacity_charging') && attr(e, 'capacity_charging') !== 'no') bits.push(`${attr(e, 'capacity_charging')} stanowisk ładowania EV`);
    summary = [head, bits.length ? cap(bits.join(', ')) + '.' : ''].filter(Boolean);
    if (isRestrictedAccess(access)) {
      notices.push(`W OpenStreetMap parking jest oznaczony jako „${labels.access(access!)}” (access=${access}). Nie jest to parking ogólnodostępny – strona ma charakter informacyjny.`);
    }
    if (access === 'customers') notices.push('Parking przeznaczony dla klientów obiektu (access=customers); zasady korzystania ustala operator.');
    subtitle = [cfg.labelOne, cityName, region].filter(Boolean).join(' · ');
    title = titleFor(h1, 'parking', cityName ?? region);
    const md: string[] = [`${h1}: ${summary[0].replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}`];
    if (bits.length) md.push(cap(bits.slice(0, 3).join(', ')));
    md.push(parkings.length ? `Mapa, dojazd, dane z OpenStreetMap i ${countOf(parkings.length, 'parking')} w promieniu 2 km do porównania` : 'Mapa, dojazd i dane z OpenStreetMap');
    metaDescription = md.join('. ') + '.';
    markerRels = parkings;
    const cmp = parkingTable(index, 'porownanie', 'Porównanie z parkingami w pobliżu', 'Parkingi w promieniu 2 km posortowane według odległości. Numery odpowiadają znacznikom na mapie.', parkings, e);
    if (cmp && parkings.length >= 1) tables.push(cmp);
    if (beaches.length) sections.push({ id: 'plaze', heading: 'Plaże w pobliżu', items: linkItems(index, beaches) });
    if (trails.length) sections.push({ id: 'szlaki', heading: 'Szlaki przebiegające w pobliżu', intro: 'Odległość liczona od parkingu do najbliższego punktu przebiegu szlaku.', items: linkItems(index, trails) });
  } else if (e.type === 'trail') {
    const tf = trailFacts(e);
    facts = tf.facts;
    groups = tf.groups;
    notices.push(...tf.notices);
    const route = attr(e, 'route');
    const len = trailLengthKm(e);
    const rt = route ? labels.routeType(route) : 'szlak';
    const from = attr(e, 'from');
    const to = attr(e, 'to');
    const colour = colourLabel(e);
    const s1 = `${cap(rt)}${len ? ` o długości ${formatKm(len)}` : ''}${from && to ? ` z miejscowości ${from} do ${to}` : ''}${e.computed?.isLoop || attr(e, 'roundtrip') === 'yes' ? ' (trasa okrężna)' : ''}${cities.length ? `, w okolicy: ${cities.slice(0, 3).map((c) => c.city.name).join(', ')}` : region ? `, ${region}` : ''}.`;
    const dur = len && route ? estimateDuration(len, route) : null;
    const s2bits: string[] = [];
    if (colour) s2bits.push(`oznakowanie ${colour}`);
    if (attr(e, 'network')) s2bits.push(labels.network(attr(e, 'network')!));
    if (dur) s2bits.push(`szacowany czas ${dur.text}`);
    summary = [s1, s2bits.length ? cap(s2bits.join(', ')) + '.' : ''].filter(Boolean);
    subtitle = [rt, cityName ?? cities[0]?.city.name ?? null, region].filter(Boolean).join(' · ');
    title = titleFor(h1, rt, len ? formatKm(len) : null, true);
    const md = [`${h1}: ${s1.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}`];
    if (s2bits.length) md.push(cap(s2bits.join(', ')));
    md.push(parkings.length ? `Mapa przebiegu, ${countOf(parkings.length, 'parking')} przy trasie i szlaki łączące się (dane OpenStreetMap)` : 'Mapa przebiegu i szlaki łączące się (dane OpenStreetMap)');
    metaDescription = md.join('. ') + '.';
    markerRels = parkings;
    const pt = parkingTable(index, 'parkingi', 'Gdzie zaparkować przy szlaku', 'Nazwane parkingi z OpenStreetMap położone do 1,5 km od przebiegu szlaku, posortowane według odległości od trasy. Numery odpowiadają znacznikom na mapie.', parkings);
    if (pt) tables.push(pt);
    if (beaches.length) sections.push({ id: 'plaze', heading: 'Plaże przy szlaku', items: linkItems(index, beaches) });
    if (trails.length) sections.push({ id: 'polaczenia', heading: 'Szlaki łączące się lub krzyżujące', intro: 'Szlaki, których przebieg zbliża się do tego szlaku na mniej niż ok. 300 m.', items: linkItems(index, trails, (km) => (km < 0.05 ? 'styk' : formatKm(km))) });
    if (parts.length) sections.push({ id: 'odcinki', heading: 'Odcinki tego szlaku', items: linkItems(index, parts) });
    if (parents.length) sections.push({ id: 'nadrzedne', heading: 'Szlak jest częścią', items: linkItems(index, parents) });
    if (cities.length) {
      sections.push({
        id: 'miasta',
        heading: 'Miasta na trasie i w okolicy',
        intro: 'Miasta z bazy gdziemy.pl, których centrum leży do 10 km od przebiegu szlaku.',
        items: cities.map((c) => ({ href: paths.cityType(c.city.slug, 'trail'), title: c.city.name, sub: `szlaki ${inCity(c.city.name)}`, meta: c.km != null ? formatKm(c.km) : undefined })),
      });
    }
  } else {
    ({ facts, groups } = beachFacts(e));
    const lifeguard = attr(e, 'lifeguard') ?? attr(e, 'supervised');
    const bits: string[] = [];
    if (lifeguard === 'yes') bits.push('plaża strzeżona');
    if (lifeguard === 'no') bits.push('plaża niestrzeżona');
    if (attr(e, 'surface')) bits.push(`nawierzchnia: ${labels.surface(attr(e, 'surface')!)}`);
    if (attr(e, 'dog') === 'yes') bits.push('dozwolone psy');
    if (attr(e, 'dog') === 'no') bits.push('zakaz wprowadzania psów');
    if (attr(e, 'fee') === 'no') bits.push('wstęp bezpłatny');
    const s1 = `${attr(e, 'kind') === 'beach_resort' ? 'Kąpielisko' : 'Plaża'} ${where}${bits.length ? `: ${bits.join(', ')}` : ''}.`.replace(/\s+:/, ':');
    const nearest = parkings[0];
    const s2 = parkings.length
      ? `${cap(countOf(parkings.length, 'parking'))} w promieniu 1,5 km; najbliższy: ${uniqueName(index, nearest.entity)} (${formatKm(nearest.km ?? 0)}).`
      : 'W bazie nie ma nazwanego parkingu w promieniu 1,5 km.';
    summary = [s1, s2];
    subtitle = ['plaża', cityName, region].filter(Boolean).join(' · ');
    title = titleFor(h1, 'plaża', cityName ?? region);
    metaDescription = `${h1}: ${s1.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}. ${s2.replace(/\.$/, '')}. Mapa, dojazd i dane z OpenStreetMap.`;
    markerRels = parkings;
    const pt = parkingTable(index, 'parkingi', 'Parkingi przy plaży', 'Nazwane parkingi z OpenStreetMap do 1,5 km od plaży. Numery odpowiadają znacznikom na mapie.', parkings);
    if (pt) tables.push(pt);
    if (beaches.length) sections.push({ id: 'inne-plaze', heading: 'Inne plaże w okolicy', items: linkItems(index, beaches) });
    if (trails.length) sections.push({ id: 'szlaki', heading: 'Szlaki w pobliżu', items: linkItems(index, trails) });
  }

  // Wspolne: miasto / region.
  if (e.type !== 'trail' && (city || cities.length)) {
    const items: LinkItem[] = [];
    if (city) items.push({ href: paths.cityType(city.slug, e.type), title: `${cfg.label} ${inCity(city.name)}`, sub: 'pełna lista z tabelą porównawczą' });
    if (city) items.push({ href: paths.city(city.slug), title: `${city.name} – przewodnik`, sub: 'parkingi, szlaki i plaże w jednym miejscu' });
    for (const c of cities.filter((x) => x.city.slug !== city?.slug).slice(0, 2)) {
      items.push({ href: paths.city(c.city.slug), title: c.city.name, meta: c.km != null ? formatKm(c.km) : undefined });
    }
    sections.push({ id: 'miasto', heading: 'Zobacz też', items });
  } else if (e.type === 'trail' && city) {
    sections.push({ id: 'miasto', heading: 'Zobacz też', items: [{ href: paths.cityType(city.slug, 'trail'), title: `Szlaki ${inCity(city.name)}`, sub: 'pełna lista z długościami' }, { href: paths.city(city.slug), title: `${city.name} – przewodnik` }] });
  }
  if (e.source !== 'osm') notices.push('Wpis pochodzi z ręcznie utrzymywanej listy redakcyjnej gdziemy.pl' + (e.source === 'curated+osm' ? ', uzupełnionej o dane z OpenStreetMap.' : '; szczegółowe udogodnienia mogą być niepełne.'));
  if (!quality.indexable) notices.push('Strona nie jest kierowana do indeksu wyszukiwarek: ' + quality.reasons.join('; ') + '.');

  const coordsFact: Fact = { label: 'Współrzędne', value: `${e.coordinates.lat.toFixed(5)}, ${e.coordinates.lng.toFixed(5)}`, href: osmUrl(e.coordinates, 17) };
  if (address) facts.unshift({ label: 'Adres', value: address });
  facts.push(coordsFact);
  facts.push({ label: 'Nawigacja', value: 'trasa w Google Maps', href: googleDirectionsUrl(e.coordinates) });

  return {
    type: e.type,
    slug: e.slug,
    canonical: paths.entity(e.type, e.slug),
    title,
    metaDescription: metaDescription.length > 300 ? metaDescription.slice(0, 297).replace(/\s+\S*$/, '') + '…' : metaDescription,
    h1,
    subtitle,
    robots: quality.indexable ? 'index' : 'noindex',
    crumbs,
    summary,
    facts,
    factGroups: groups,
    description: e.description,
    notes: e.notes,
    notices,
    map: mapFor(e, index, h1, markerRels),
    sections,
    tables,
    provenance: provenanceOf(e, index),
    jsonLd: jsonLdFor(e, index, h1, crumbs, siteUrl, metaDescription),
    quality,
  };
}
