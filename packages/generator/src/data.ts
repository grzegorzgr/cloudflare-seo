// Indeksowanie danych (czyste funkcje) — rozwiazywanie kluczy relacji,
// slowniki miast/regionow, filtry publicznych parkingow, unikalne nazwy.

import { slugify } from './slug.ts';
import { distanceKm } from './geo.ts';
import { formatKm, isRestrictedAccess } from './labels.ts';
import { bearingDeg, compassPl, displayName } from './names.ts';
import { isGenericName } from './quality.ts';
import type { CitySeed, DataBundle, Entity, EntityType, RegionSeed, RelItem } from './types.ts';

export interface DataIndex {
  bundle: DataBundle;
  byKey: Map<string, Entity>;
  cityBySlug: Map<string, CitySeed>;
  regionBySlug: Map<string, RegionSeed>;
  regionByName: Map<string, RegionSeed>;
  /** hubSlug -> encje danego typu (szlaki: wszystkie miasta do 10 km od przebiegu). */
  byHub: Map<string, Record<EntityType, Entity[]>>;
  /** region name -> encje danego typu. */
  byRegion: Map<string, Record<EntityType, Entity[]>>;
  /** key -> kwalifikator odrozniajacy encje o tej samej nazwie w tym samym miescie. */
  nameQualifier: Map<string, string>;
}

const byName = (a: Entity, b: Entity) => a.name.localeCompare(b.name, 'pl') || (a.slug < b.slug ? -1 : 1);
const emptyRec = (): Record<EntityType, Entity[]> => ({ parking: [], trail: [], beach: [] });

