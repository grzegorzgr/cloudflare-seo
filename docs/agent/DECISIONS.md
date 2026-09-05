# DECISIONS

Dziennik decyzji architektonicznych i produktowych (2026-09-05). Każda decyzja: kontekst → decyzja → konsekwencje.

## D1. Zachować Astro SSG + monorepo, przepisać warstwę danych i modeli

**Kontekst.** Architektura (Astro `output: static`, `packages/generator` jako czyste funkcje, `packages/data` JSON, Cloudflare Pages) była zdrowa. Problemem była treść: dane wejściowe traktowane jak treść, generowane „kolekcje”, filler tekstowy.
**Decyzja.** Zostawić framework, routing encji (`/parking/{slug}/`, `/trail/{slug}/`, `/beach/{slug}/`) i hosting; przepisać pipeline danych (`geo-engine.mjs` v2), generator (nowe modele `PlaceModel` / `HubModel`) oraz widoki.
**Konsekwencje.** Zero zmian w konfiguracji Cloudflare; adresy encji z OSM są stabilne (slug = nazwa + id OSM).

## D2. „Szlaki” = relacje tras OSM, nie odcinki dróg

**Kontekst.** 2 290 z 2 318 „szlaków” to pojedyncze `highway=path|footway|cycleway` z nazwą (ulice, chodniki, „Wejście nr 21”). Strony bez wartości, częściowo indeksowane.
**Decyzja.** Pobierać wyłącznie `relation[type=route][route=bicycle|hiking|mtb|foot][name]` z geometrią; liczyć długość, wykrywać pętle/końce, upraszczać geometrię do mapy. Stare adresy odcinków dróg zwracają 404 (nie 301 – nie ma odpowiednika).
**Konsekwencje.** Liczba stron szlaków spada, ale każda ma długość, czas, mapę przebiegu i relacje. Strona 404 wyjaśnia usunięcie.

## D3. Kolekcje automatyczne usunięte; filtry jako sekcje jednej strony miasta

**Kontekst.** `/collection/*` generowało setki stron będących duplikatami stron miast/regionów (np. „Parkingi – Parking” = wszystkie parkingi).
**Decyzja.** Usunąć `/collections/` i `/collection/*` (redirect 301 `/collections/` → `/`; reszta 404). Wprowadzić `/city/{miasto}/parkingi/` z tabelą i sekcjami-filtrami (P+R, bezpłatne, 24/7, podziemne, EV), `/city/{miasto}/szlaki/`, `/city/{miasto}/plaze/`.
**Konsekwencje.** Brak stron typu doorway; jedna silna strona na miasto i typ.

## D4. Jawne reguły indeksowania w kodzie (quality.ts) współdzielone z sitemapą i analizatorem

**Decyzja.** Parking: dostęp publiczny + ≥3 fakty + nazwa nie-kodowa (lub adres/operator). Szlak: długość ≥ 1 km + ≥3 fakty. Plaża: ≥1 fakt albo parking do 1,5 km. Miasto: ≥3 obiekty. Strony poniżej progu istnieją (dane), ale mają `noindex`, są poza sitemapą i nie ładują AdSense.
**Konsekwencje.** Indeks wyszukiwarki dostaje tylko strony, które odpowiadają na pytanie użytkownika; reguły są opisane publicznie w `/metodologia/`.

## D5. Surowe wartości OSM w danych, tłumaczenie w generatorze

**Decyzja.** `attrs` przechowują wartości tagów OSM (klucze znormalizowane), a `labels.ts` tłumaczy je słownikiem; nieznane wartości pokazujemy w oryginale.
**Konsekwencje.** Dane pozostają weryfikowalne wobec źródła; łatwo rozszerzać słownik; brak „zgadywania”.

## D6. Provenance na każdej stronie

**Decyzja.** Fetch z `out meta` → `osm.timestamp`, `osm.version`, `check_date`. Każda strona encji pokazuje id obiektu OSM, datę ostatniej edycji, datę weryfikacji, stan bazy, link „popraw w OSM” i „zgłoś uwagę”.
**Konsekwencje.** Użytkownik i recenzent widzą, skąd i z kiedy są dane.

## D7. Mapy statyczne (mozaika kafelków + SVG), bez JavaScriptu

**Decyzja.** 3×2 kafelki OSM (768×512) z pinezką, numerowanymi znacznikami i przebiegiem szlaku jako `<path>`; kafelki `loading="lazy"`.
**Konsekwencje.** Zero JS map, dobre CWV; zależność od tile.openstreetmap.org (użycie w granicach polityki – niski ruch, atrybucja, brak masowego pobierania).

