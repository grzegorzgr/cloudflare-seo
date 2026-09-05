# gdziemy.pl

Parkingi, szlaki rowerowe i piesze oraz plaże w Polsce na danych OpenStreetMap. Statyczny serwis
(Astro SSG) publikowany na Cloudflare Pages. Bez generowanych opisów: każda informacja to zapis w OSM
albo jawnie oznaczone obliczenie.

## Struktura

| Ścieżka | Rola |
| --- | --- |
| `apps/web` | Astro (strony, layout, komponenty). Zero logiki danych – renderuje modele z generatora. |
| `packages/generator/src` | Czyste funkcje TS: modele stron (`place.ts`, `hubs.ts`), reguły jakości (`quality.ts`), słowniki (`labels.ts`), mapy statyczne (`map.ts`), sitemap. |
| `packages/data` | Wygenerowany dataset (`parkings.json`, `trails.json`, `beaches.json`, `trail-geometry.json`, `dataset-meta.json`) + seed miast/województw. |
| `packages/data/curated` | Ręcznie utrzymywane wpisy (źródło, nie wynik). |
| `scripts/build/fetch-osm.mjs` | Jedyny skrypt sieciowy: Overpass API → cache per województwo. |
| `scripts/build/geo-engine.mjs` | Deterministyczna budowa datasetu z cache + curated (normalizacja, geometria szlaków, relacje przestrzenne). |
| `scripts/quality/analyze.mjs` | Analiza wygenerowanego HTML: punktacja stron, kontrole SEO, graf linków → `docs/agent/QUALITY_SCORE.md`. |
| `tests/` | `node:test` – generator + inwarianty datasetu. |
| `docs/agent/` | Audyt, decyzje, roadmapa, dziennik iteracji, raport audytora. |

## Komendy (Node ≥ 22.12)

```bash
npm install
npm run data:seed     # packages/data/cities.json + regions.json (huby)
npm run data:fetch    # Overpass -> scripts/build/cache/osm (cache-first; --refresh wymusza)
npm run data:build    # cache + curated -> packages/data/*.json
npm test
npm run build         # apps/web/dist
npm run quality       # test + build + analiza jakości (próg 90/100, 0 krytycznych)
```

Sam `npm run build` działa offline na danych z repo. Fetch jest potrzebny tylko do odświeżenia danych
(CI robi to co tydzień).

## Zasady

1. Brak danej w OSM = puste pole, nie domysł.
2. Obliczenia (odległość, długość, czas) są oznaczone i opisane w `/metodologia/`.
3. Strona trafia do indeksu tylko, gdy spełnia progi z `packages/generator/src/quality.ts`.
4. Każda strona obiektu pokazuje id OSM, datę edycji i link do poprawy danych.
