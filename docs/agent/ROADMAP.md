# ROADMAP

Stan: po przebudowie 2026-09-05. Kolejność wg wpływu na użyteczność produktu.

## Zrobione (2026-09-05)

- [x] Pipeline danych v2: fetch (Overpass, meta, geometria) oddzielony od budowy datasetu; filtr Polski; cache per województwo.
- [x] Szlaki jako relacje tras OSM z długością, czasem, pętlą, start/meta, mapą przebiegu, parkingami przy trasie, szlakami łączącymi się.
- [x] Parkingi: 25 atrybutów OSM tłumaczonych na polski, porównanie z parkingami w promieniu 2 km, kwalifikatory nazw.
- [x] Plaże: parkingi do 1,5 km, ratownicy, psy, opłaty.
- [x] Strony miast z tabelami i filtrami; województwa; indeksy kategorii; nowa strona główna.
- [x] Provenance per obiekt; metodologia; regulamin; źródła danych z datami per województwo.
- [x] Reguły indeksowania w kodzie + sitemap z lastmod z danych + analizator jakości + testy + bramka w CI.
- [x] Usunięcie kolekcji, martwego kodu i śmieci z repo; `_headers`, `_redirects`; tygodniowy cron.

## Następne (wysoki wpływ)

1. **Tożsamość wydawcy (E-E-A-T, prawo PL).** Podać na `/o-nas/` i `/regulamin/` nazwę podmiotu prowadzącego serwis
   i dane kontaktowe wymagane dla usług świadczonych drogą elektroniczną. Wymaga decyzji właściciela – nie da się tego
   wygenerować z danych.
2. **Rozszerzenie hubów.** `CITY_TABLE` zawiera ~150 miast; obecnie 38 hubów. Dodawać po 10–15 miast na iterację
   (koszt: 2 zapytania Overpass na województwo, ~4 min każde). Priorytet: Trójmiasto już jest; kolejne to Lublin/Rzeszów
   już są; brakuje np. Elbląga, Płocka, Radomia, Tarnowa, Kalisza, Legnicy.
3. **Nienazwane parkingi w tabelach miast.** OSM ma dziesiątki tysięcy parkingów bez nazwy z `capacity`/`fee`.
   Nie zasługują na osobne strony, ale mogłyby zasilić tabelę miasta jako „parking bez nazwy przy ul. X” (wymaga
   `addr:street` albo reverse-geocodingu – ten drugi wykluczony przez zasadę zero zgadywania).
4. **Profil wysokościowy szlaków.** Wymaga danych DEM (np. Copernicus GLO-30, licencja otwarta). Realny „elevation”
   zamiast tagów `ascent` (rzadkie). Etap build-time, bez JS.
5. **Odległość dojazdu zamiast linii prostej.** Routing (OSRM/Valhalla self-hosted) dla „parking → plaża” i „parking →
   start szlaku”. Duża wartość, duży koszt infrastrukturalny; na razie linia prosta jest jawnie oznaczona.
6. **Strefy płatnego parkowania (SPP).** OSM ma relacje `boundary=parking_zone`/`parking:zone`; strona miasta mogłaby
   pokazać, czy parking leży w strefie i jakie są stawki (jeśli w OSM). Sprawdzić pokrycie danych.

## Następne (średni wpływ)

7. Obraz OG per typ (statyczny PNG generowany w `gen-assets.mjs`), zamiast jednego wspólnego.
8. Wyszukiwarka po nazwie (statyczny indeks JSON + minimalny JS, ładowany tylko po interakcji) – jedyny sensowny JS.
9. Widok „Plaże wg województwa” z mapą regionu i znacznikami wszystkich plaż.
10. Eksport danych (GeoJSON/CSV per miasto) na stronie źródeł – zgodny z ODbL, zwiększa wiarygodność jako „dataset”.
11. Testy wizualne (Playwright, screenshot diff kluczowych szablonów) w CI.

## Utrzymanie

- Monitorować `QUALITY_SCORE.md` po każdym cronie; regresja < 90 lub krytyczne = blokada commitu (już w workflow).
- Raz na kwartał przegląd słowników `labels.ts` (nowe wartości OSM pojawiające się w oryginale).
- Śledzić w Search Console: strony `noindex` z ruchem (kandydaci do poprawy danych w OSM), 404 dawnych `/trail/*`.

## Świadomie odrzucone

- Generowanie opisów (LLM lub szablonowe) – sprzeczne z zasadą produktu.
- Strony dla kombinacji filtrów (bezpłatne × podziemne × miasto) – doorway pages.
- Recenzje/oceny użytkowników – wymagałyby backendu i moderacji; nie w zakresie statycznego serwisu.