## D8. Rozdzielenie sieci od budowy danych

**Decyzja.** `fetch-osm.mjs` (jedyny skrypt z dostępem do sieci, cache per województwo) i `geo-engine.mjs` (czysta funkcja cache + curated → dataset). Filtr `(area.pl)` ogranicza wyniki do Polski.
**Konsekwencje.** Deterministyczny build offline; testowalność; brak czeskich obiektów przy hubach granicznych.

## D9. Curated jako osobne źródło

**Decyzja.** 22 plaże, 22 parkingi i 28 szlaków utrzymywanych ręcznie przeniesione do `packages/data/curated/*.json`; generowane pliki `packages/data/*.json` są wynikiem, nie źródłem. Dopasowanie do OSM po nazwie i odległości; wynik oznaczany `curated+osm`.

## D10. Promocja miejscowości nadmorskich i turystycznych do hubów

**Decyzja.** Ustka, Łeba, Władysławowo, Hel, Międzyzdroje, Mikołajki, Szklarska Poręba, Krynica-Zdrój jako huby (38 zamiast 30).
**Konsekwencje.** Realne pokrycie przypadku „parking przy plaży” na wybrzeżu; niewielki wzrost liczby zapytań Overpass.

## D11. Cykl aktualizacji: tygodniowy zamiast dziennego

**Kontekst.** Dzienny cron generował commit „daily SEO graph update” bez realnej zmiany i obciążał Overpass.
**Decyzja.** Tygodniowy przebieg (poniedziałek 03:00 UTC) z testami i bramką jakości przed commitem. Data stanu bazy widoczna na stronach.

## D12. Bramka jakości w CI

**Decyzja.** `npm run quality` = testy + build + analiza HTML (`scripts/quality/analyze.mjs`) z twardymi kontrolami SEO (canonical, H1, sitemap↔noindex, sieroty, duplikaty title, zerwane linki) i progiem średniej ≥ 90.

## D13. Usunięte moduły i pliki

`collections.ts`, `clusters.ts`, `navigation.ts`, `crawler.ts`, `dedupe.ts`, `graph.ts`, `keywords.ts` (meta keywords), `cities.ts`, `generator.ts`, `text.ts`; `scripts/crawl/*` (alternatywny, nieużywany pipeline); `templates/`, `db/`, `packages/core` (puste/nieużywane); śmieciowe ścieżki `apps/web/C:Usersyogi/*` omyłkowo dodane do repo.

## D14. Nagłówki bezpieczeństwa i cache przez `_headers`

`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`; `immutable` dla `/_astro/*`.

## D16. Zapytania Overpass: filtr obszaru raz, huby w porcjach

**Kontekst.** Zapytanie POI dla Pomorskiego (7 hubów) z `(area.pl)` w każdej instrukcji `around` przekraczało limit 240 s.
**Decyzja.** Zbierać unię bez filtra, a `(area.pl)` stosować raz na zbiorze (`node.x(area.pl)`); huby dzielić na porcje po 3; cache regionu zapisywać tylko przy komplecie porcji.
**Konsekwencje.** Pełny fetch ~75 min zamiast timeoutów; deterministyczny zbiór (dedupe po type/id między porcjami).

## D17. Deduplikacja POI o tej samej nazwie w tym samym miejscu

**Decyzja.** Obiekty tego samego typu o identycznym slugu nazwy i odległości ≤ 40 m są scalane (wygrywa bogatszy w atrybuty; remis: way przed node); atrybuty uzupełniane fill-only. 51 scaleń w pełnym zbiorze.
**Konsekwencje.** Brak par „ten sam parking jako node i way” w tabelach; historia scaleń w `geo-engine-report.json`.

## D18. Szlaki o statusie proposed/construction/disused nie trafiają do indeksu

**Decyzja.** Tag `state` jest zachowywany, pokazywany jako „Status szlaku” z ostrzeżeniem, a strona otrzymuje `noindex`.
**Konsekwencje.** Trasy nieoznakowane w terenie (np. „Eurovelo 9 (proponowana)”) pozostają w bazie informacyjnie, ale nie udają istniejących szlaków.

## D15. Nazwy zduplikowane w mieście dostają kwalifikator

**Kontekst.** 29 parkingów „Parkuj i Jedź” we Wrocławiu miało identyczny title.
**Decyzja.** Kwalifikator z danych: ulica → ref → „x km na płn.-zach. od centrum” → id OSM. Stosowany w H1, title i linkach.