/** Miasta-huby, do ktorych nalezy encja (szlak: miasta do 10 km od przebiegu; POI: hub). */
export function hubSlugsOf(e: Entity): string[] {
  if (e.type === 'trail') {
    const fromRel = (e.rel?.cities ?? []).map((c) => c.key.replace(/^city\//, ''));
    if (fromRel.length) return fromRel;
  }
  return e.location.hubSlug ? [e.location.hubSlug] : [];
}

export function buildIndex(bundle: DataBundle): DataIndex {
  const byKey = new Map<string, Entity>();
  const byHub = new Map<string, Record<EntityType, Entity[]>>();
  const byRegion = new Map<string, Record<EntityType, Entity[]>>();
  const cityBySlug = new Map(bundle.cities.map((c) => [c.slug, c]));

  for (const list of [bundle.parkings, bundle.trails, bundle.beaches]) {
    for (const e of list) {
      byKey.set(`${e.type}/${e.slug}`, e);
      for (const hub of hubSlugsOf(e)) {
        if (!cityBySlug.has(hub)) continue;
        if (!byHub.has(hub)) byHub.set(hub, emptyRec());
        byHub.get(hub)![e.type].push(e);
      }
      if (e.location.region) {
        if (!byRegion.has(e.location.region)) byRegion.set(e.location.region, emptyRec());
        byRegion.get(e.location.region)![e.type].push(e);
      }
    }
  }
  for (const rec of byHub.values()) for (const t of Object.keys(rec) as EntityType[]) rec[t].sort(byName);
  for (const rec of byRegion.values()) for (const t of Object.keys(rec) as EntityType[]) rec[t].sort(byName);

  // Kwalifikatory nazw: ta sama nazwa wyswietlana w tym samym miescie (lub regionie).
  const nameQualifier = new Map<string, string>();
  const groups = new Map<string, Entity[]>();
  for (const list of [bundle.parkings, bundle.trails, bundle.beaches]) {
    for (const e of list) {
      const scope = e.location.city ?? e.location.hubSlug ?? e.location.region ?? '';
      const k = `${e.type}|${scope}|${displayName(e).toLowerCase()}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(e);
    }
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const used = new Map<string, number>();
    const proposed = members.map((e) => {
      const street = [e.address?.street, e.address?.housenumber].filter(Boolean).join(' ').trim();
      if (street && !displayName(e).includes(street)) return street;
      const ref = typeof e.attrs.ref === 'string' ? e.attrs.ref : null;
      if (ref) return `nr ${ref}`;
      const hub = e.location.hubSlug ? cityBySlug.get(e.location.hubSlug) : null;
      if (hub && e.type !== 'trail') {
        const km = distanceKm(hub.coordinates, e.coordinates);
        if (km != null) return `${formatKm(km)} ${compassPl(bearingDeg(hub.coordinates, e.coordinates))} od centrum`;
      }
      if (e.type === 'trail' && e.attrs.from && e.attrs.to) return `${e.attrs.from} – ${e.attrs.to}`;
      return e.osm ? `OSM ${e.osm.id}` : e.slug;
    });
    proposed.forEach((q, i) => {
      used.set(q, (used.get(q) ?? 0) + 1);
      const e = members[i];
      nameQualifier.set(`${e.type}/${e.slug}`, q);
    });
    // Jesli kwalifikatory nadal sie powtarzaja, dolacz id OSM.
    members.forEach((e, i) => {
      if ((used.get(proposed[i]) ?? 0) > 1) {
        nameQualifier.set(`${e.type}/${e.slug}`, `${proposed[i]}, OSM ${e.osm?.id ?? e.slug}`);
      }
    });
  }

  return {
    bundle,
    byKey,
    cityBySlug,
    regionBySlug: new Map(bundle.regions.map((r) => [r.slug, r])),
    regionByName: new Map(bundle.regions.map((r) => [r.region, r])),
    byHub,
    byRegion,
    nameQualifier,
  };
}

/** Nazwa wyswietlana z kwalifikatorem, unikalna w obrebie miasta/typu. */
export function uniqueName(index: DataIndex, e: Entity): string {
  const q = index.nameQualifier.get(`${e.type}/${e.slug}`);
  if (!q) return displayName(e);
  const raw = e.name.trim();
  if (e.type === 'parking' && isGenericName(raw)) {
    // Kwalifikator juz lokalizuje obiekt; operator/ulica z displayName nie sa potrzebne.
    const base = /parking/i.test(raw) ? raw : `Parking ${raw}`;
    const city = e.address?.city ?? e.location.city ?? null;
    return `${base} (${q})${city ? `, ${city}` : ''}`;
  }
  return `${displayName(e)} (${q})`;
}

export interface ResolvedRel {
  entity: Entity;
  km: number | null;
}

export function resolveRel(index: DataIndex, items: RelItem[] | undefined): ResolvedRel[] {
  const out: ResolvedRel[] = [];
  for (const it of items ?? []) {
    const e = index.byKey.get(it.key);
    if (e) out.push({ entity: e, km: it.km });
  }
  return out;
}

export function resolveCities(index: DataIndex, items: RelItem[] | undefined): { city: CitySeed; km: number | null }[] {
  const out: { city: CitySeed; km: number | null }[] = [];
  for (const it of items ?? []) {
    const slug = it.key.replace(/^city\//, '');
    const c = index.cityBySlug.get(slug);
    if (c) out.push({ city: c, km: it.km });
  }
  return out;
}

/** Parking publicznie dostepny (do list "gdzie zaparkowac"). */
export function isPublicParking(e: Entity): boolean {
  const access = typeof e.attrs.access === 'string' ? e.attrs.access : undefined;
  return !isRestrictedAccess(access);
}

export function regionSlugOf(index: DataIndex, regionName: string | null): string | null {
  if (!regionName) return null;
  return index.regionByName.get(regionName)?.slug ?? slugify(regionName);
}

/** Miasto-hub encji: dla szlaku najblizsze miasto na trasie, dla POI przypisany hub. */
export function cityOfEntity(index: DataIndex, e: Entity): CitySeed | null {
  const slugs = hubSlugsOf(e);
  for (const s of slugs) {
    const c = index.cityBySlug.get(s);
    if (c) return c;
  }
  return null;
}

export function numericAttr(e: Entity, key: string): number | null {
  const v = e.attrs[key];
  if (typeof v !== 'string') return null;
  const m = /^\s*(\d+(?:[.,]\d+)?)/.exec(v);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function trailLengthKm(e: Entity): number | null {
  if (e.computed?.lengthKm) return e.computed.lengthKm;
  const d = numericAttr(e, 'distance');
  return d && d > 0 ? d : null;
}
