// Warstwa GEO GRAPH: deterministyczny multi-hop graf przestrzenny (LEVEL 2).
// Buduje krawedzie miedzy istniejacymi encjami (cross-type) na podstawie
// wspoldzielonej lokalizacji i odleglosci haversine. ZERO nowych wezlow.

import { byDistanceFrom, distanceKm } from './geo.js';
import type { Dataset, Entity, TypeConfig } from './types.js';

/** Klucz wezla w grafie: unikalny w obrebie calego datasetu. */
export function nodeKey(basePath: string, slug: string): string {
  return `${basePath}/${slug}`;
}

/** Wezel grafu GEO - plaska projekcja encji na potrzeby linkowania. */
export interface GraphNode {
  key: string;
  slug: string;
  type: string;
  name: string;
  href: string;
  city: string | null;
  region: string | null;
}

/** Skierowana krawedz: sasiedztwo geograficzne miedzy dwoma wezlami. */
export interface GraphEdge {
  from: string;
  to: string;
  /** Odleglosc w km lub null, gdy brak wspolrzednych po ktorejs stronie. */
  distanceKm: number | null;
  /** true, gdy oba wezly maja ten sam typ (topical), false dla cross-type. */
  sameType: boolean;
}

/** Kompletny graf GEO: wezly + deterministyczne listy sasiedztwa. */
export interface GeoGraph {
  nodes: GraphNode[];
  /** Mapa key -> uporzadkowana lista krawedzi wychodzacych. */
  adjacency: Record<string, GraphEdge[]>;
}

/** Deterministyczna sciezka multi-hop (A -> B -> C). */
export interface GeoPath {
  nodes: string[];
  totalKm: number | null;
}

/** Maks. liczba krawedzi wychodzacych na wezel (soft clustering). */
const MAX_EDGES_PER_NODE = 8;

interface IndexedEntity {
  entity: Entity;
  config: TypeConfig;
  node: GraphNode;
}

function toNode(entity: Entity, config: TypeConfig): GraphNode {
  return {
    key: nodeKey(config.basePath, entity.slug),
    slug: entity.slug,
    type: config.basePath,
    name: entity.name,
    href: `/${config.basePath}/${entity.slug}`,
    city: entity.location?.city ?? null,
    region: entity.location?.region ?? null,
  };
}

/**
 * Buduje deterministyczny graf GEO ze wszystkich datasetow.
 * Krawedzie tworzone sa tylko miedzy encjami dzielacymi region
 * (a preferencyjnie miasto), uporzadkowane wg odleglosci haversine.
 * Ten sam wejsciowy dataset zawsze daje identyczny graf.
 */
export function buildGeoGraph(datasets: Dataset[]): GeoGraph {
  const indexed: IndexedEntity[] = [];
  for (const { entities, config } of datasets) {
    for (const entity of entities) {
      indexed.push({ entity, config, node: toNode(entity, config) });
    }
  }

  const nodes = indexed.map((item) => item.node);
  const adjacency: Record<string, GraphEdge[]> = {};

  for (const source of indexed) {
    const { entity, node } = source;
    const city = entity.location?.city ?? null;
    const region = entity.location?.region ?? null;

    const candidates = indexed
      .filter((other) => other.node.key !== node.key)
      .filter((other) => {
        const oCity = other.entity.location?.city ?? null;
        const oRegion = other.entity.location?.region ?? null;
        return (city && oCity === city) || (region && oRegion === region);
      });

    // Sortowanie: to samo miasto ma pierwszenstwo, potem dystans, potem klucz.
    const sortByProximity = byDistanceFrom(entity);
    candidates.sort((a, b) => {
      const aCity = city && a.entity.location?.city === city ? 0 : 1;
      const bCity = city && b.entity.location?.city === city ? 0 : 1;
      if (aCity !== bCity) return aCity - bCity;
      const byDist = sortByProximity(a.entity, b.entity);
      if (byDist !== 0) return byDist;
      return a.node.key < b.node.key ? -1 : a.node.key > b.node.key ? 1 : 0;
    });

    adjacency[node.key] = candidates
      .slice(0, MAX_EDGES_PER_NODE)
      .map((other) => ({
        from: node.key,
        to: other.node.key,
        distanceKm: distanceKm(entity, other.entity),
        sameType: other.node.type === node.type,
      }));
  }

  return { nodes, adjacency };
}

/**
 * Deterministyczne sciezki multi-hop startujace z danego wezla.
 * Maks. `hops` krawedzi (domyslnie 2 -> A->B->C). Bez cykli, bez nowych wezlow.
 * Kolejnosc wynika z uporzadkowanej listy sasiedztwa (odtwarzalna).
 */
export function multiHopPaths(
  graph: GeoGraph,
  startKey: string,
  hops = 2,
): GeoPath[] {
  const results: GeoPath[] = [];

  const walk = (path: string[], km: number | null) => {
    if (path.length - 1 >= hops) {
      results.push({ nodes: [...path], totalKm: km });
      return;
    }
    const last = path[path.length - 1];
    const edges = graph.adjacency[last] ?? [];
    let extended = false;
    for (const edge of edges) {
      if (path.includes(edge.to)) {
        continue;
      }
      extended = true;
      const nextKm =
        km === null || edge.distanceKm === null ? null : km + edge.distanceKm;
      walk([...path, edge.to], nextKm);
    }
    if (!extended && path.length > 1) {
      results.push({ nodes: [...path], totalKm: km });
    }
  };

  walk([startKey], 0);
  return results;
}
