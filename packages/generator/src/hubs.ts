// Modele stron zbiorczych: miasto, miasto/typ, wojewodztwo, indeksy kategorii,
// strona glowna. Wszystko z danych; kazda liczba na stronie jest policzona.

import { paths, site, TYPE_ORDER, typeConfigs } from './configs.ts';
import { hubSlugsOf, isPublicParking, numericAttr, resolveRel, trailLengthKm, uniqueName, type DataIndex } from './data.ts';
import { distanceKm } from './geo.ts';
import { countOf, formatKm, formatOpeningHours, inCity, labels, plural } from './labels.ts';
import { buildStaticMap } from './map.ts';
import { shortInfo } from './place.ts';
import { assessEntity } from './quality.ts';
import type { CitySeed, Crumb, Entity, EntityType, Fact, HubModel, LinkItem, Section, TableModel } from './types.ts';

const attr = (e: Entity, key: string): string | undefined => {
  const v = e.attrs[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
};

function breadcrumbLd(crumbs: Crumb[], siteUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${siteUrl}${c.href}` })),
  };
}
function itemListLd(name: string, items: LinkItem[], siteUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.slice(0, 50).map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.title, url: `${siteUrl}${it.href}` })),
  };
}

function entityItem(index: DataIndex, e: Entity, km?: number | null): LinkItem {
  return { href: paths.entity(e.type, e.slug), title: uniqueName(index, e), sub: shortInfo(e) || undefined, meta: km != null ? formatKm(km) : undefined };
}

function kmFromCity(e: Entity, city: CitySeed): number | null {
  if (e.type === 'trail') {
    const hit = e.rel?.cities?.find((c) => c.key === `city/${city.slug}`);
    if (hit && hit.km != null) return hit.km;
    return e.location.hubSlug === city.slug ? e.location.hubDistanceKm : null;
  }
  return distanceKm(e.coordinates, city.coordinates);
}

const byKm = (city: CitySeed) => (a: Entity, b: Entity) => {
  const da = kmFromCity(a, city) ?? 1e9;
  const db = kmFromCity(b, city) ?? 1e9;
  return da - db || a.name.localeCompare(b.name, 'pl');
};
const byLengthDesc = (a: Entity, b: Entity) => (trailLengthKm(b) ?? 0) - (trailLengthKm(a) ?? 0) || a.name.localeCompare(b.name, 'pl');

// --- Tabele ------------------------------------------------------------------
const PARKING_COLS = ['Parking', 'Od centrum', 'Rodzaj', 'Miejsca', 'Opłata', 'Godziny', 'Dostęp'];
function parkingRows(index: DataIndex, list: Entity[], city: CitySeed): TableModel['rows'] {
  return list.map((p) => {
    const km = kmFromCity(p, city);
    return {
      cells: [
        { href: paths.entity('parking', p.slug), text: uniqueName(index, p) },
        km != null ? formatKm(km) : '—',
        attr(p, 'parking') ? labels.parkingType(attr(p, 'parking')!).replace(/^parking /, '') : '—',
        attr(p, 'capacity') ?? '—',
        attr(p, 'fee') === 'yes' ? 'płatny' : attr(p, 'fee') === 'no' ? 'bezpłatny' : '—',
        attr(p, 'opening_hours') ? formatOpeningHours(attr(p, 'opening_hours')!) : '—',
        attr(p, 'access') ? labels.access(attr(p, 'access')!) : '—',
      ],
    };
  });
}
const TRAIL_COLS = ['Szlak', 'Rodzaj', 'Długość', 'Znaki', 'Ranga', 'Od centrum', 'Przebieg'];
function trailRows(index: DataIndex, list: Entity[], city: CitySeed | null): TableModel['rows'] {
  return list.map((t) => {
    const km = city ? kmFromCity(t, city) : null;
    const colourRaw = attr(t, 'colour');
    const colour = attr(t, 'colour_pl') ?? (colourRaw && !/^#|^[0-9a-f]{6}$/i.test(colourRaw) ? labels.colour(colourRaw) : undefined);
    const len = trailLengthKm(t);
    return {
      cells: [
        { href: paths.entity('trail', t.slug), text: uniqueName(index, t) },
        attr(t, 'route') ? labels.routeType(attr(t, 'route')!).replace(/^szlak |^trasa /, '') : '—',
        len ? formatKm(len) : '—',
        colour ?? attr(t, 'ref') ?? '—',
        attr(t, 'network') ? labels.network(attr(t, 'network')!).replace(/ (sieć rowerowa|szlak pieszy)$/, '') : attr(t, 'network_pl') ?? '—',
        km != null ? formatKm(km) : '—',
        t.computed?.isLoop || attr(t, 'roundtrip') === 'yes' ? 'pętla' : attr(t, 'from') && attr(t, 'to') ? `${attr(t, 'from')} – ${attr(t, 'to')}` : '—',
      ],
    };
  });
}
const BEACH_COLS = ['Plaża', 'Od centrum', 'Strzeżona', 'Psy', 'Wstęp', 'Parking (najbliższy)'];
function beachRows(index: DataIndex, list: Entity[], city: CitySeed | null): TableModel['rows'] {
  return list.map((b) => {
    const km = city ? kmFromCity(b, city) : null;
    const nearest = resolveRel(index, b.rel.parkings)[0];
    const lg = attr(b, 'lifeguard') ?? attr(b, 'supervised');
    return {
      cells: [
        { href: paths.entity('beach', b.slug), text: uniqueName(index, b) },
        km != null ? formatKm(km) : '—',
        lg ? labels.yesNoOr(lg) : '—',
        attr(b, 'dog') === 'yes' ? 'dozwolone' : attr(b, 'dog') === 'no' ? 'zakaz' : attr(b, 'dog') ?? '—',
        attr(b, 'fee') === 'yes' ? 'płatny' : attr(b, 'fee') === 'no' ? 'bezpłatny' : '—',
        nearest ? { href: paths.entity('parking', nearest.entity.slug), text: `${uniqueName(index, nearest.entity)} (${formatKm(nearest.km ?? 0)})` } : '—',
      ],
    };
  });
}

// -----------------------------------------------------------------------------
// Miasto (hub)
// -----------------------------------------------------------------------------
export function buildCityModel(citySlug: string, index: DataIndex, siteUrl: string): HubModel {
  const city = index.cityBySlug.get(citySlug);
  if (!city) throw new Error(`Nieznane miasto ${citySlug}`);
  const rec = index.byHub.get(citySlug) ?? { parking: [], trail: [], beach: [] };
  const publicParkings = rec.parking.filter(isPublicParking);
  const total = rec.parking.length + rec.trail.length + rec.beach.length;
  const region = city.location.region;
  const regionSlug = index.regionByName.get(region)?.slug ?? null;

  const crumbs: Crumb[] = [{ name: 'Start', href: paths.home }, { name: 'Miasta', href: paths.cities }, { name: city.name, href: paths.city(citySlug) }];
  const stats: Fact[] = [
    { label: 'Województwo', value: region, href: regionSlug ? paths.region(regionSlug) : undefined },
    { label: 'Parkingi w bazie', value: `${rec.parking.length} (publicznie dostępne: ${publicParkings.length})`, href: rec.parking.length ? paths.cityType(citySlug, 'parking') : undefined },
    { label: 'Szlaki w bazie', value: String(rec.trail.length), href: rec.trail.length ? paths.cityType(citySlug, 'trail') : undefined },
    { label: 'Plaże i kąpieliska', value: String(rec.beach.length), href: rec.beach.length ? paths.cityType(citySlug, 'beach') : undefined },
    { label: 'Zasięg danych', value: 'obiekty do ok. 10 km od centrum; szlaki, których przebieg zbliża się na 10 km' },
  ];

  const tables: TableModel[] = [];
  const sections: Section[] = [];
  if (publicParkings.length) {
    const top = [...publicParkings].sort(byKm(city)).slice(0, 10);
    tables.push({ id: 'parkingi', heading: `Parkingi ${inCity(city.name)} – najbliżej centrum`, intro: `10 z ${publicParkings.length} publicznie dostępnych parkingów, według odległości w linii prostej od centrum. Numery na mapie odpowiadają wierszom.`, columns: PARKING_COLS, rows: parkingRows(index, top, city) });
    sections.push({ id: 'wiecej-parkingow', heading: 'Wszystkie parkingi', items: [{ href: paths.cityType(citySlug, 'parking'), title: `Parkingi ${inCity(city.name)} – pełna lista (${rec.parking.length})`, sub: 'tabela porównawcza z filtrami: P+R, bezpłatne, całodobowe, podziemne, ładowanie EV' }] });
  }
  if (rec.trail.length) {
    const top = [...rec.trail].sort(byLengthDesc).slice(0, 10);
    tables.push({ id: 'szlaki', heading: `Szlaki rowerowe i piesze ${inCity(city.name)}`, intro: `Najdłuższe z ${rec.trail.length} szlaków, których przebieg zbliża się do miasta na mniej niż 10 km. „Od centrum” = najbliższy punkt trasy.`, columns: TRAIL_COLS, rows: trailRows(index, top, city) });
    sections.push({ id: 'wiecej-szlakow', heading: 'Wszystkie szlaki', items: [{ href: paths.cityType(citySlug, 'trail'), title: `Szlaki ${inCity(city.name)} – pełna lista (${rec.trail.length})`, sub: 'osobno rowerowe i piesze, z długościami i oznakowaniem' }] });
  }
  if (rec.beach.length) {
    const sorted = [...rec.beach].sort(byKm(city));
    tables.push({ id: 'plaze', heading: `Plaże ${inCity(city.name)} i okolicy`, columns: BEACH_COLS, rows: beachRows(index, sorted.slice(0, 12), city) });
    if (rec.beach.length > 12) sections.push({ id: 'wiecej-plaz', heading: 'Wszystkie plaże', items: [{ href: paths.cityType(citySlug, 'beach'), title: `Plaże ${inCity(city.name)} – pełna lista (${rec.beach.length})` }] });
  }
  const near = index.bundle.cities
    .filter((c) => c.slug !== citySlug)
    .map((c) => ({ c, km: distanceKm(city.coordinates, c.coordinates) ?? 1e9 }))
    .filter((x) => x.km <= 80)
    .sort((a, b) => a.km - b.km)
    .slice(0, 6);
  if (near.length) {
    sections.push({ id: 'okolica', heading: 'Inne miasta w okolicy', items: near.map(({ c, km }) => ({ href: paths.city(c.slug), title: c.name, sub: c.location.region, meta: formatKm(km) })) });
  }

  const firstTable = tables[0];
  const markerSource = firstTable?.id === 'parkingi' ? [...publicParkings].sort(byKm(city)).slice(0, 9) : firstTable?.id === 'plaze' ? [...rec.beach].sort(byKm(city)).slice(0, 9) : [];
  const markers = markerSource.map((e, i) => ({ point: e.coordinates, label: String(i + 1) }));
  const map = buildStaticMap({ center: city.coordinates, zoom: markers.length ? 13 : 12, cols: 3, rows: 2, pin: true, markers, alt: `Mapa: ${city.name}` });

  const intro: string[] = [
    `${city.name} (${region}). W bazie gdziemy.pl: ${countOf(rec.parking.length, 'parking')}${rec.parking.length ? ` (w tym ${publicParkings.length} publicznie dostępnych)` : ''}, ${countOf(rec.trail.length, 'trail')} i ${countOf(rec.beach.length, 'beach')} w promieniu ok. 10 km od centrum.`,
    `Dane pochodzą z OpenStreetMap (stan bazy: ${index.bundle.meta.generatedAt}); prezentujemy wyłącznie obiekty z nazwą. Puste pola w tabelach oznaczają brak danej w OSM.`,
  ];
  const robots = total >= 3 ? 'index' : 'noindex';
  return {
    canonical: paths.city(citySlug),
    title: `${city.name} – parkingi, szlaki i plaże – ${site.name}`,
    metaDescription: `${city.name}: ${countOf(rec.parking.length, 'parking')}, ${countOf(rec.trail.length, 'trail')}, ${countOf(rec.beach.length, 'beach')} w promieniu ok. 10 km od centrum. Tabele z odległością, miejscami, opłatami i długościami tras na danych OpenStreetMap.`,
    h1: city.name,
    subtitle: region,
    robots,
    crumbs,
    intro,
    stats,
    map,
    sections,
    tables,
    jsonLd: [
      breadcrumbLd(crumbs, siteUrl),
      { '@context': 'https://schema.org', '@type': 'City', name: city.name, url: `${siteUrl}${paths.city(citySlug)}`, geo: { '@type': 'GeoCoordinates', latitude: city.coordinates.lat, longitude: city.coordinates.lng }, containedInPlace: { '@type': 'AdministrativeArea', name: `Województwo ${region.toLowerCase()}` } },
    ],
  };
}

// -----------------------------------------------------------------------------
// Miasto / typ (pelna tabela)
// -----------------------------------------------------------------------------
export function buildCityTypeModel(citySlug: string, type: EntityType, index: DataIndex, siteUrl: string): HubModel | null {
  const city = index.cityBySlug.get(citySlug);
  if (!city) return null;
  const rec = index.byHub.get(citySlug);
  const list = rec ? rec[type] : [];
  if (list.length === 0) return null;
  const cfg = typeConfigs[type];
  const crumbs: Crumb[] = [
    { name: 'Start', href: paths.home },
    { name: cfg.label, href: cfg.indexPath },
    { name: city.name, href: paths.city(citySlug) },
    { name: `${cfg.label} ${inCity(city.name)}`, href: paths.cityType(citySlug, type) },
  ];
  const tables: TableModel[] = [];
  const sections: Section[] = [];
  const stats: Fact[] = [];
  const intro: string[] = [];
  let mapMarkers: { point: { lat: number; lng: number }; label: string }[] = [];

  if (type === 'parking') {
    const sorted = [...list].sort(byKm(city));
    const pub = sorted.filter(isPublicParking);
    const restricted = sorted.filter((p) => !isPublicParking(p));
    const free = pub.filter((p) => attr(p, 'fee') === 'no');
    const paid = pub.filter((p) => attr(p, 'fee') === 'yes');
    const pr = pub.filter((p) => attr(p, 'park_ride') && attr(p, 'park_ride') !== 'no');
    const allDay = pub.filter((p) => attr(p, 'opening_hours') === '24/7');
    const covered = pub.filter((p) => ['multi-storey', 'underground', 'rooftop'].includes(attr(p, 'parking') ?? '') || attr(p, 'covered') === 'yes');
    const ev = pub.filter((p) => attr(p, 'capacity_charging') && attr(p, 'capacity_charging') !== 'no');
    const withCap = pub.map((p) => numericAttr(p, 'capacity')).filter((n): n is number => !!n);
    const capSum = withCap.reduce((a, b) => a + b, 0);
    stats.push({ label: 'Parkingi publicznie dostępne', value: String(pub.length) });
    stats.push({ label: 'Bezpłatne / płatne (wg OSM)', value: `${free.length} / ${paid.length}${pub.length - free.length - paid.length ? ` (brak danych: ${pub.length - free.length - paid.length})` : ''}` });
    if (pr.length) stats.push({ label: 'Parkuj i Jedź (P+R)', value: String(pr.length), href: pr.length >= 2 ? '#p-r' : undefined });
    if (allDay.length) stats.push({ label: 'Całodobowe (24/7)', value: String(allDay.length), href: allDay.length >= 2 ? '#calodobowe' : undefined });
    if (covered.length) stats.push({ label: 'Podziemne, wielopoziomowe, zadaszone', value: String(covered.length), href: covered.length >= 2 ? '#zadaszone' : undefined });
    if (ev.length) stats.push({ label: 'Ze stanowiskami ładowania EV', value: String(ev.length), href: ev.length >= 2 ? '#ev' : undefined });
    if (withCap.length) stats.push({ label: 'Łączna liczba miejsc (gdzie podano)', value: `${capSum.toLocaleString('pl-PL')} na ${withCap.length} ${plural(withCap.length, 'parkingu', 'parkingach', 'parkingach')}` });
    intro.push(`Wszystkie nazwane parkingi z OpenStreetMap w promieniu ok. 10 km od centrum (${city.name}), posortowane według odległości od centrum w linii prostej. Puste pola oznaczają brak danej w OSM, nie jej brak w rzeczywistości. Szczegóły (cennik, warunki opłat, limit wysokości, płatności) są na stronach parkingów.`);
    tables.push({ id: 'wszystkie', heading: `Parkingi publicznie dostępne ${inCity(city.name)}`, intro: 'Numery na mapie odpowiadają pierwszym wierszom tej tabeli.', columns: PARKING_COLS, rows: parkingRows(index, pub, city) });
    if (pr.length >= 2) tables.push({ id: 'p-r', heading: 'Parkingi Parkuj i Jedź (P+R)', intro: 'Parkingi oznaczone w OSM tagiem park_ride.', columns: PARKING_COLS, rows: parkingRows(index, pr, city) });
    if (free.length >= 2) tables.push({ id: 'bezplatne', heading: 'Parkingi bezpłatne', intro: 'Wg tagu fee=no w OSM; opłaty mogą obowiązywać w wybranych godzinach – sprawdź szczegóły na stronie parkingu.', columns: PARKING_COLS, rows: parkingRows(index, free, city) });
    if (allDay.length >= 2) tables.push({ id: 'calodobowe', heading: 'Parkingi całodobowe', columns: PARKING_COLS, rows: parkingRows(index, allDay, city) });
    if (covered.length >= 2) tables.push({ id: 'zadaszone', heading: 'Parkingi podziemne, wielopoziomowe i zadaszone', columns: PARKING_COLS, rows: parkingRows(index, covered, city) });
    if (ev.length >= 2) tables.push({ id: 'ev', heading: 'Parkingi ze stanowiskami ładowania pojazdów elektrycznych', columns: PARKING_COLS, rows: parkingRows(index, ev, city) });
    if (restricted.length) {
      sections.push({ id: 'ograniczone', heading: 'Parkingi z ograniczonym dostępem', intro: 'Oznaczone w OSM jako prywatne, dla pracowników lub na przepustkę. Wymienione informacyjnie; ich strony nie są kierowane do indeksu wyszukiwarek.', items: restricted.map((p) => entityItem(index, p, kmFromCity(p, city))) });
    }
    mapMarkers = pub.slice(0, 9).map((p, i) => ({ point: p.coordinates, label: String(i + 1) }));
  } else if (type === 'trail') {
    const sorted = [...list].sort(byLengthDesc);
    const bike = sorted.filter((t) => ['bicycle', 'mtb'].includes(attr(t, 'route') ?? ''));
    const hike = sorted.filter((t) => ['hiking', 'foot'].includes(attr(t, 'route') ?? ''));
    const loops = sorted.filter((t) => t.computed?.isLoop || attr(t, 'roundtrip') === 'yes');
    const totalKm = sorted.reduce((a, t) => a + (trailLengthKm(t) ?? 0), 0);
    stats.push({ label: 'Szlaki rowerowe', value: String(bike.length), href: bike.length ? '#rowerowe' : undefined });
    stats.push({ label: 'Szlaki piesze', value: String(hike.length), href: hike.length ? '#piesze' : undefined });
    if (loops.length) stats.push({ label: 'Trasy okrężne (pętle)', value: String(loops.length) });
    stats.push({ label: 'Łączna długość', value: formatKm(Math.round(totalKm)) });
    intro.push(`Szlaki z OpenStreetMap (relacje route=bicycle/hiking/mtb/foot z nazwą), których przebieg zbliża się do centrum miasta na mniej niż 10 km. Długość liczona z geometrii OSM; czas na stronie szlaku szacowany dla 15 km/h (rower) i 4 km/h (pieszo). Kolumna „Od centrum” to odległość najbliższego punktu trasy od centrum.`);
    if (bike.length) tables.push({ id: 'rowerowe', heading: `Szlaki rowerowe ${inCity(city.name)}`, columns: TRAIL_COLS, rows: trailRows(index, bike, city) });
    if (hike.length) tables.push({ id: 'piesze', heading: `Szlaki piesze ${inCity(city.name)}`, columns: TRAIL_COLS, rows: trailRows(index, hike, city) });
    const other = sorted.filter((t) => !bike.includes(t) && !hike.includes(t));
    if (other.length) tables.push({ id: 'inne', heading: 'Pozostałe trasy', columns: TRAIL_COLS, rows: trailRows(index, other, city) });
  } else {
    const sorted = [...list].sort(byKm(city));
    const guarded = sorted.filter((b) => (attr(b, 'lifeguard') ?? attr(b, 'supervised')) === 'yes');
    const dogs = sorted.filter((b) => attr(b, 'dog') === 'yes');
    stats.push({ label: 'Plaże i kąpieliska', value: String(sorted.length) });
    if (guarded.length) stats.push({ label: 'Strzeżone (wg OSM)', value: String(guarded.length) });
    if (dogs.length) stats.push({ label: 'Dozwolone psy (wg OSM)', value: String(dogs.length) });
    stats.push({ label: 'Z nazwanym parkingiem do 1,5 km', value: String(sorted.filter((b) => b.rel.parkings.length).length) });
    intro.push(`Plaże i kąpieliska z OpenStreetMap w promieniu ok. 10 km od centrum (${city.name}). Kolumna „Parking” pokazuje najbliższy nazwany parking z bazy (do 1,5 km); pełną listę parkingów przy plaży znajdziesz na stronie plaży.`);
    tables.push({ id: 'plaze', heading: `Plaże ${inCity(city.name)} i okolicy`, intro: 'Numery na mapie odpowiadają pierwszym wierszom tabeli.', columns: BEACH_COLS, rows: beachRows(index, sorted, city) });
    mapMarkers = sorted.slice(0, 9).map((b, i) => ({ point: b.coordinates, label: String(i + 1) }));
  }

  const rowsTotal = tables.reduce((a, t) => a + t.rows.length, 0);
  const robots = (tables[0]?.rows.length ?? 0) >= 3 ? 'index' : 'noindex';
  const label = `${cfg.label} ${inCity(city.name)}`;
  const items = list.map((e) => entityItem(index, e));
  return {
    canonical: paths.cityType(citySlug, type),
    title: `${label} – lista i porównanie (${list.length}) – ${site.name}`,
    metaDescription:
      type === 'parking'
        ? `${label}: ${countOf(list.length, 'parking')} z OpenStreetMap – odległość od centrum, liczba miejsc, opłaty, godziny, P+R, parkingi podziemne. Tabela porównawcza i mapa.`
        : type === 'trail'
          ? `${label}: ${countOf(list.length, 'trail')} rowerowych i pieszych z długościami, oznakowaniem i przebiegiem. Mapy tras i parkingi przy szlakach.`
          : `${label}: ${countOf(list.length, 'beach')} z informacją o ratownikach, psach, opłatach i najbliższym parkingu.`,
    h1: label,
    subtitle: city.location.region,
    robots,
    crumbs,
    intro,
    stats,
    map: buildStaticMap({ center: city.coordinates, zoom: type === 'trail' ? 11 : 13, cols: 3, rows: 2, pin: true, markers: mapMarkers, alt: `Mapa: ${label}` }),
    sections,
    tables,
    jsonLd: [breadcrumbLd(crumbs, siteUrl), itemListLd(label, items, siteUrl)],
  };
}

// -----------------------------------------------------------------------------
// Wojewodztwo
// -----------------------------------------------------------------------------
export function buildRegionModel(regionSlug: string, index: DataIndex, siteUrl: string): HubModel {
  const region = index.regionBySlug.get(regionSlug);
  if (!region) throw new Error(`Nieznane wojewodztwo ${regionSlug}`);
  const rec = index.byRegion.get(region.region) ?? { parking: [], trail: [], beach: [] };
  const cities = index.bundle.cities.filter((c) => c.location.region === region.region);
  const crumbs: Crumb[] = [{ name: 'Start', href: paths.home }, { name: 'Województwa', href: paths.regions }, { name: region.region, href: paths.region(regionSlug) }];
  const sections: Section[] = [];
  const tables: TableModel[] = [];

  const cityItems: LinkItem[] = cities.map((c) => {
    const r = index.byHub.get(c.slug) ?? { parking: [], trail: [], beach: [] };
    return { href: paths.city(c.slug), title: c.name, sub: `${countOf(r.parking.length, 'parking')}, ${countOf(r.trail.length, 'trail')}, ${countOf(r.beach.length, 'beach')}` };
  });
  if (cities.length) {
    tables.push({
      id: 'miasta',
      heading: 'Miasta w bazie',
      intro: 'Dla każdego miasta zbieramy nazwane obiekty do ok. 10 km od centrum. Liczby w nawiasach: parkingi publicznie dostępne.',
      columns: ['Miasto', 'Parkingi', 'Szlaki', 'Plaże'],
      rows: cities.map((c) => {
        const r = index.byHub.get(c.slug) ?? { parking: [], trail: [], beach: [] };
        return {
          cells: [
            { href: paths.city(c.slug), text: c.name },
            r.parking.length ? { href: paths.cityType(c.slug, 'parking'), text: `${r.parking.length} (${r.parking.filter(isPublicParking).length})` } : '0',
            r.trail.length ? { href: paths.cityType(c.slug, 'trail'), text: String(r.trail.length) } : '0',
            r.beach.length ? { href: paths.cityType(c.slug, 'beach'), text: String(r.beach.length) } : '0',
          ],
        };
      }),
    });
  }
  const longest = [...rec.trail].filter((t) => trailLengthKm(t)).sort(byLengthDesc).slice(0, 12);
  if (longest.length) tables.push({ id: 'szlaki', heading: 'Najdłuższe szlaki w województwie', columns: TRAIL_COLS.filter((c) => c !== 'Od centrum'), rows: trailRows(index, longest, null).map((r) => ({ cells: r.cells.filter((_, i) => i !== 5) })) });
  if (rec.beach.length) tables.push({ id: 'plaze', heading: 'Plaże i kąpieliska', columns: BEACH_COLS.filter((c) => c !== 'Od centrum'), rows: beachRows(index, [...rec.beach].sort((a, b) => a.name.localeCompare(b.name, 'pl')).slice(0, 30), null).map((r) => ({ cells: r.cells.filter((_, i) => i !== 1) })) });

  // Obiekty spoza zasiegu miast-hubow (np. lista redakcyjna) – zeby kazda strona miala link.
  const outside = (list: Entity[]) => list.filter((e) => hubSlugsOf(e).length === 0);
  const outP = outside(rec.parking);
  const outT = outside(rec.trail);
  const outB = outside(rec.beach);
  if (outP.length || outT.length || outB.length) {
    const items: LinkItem[] = [...outP, ...outB, ...outT].map((e) => ({ href: paths.entity(e.type, e.slug), title: uniqueName(index, e), sub: [typeConfigs[e.type].labelOne, e.location.city, shortInfo(e)].filter(Boolean).join(' · ') }));
    sections.push({ id: 'poza-miastami', heading: 'Obiekty poza zasięgiem miast z bazy', intro: 'Wpisy przypisane do województwa, ale położone dalej niż 10 km od miast-hubów (m.in. lista redakcyjna wybrzeża).', items });
  }

  const pub = rec.parking.filter(isPublicParking);
  const stats: Fact[] = [
    { label: 'Stolica', value: region.capital },
    { label: 'Miasta w bazie', value: String(cities.length) },
    { label: 'Parkingi', value: `${rec.parking.length} (publicznie dostępne: ${pub.length})` },
    { label: 'Szlaki', value: String(rec.trail.length) },
    { label: 'Plaże', value: String(rec.beach.length) },
  ];
  const markers = cities.slice(0, 9).map((c, i) => ({ point: c.coordinates, label: String(i + 1) }));
  return {
    canonical: paths.region(regionSlug),
    title: `Województwo ${region.region.toLowerCase()} – parkingi, szlaki, plaże – ${site.name}`,
    metaDescription: `Województwo ${region.region.toLowerCase()}: ${countOf(cities.length, 'city')} w bazie, ${countOf(rec.parking.length, 'parking')}, ${countOf(rec.trail.length, 'trail')}, ${countOf(rec.beach.length, 'beach')}. Tabele miast, najdłuższe szlaki i plaże na danych OpenStreetMap.`,
    h1: `Województwo ${region.region.toLowerCase()}`,
    robots: cities.length ? 'index' : 'noindex',
    crumbs,
    intro: [`Zestawienie miast z bazy gdziemy.pl w województwie ${region.region.toLowerCase()} oraz obiektów przypisanych do nich geograficznie. Liczby dotyczą wyłącznie obiektów w bazie (nazwane obiekty OSM do ok. 10 km od miast), nie całego województwa.`],
    stats,
    map: buildStaticMap({ center: region.coordinates, zoom: 8, cols: 3, rows: 2, pin: false, markers, alt: `Mapa: województwo ${region.region.toLowerCase()}` }),
    sections,
    tables,
    jsonLd: [breadcrumbLd(crumbs, siteUrl), itemListLd(`Miasta – ${region.region}`, cityItems, siteUrl)],
  };
}

// -----------------------------------------------------------------------------
// Indeksy kategorii, miast, wojewodztw, strona glowna
// -----------------------------------------------------------------------------
function cityCountsFor(index: DataIndex, type: EntityType): { city: CitySeed; count: number; pub: number }[] {
  return index.bundle.cities
    .map((city) => {
      const r = index.byHub.get(city.slug);
      const list = r ? r[type] : [];
      return { city, count: list.length, pub: type === 'parking' ? list.filter(isPublicParking).length : list.length };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || a.city.name.localeCompare(b.city.name, 'pl'));
}

export function buildCategoryIndexModel(type: EntityType, index: DataIndex, siteUrl: string): HubModel {
  const cfg = typeConfigs[type];
  const all = type === 'parking' ? index.bundle.parkings : type === 'trail' ? index.bundle.trails : index.bundle.beaches;
  const indexable = all.filter((e) => assessEntity(e).indexable);
  const crumbs: Crumb[] = [{ name: 'Start', href: paths.home }, { name: cfg.label, href: cfg.indexPath }];
  const byCity = cityCountsFor(index, type);
  const cityItems: LinkItem[] = byCity.map(({ city, count, pub }) => ({
    href: paths.cityType(city.slug, type),
    title: `${cfg.label} ${inCity(city.name)}`,
    sub: city.location.region,
    meta: type === 'parking' ? `${count} (publ. ${pub})` : String(count),
  }));
  const tables: TableModel[] = [
    {
      id: 'miasta',
      heading: `${cfg.label} według miast`,
      intro: 'Liczba nazwanych obiektów z OpenStreetMap w promieniu ok. 10 km od centrum miasta. Kliknij miasto, aby zobaczyć tabelę porównawczą.',
      columns: type === 'parking' ? ['Miasto', 'Województwo', 'Parkingi', 'Publicznie dostępne'] : ['Miasto', 'Województwo', cfg.label],
      rows: byCity.map(({ city, count, pub }) => ({
        cells: type === 'parking'
          ? [{ href: paths.cityType(city.slug, type), text: city.name }, city.location.region, String(count), String(pub)]
          : [{ href: paths.cityType(city.slug, type), text: city.name }, city.location.region, String(count)],
      })),
    },
  ];
  const sections: Section[] = [];
  const stats: Fact[] = [{ label: 'Obiektów w bazie', value: String(all.length) }, { label: 'Miast', value: String(byCity.length) }, { label: 'Stan danych OSM', value: index.bundle.meta.generatedAt }];
  let intro: string[] = [];
  if (type === 'parking') {
    const pub = all.filter(isPublicParking);
    const withFee = all.filter((p) => attr(p, 'fee'));
    const withCap = all.filter((p) => attr(p, 'capacity'));
    stats.push({ label: 'Publicznie dostępne', value: String(pub.length) });
    stats.push({ label: 'Z informacją o opłacie', value: `${withFee.length} (${Math.round((withFee.length / Math.max(1, all.length)) * 100)}%)` });
    stats.push({ label: 'Z liczbą miejsc', value: `${withCap.length} (${Math.round((withCap.length / Math.max(1, all.length)) * 100)}%)` });
    intro = [
      'Nazwane parkingi z OpenStreetMap w największych miastach i miejscowościach turystycznych Polski. Dla każdego parkingu pokazujemy to, co zapisano w OSM: rodzaj (naziemny, podziemny, wielopoziomowy), liczbę miejsc, opłaty i cennik, godziny otwarcia, dostęp, operatora, a także parkingi w promieniu 2 km do porównania.',
      'Wybierz miasto, aby zobaczyć tabelę porównawczą z filtrami (P+R, bezpłatne, całodobowe, podziemne, z ładowaniem EV).',
    ];
  } else if (type === 'trail') {
    const bike = all.filter((t) => ['bicycle', 'mtb'].includes(attr(t, 'route') ?? ''));
    const hike = all.length - bike.length;
    const totalKm = all.reduce((a, t) => a + (trailLengthKm(t) ?? 0), 0);
    stats.push({ label: 'Szlaki rowerowe / piesze', value: `${bike.length} / ${hike}` });
    stats.push({ label: 'Łączna długość', value: formatKm(Math.round(totalKm)) });
    intro = [
      'Znakowane szlaki rowerowe i piesze zapisane w OpenStreetMap jako relacje tras (route=bicycle, hiking, mtb, foot) w okolicy miast z bazy. Dla każdego szlaku liczymy długość z geometrii, szacujemy czas przejścia, pokazujemy oznakowanie, przebieg (od–do), mapę oraz parkingi położone przy trasie.',
    ];
    const longest = [...all].filter((t) => trailLengthKm(t)).sort(byLengthDesc).slice(0, 15);
    tables.push({ id: 'najdluzsze', heading: 'Najdłuższe szlaki w bazie', columns: TRAIL_COLS.filter((c) => c !== 'Od centrum'), rows: trailRows(index, longest, null).map((r) => ({ cells: r.cells.filter((_, i) => i !== 5) })) });
  } else {
    const guarded = all.filter((b) => (attr(b, 'lifeguard') ?? attr(b, 'supervised')) === 'yes');
    stats.push({ label: 'Strzeżone (wg OSM)', value: String(guarded.length) });
    stats.push({ label: 'Z parkingiem do 1,5 km', value: String(all.filter((b) => b.rel.parkings.length).length) });
    intro = [
      'Plaże i kąpieliska z nazwą zapisane w OpenStreetMap w okolicy miast z bazy, w tym nad Bałtykiem i na Mazurach. Dla każdej plaży: ratownicy, psy, opłaty (jeśli zapisano w OSM), mapa oraz nazwane parkingi w promieniu 1,5 km.',
    ];
    const regions = new Map<string, Entity[]>();
    for (const b of all) {
      const r = b.location.region ?? 'Inne';
      if (!regions.has(r)) regions.set(r, []);
      regions.get(r)!.push(b);
    }
    for (const [r, list] of [...regions.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const rs = index.regionByName.get(r)?.slug;
      tables.push({ id: `region-${rs ?? 'inne'}`, heading: `${r} (${list.length})`, columns: BEACH_COLS.filter((c) => c !== 'Od centrum'), rows: beachRows(index, list.sort((a, b) => a.name.localeCompare(b.name, 'pl')), null).map((row) => ({ cells: row.cells.filter((_, i) => i !== 1) })) });
    }
  }
  stats.push({ label: 'Strony kierowane do indeksu', value: `${indexable.length} z ${all.length}`, href: paths.methodology });
  return {
    canonical: cfg.indexPath,
    title: `${cfg.label} w Polsce – ${type === 'parking' ? 'miejsca, opłaty, godziny' : type === 'trail' ? 'długości, oznakowanie, mapy' : 'ratownicy, psy, parkingi'} – ${site.name}`,
    metaDescription: type === 'parking'
      ? `Parkingi w ${byCity.length} miastach Polski na danych OpenStreetMap: liczba miejsc, opłaty, godziny, P+R, parkingi podziemne. Tabele porównawcze i mapy.`
      : type === 'trail'
        ? `Szlaki rowerowe i piesze w okolicy ${byCity.length} miast: długość, czas przejścia, oznakowanie, mapa przebiegu i parkingi przy trasie. Dane OpenStreetMap.`
        : `Plaże i kąpieliska w Polsce (${all.length}): ratownicy, psy, opłaty i najbliższe parkingi. Dane OpenStreetMap z mapami.`,
    h1: `${cfg.label} w Polsce`,
    robots: 'index',
    crumbs,
    intro,
    stats,
    map: null,
    sections,
    tables,
    jsonLd: [breadcrumbLd(crumbs, siteUrl), itemListLd(cfg.label, cityItems, siteUrl)],
  };
}

export function buildCitiesIndexModel(index: DataIndex, siteUrl: string): HubModel {
  const crumbs: Crumb[] = [{ name: 'Start', href: paths.home }, { name: 'Miasta', href: paths.cities }];
  const tables: TableModel[] = [];
  const allItems: LinkItem[] = [];
  for (const region of index.bundle.regions) {
    const cities = index.bundle.cities.filter((c) => c.location.region === region.region);
    if (!cities.length) continue;
    tables.push({
      id: region.slug,
      heading: region.region,
      columns: ['Miasto', 'Parkingi (publ.)', 'Szlaki', 'Plaże'],
      rows: cities.map((c) => {
        const r = index.byHub.get(c.slug) ?? { parking: [], trail: [], beach: [] };
        allItems.push({ href: paths.city(c.slug), title: c.name });
        return {
          cells: [
            { href: paths.city(c.slug), text: c.name },
            r.parking.length ? { href: paths.cityType(c.slug, 'parking'), text: `${r.parking.length} (${r.parking.filter(isPublicParking).length})` } : '0',
            r.trail.length ? { href: paths.cityType(c.slug, 'trail'), text: String(r.trail.length) } : '0',
            r.beach.length ? { href: paths.cityType(c.slug, 'beach'), text: String(r.beach.length) } : '0',
          ],
        };
      }),
    });
  }
  const sections: Section[] = [{ id: 'wojewodztwa', heading: 'Strony województw', items: index.bundle.regions.map((r) => ({ href: paths.region(r.slug), title: r.region })) }];
  return {
    canonical: paths.cities,
    title: `Miasta – ${allItems.length} miast z parkingami, szlakami i plażami – ${site.name}`,
    metaDescription: `${countOf(allItems.length, 'city')} w bazie gdziemy.pl pogrupowanych według województw. Dla każdego miasta: parkingi, szlaki rowerowe i piesze oraz plaże z OpenStreetMap.`,
    h1: 'Miasta',
    robots: 'index',
    crumbs,
    intro: ['Baza obejmuje stolice województw i główne miejscowości turystyczne. Każde miasto to punkt centralny, wokół którego (do ok. 10 km) zbieramy nazwane parkingi, plaże i szlaki z OpenStreetMap. Liczby w nawiasach: parkingi publicznie dostępne.'],
    stats: [{ label: 'Miast', value: String(allItems.length) }, { label: 'Województw', value: String(tables.length) }],
    map: null,
    sections,
    tables,
    jsonLd: [breadcrumbLd(crumbs, siteUrl), itemListLd('Miasta', allItems, siteUrl)],
  };
}

export function buildRegionsIndexModel(index: DataIndex, siteUrl: string): HubModel {
  const crumbs: Crumb[] = [{ name: 'Start', href: paths.home }, { name: 'Województwa', href: paths.regions }];
  const items: LinkItem[] = index.bundle.regions.map((r) => ({ href: paths.region(r.slug), title: r.region }));
  const table: TableModel = {
    id: 'wojewodztwa',
    heading: '16 województw',
    columns: ['Województwo', 'Miasta w bazie', 'Parkingi (publ.)', 'Szlaki', 'Plaże'],
    rows: index.bundle.regions.map((r) => {
      const rec = index.byRegion.get(r.region) ?? { parking: [], trail: [], beach: [] };
      const cities = index.bundle.cities.filter((c) => c.location.region === r.region).length;
      return { cells: [{ href: paths.region(r.slug), text: r.region }, String(cities), `${rec.parking.length} (${rec.parking.filter(isPublicParking).length})`, String(rec.trail.length), String(rec.beach.length)] };
    }),
  };
  return {
    canonical: paths.regions,
    title: `Województwa – ${site.name}`,
    metaDescription: '16 województw: miasta w bazie, parkingi, szlaki rowerowe i piesze oraz plaże z OpenStreetMap w każdym z nich.',
    h1: 'Województwa',
    robots: 'index',
    crumbs,
    intro: ['Podział bazy według województw. Liczby dotyczą obiektów przypisanych do miast z bazy, nie całego województwa.'],
    stats: [],
    map: null,
    sections: [],
    tables: [table],
    jsonLd: [breadcrumbLd(crumbs, siteUrl), itemListLd('Województwa', items, siteUrl)],
  };
}

export function buildHomeModel(index: DataIndex, siteUrl: string): HubModel {
  const b = index.bundle;
  const pub = b.parkings.filter(isPublicParking);
  const parkingCities = cityCountsFor(index, 'parking').slice(0, 12);
  const trailCities = cityCountsFor(index, 'trail').slice(0, 8);
  const beachCities = cityCountsFor(index, 'beach').slice(0, 8);
  const longest = [...b.trails].filter((t) => trailLengthKm(t) && assessEntity(t).indexable).sort(byLengthDesc).slice(0, 8);
  const sections: Section[] = [
    { id: 'parkingi', heading: 'Gdzie zaparkować – parkingi według miast', intro: 'Tabele porównawcze: odległość od centrum, liczba miejsc, opłaty, godziny, P+R.', items: parkingCities.map(({ city, count, pub: p }) => ({ href: paths.cityType(city.slug, 'parking'), title: `Parkingi ${inCity(city.name)}`, sub: city.location.region, meta: `${p} publ. / ${count}` })), more: { href: typeConfigs.parking.indexPath, label: 'Wszystkie miasta z parkingami' } },
    { id: 'szlaki', heading: 'Szlaki rowerowe i piesze według miast', intro: 'Długość z geometrii OSM, szacowany czas, oznakowanie, mapa przebiegu i parkingi przy trasie.', items: trailCities.map(({ city, count }) => ({ href: paths.cityType(city.slug, 'trail'), title: `Szlaki ${inCity(city.name)}`, sub: city.location.region, meta: String(count) })), more: { href: typeConfigs.trail.indexPath, label: 'Wszystkie szlaki' } },
    { id: 'plaze', heading: 'Plaże i parkingi przy plażach', intro: 'Dla każdej plaży: ratownicy, psy, opłaty i nazwane parkingi do 1,5 km.', items: beachCities.map(({ city, count }) => ({ href: paths.cityType(city.slug, 'beach'), title: `Plaże ${inCity(city.name)}`, sub: city.location.region, meta: String(count) })), more: { href: typeConfigs.beach.indexPath, label: 'Wszystkie plaże' } },
  ];
  const tables: TableModel[] = longest.length
    ? [{ id: 'najdluzsze', heading: 'Najdłuższe szlaki w bazie', columns: TRAIL_COLS.filter((c) => c !== 'Od centrum'), rows: trailRows(index, longest, null).map((r) => ({ cells: r.cells.filter((_, i) => i !== 5) })) }]
    : [];
  const stats: Fact[] = [
    { label: 'Parkingi', value: `${b.parkings.length} (publicznie dostępne: ${pub.length})`, href: typeConfigs.parking.indexPath },
    { label: 'Szlaki', value: String(b.trails.length), href: typeConfigs.trail.indexPath },
    { label: 'Plaże', value: String(b.beaches.length), href: typeConfigs.beach.indexPath },
    { label: 'Miasta', value: String(b.cities.length), href: paths.cities },
    { label: 'Stan danych OSM', value: b.meta.generatedAt, href: paths.sources },
  ];
  return {
    canonical: paths.home,
    title: `${site.name} – parkingi, szlaki i plaże w Polsce (dane OpenStreetMap)`,
    metaDescription: `Gdzie zaparkować, którędy prowadzi szlak i gdzie jest najbliższa plaża: ${countOf(b.parkings.length, 'parking')}, ${countOf(b.trails.length, 'trail')} i ${countOf(b.beaches.length, 'beach')} w ${countOf(b.cities.length, 'city')} Polski. Mapy, tabele porównawcze, odległości – na otwartych danych OpenStreetMap.`,
    h1: 'Parkingi, szlaki i plaże w Polsce',
    subtitle: 'na otwartych danych OpenStreetMap',
    robots: 'index',
    crumbs: [{ name: 'Start', href: paths.home }],
    intro: [
      `gdziemy.pl odpowiada na trzy praktyczne pytania: gdzie zaparkować, którędy prowadzi szlak i gdzie jest plaża z parkingiem. Zbieramy nazwane obiekty z OpenStreetMap wokół ${countOf(b.cities.length, 'city')} i pokazujemy je w tabelach porównawczych z odległościami, opłatami, godzinami i mapami.`,
      'Nie generujemy opisów: każda informacja na stronie to konkretny zapis w OSM albo jawnie oznaczone obliczenie (odległość, długość szlaku, szacowany czas). Brak danej oznacza, że nie ma jej w źródle.',
    ],
    stats,
    map: null,
    sections,
    tables,
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'WebSite', name: site.name, url: siteUrl, description: site.tagline, inLanguage: 'pl-PL' },
      { '@context': 'https://schema.org', '@type': 'Dataset', name: 'gdziemy.pl – parkingi, szlaki i plaże (OpenStreetMap)', description: 'Znormalizowany zbiór nazwanych parkingów, szlaków i plaż z OpenStreetMap wokół miast Polski, z obliczonymi odległościami i długościami tras.', url: siteUrl, license: 'https://opendatacommons.org/licenses/odbl/1-0/', isBasedOn: 'https://www.openstreetmap.org/', dateModified: b.meta.generatedAt, creator: { '@type': 'Organization', name: site.name, url: siteUrl } },
    ],
  };
}
