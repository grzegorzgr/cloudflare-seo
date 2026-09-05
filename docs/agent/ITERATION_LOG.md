# ITERATION_LOG

Dziennik pętli: build → testy → SEO → jakość → przegląd → poprawki. Data: 2026-09-05. Środowisko: WSL2 Ubuntu 20.04, Node 22.23.1 (nvm).

## Iteracja 0 — stan wyjściowy

- Build: PASS (3 558 stron, 1 min 3 s). Testy: brak. Analizator: brak.
- Przegląd stron live: `/trail/robotnicza-901098920/` = ulica jako „szlak”; `/collection/parking-parking/` = 249 KB lista wszystkich parkingów; strony encji z fillerem i surowymi wartościami OSM.
- Dane: 923 parkingi / 2 318 „szlaki” (2 290 odcinków dróg) / 89 plaż. Overpass osiągalny, liczba relacji tras: 133 w promieniu 25 km od Trójmiasta, 50 wokół Opola.
- Decyzja: przebudowa pipeline + generatora + widoków (DECISIONS D1–D15).

## Iteracja 1 — pipeline v2 i pierwszy build

- `fetch-osm.mjs` (POI z `out meta`, relacje z `out geom`), `geo-engine.mjs` v2 (normalizacja attrs, geometria, relacje grid-hash).
- Pierwsze uruchomienie fetch przez `nohup … &` zginęło razem z sesją wsl.exe → powtórzone jako proces w tle narzędzia.
- Build nowego serwisu na częściowym cache (Dolnośląskie…Podkarpackie, 9 województw): PASS, 1 403 strony, 1 min 48 s.
- Analizator: 89,3/100, 21 krytycznych: 4 sieroty (curated bez huba), 8 grup duplikatów title („Parkuj i Jedź” ×29 we Wrocławiu, „płatny” ×6 w Lublinie), 9 zerwanych linków (`/city/{x}/szlaki/` dla miast bez szlaków w byHub).
- Testy: `node --test tests/` nie akceptuje katalogu w Node 22 → glob `tests/*.test.mjs`.
- Przegląd: czeskie obiekty przy hubach granicznych (Harrachov), kolory hex jako „znaki: #9DC1D9”, 37 % szlaków „fragmentarycznych”.

## Iteracja 2 — poprawki jakości

- Fetch zrestartowany z filtrem `(area.pl)` (Polska) i promieniem tras 15 km.
- Engine: tolerancja luk 120 m + rozróżnienie „fragmentaryczny” vs „z odgałęzieniami”; start/meta dla odgałęzień = dwa najdalsze końce; szlaki tylko ≤ 15 km od huba; każdemu szlakowi przypisany co najmniej jeden hub.
- Generator: `names.ts` (nazwy, kwalifikatory odległość+kierunek), `byHub` dla szlaków wg wszystkich miast na trasie, tabele na stronach miast/województw/indeksów, sekcja „Obiekty poza zasięgiem miast” na województwie, pomijanie kolorów hex, dodatkowe wzorce nazw kodowych.
- Wynik: fragmentacja 312 → 175 (z 824), z odgałęzieniami 39, start/meta 552.
- Build: PASS (1 682 stron, 1 min 4 s). Analizator: **91,9/100, 0 krytycznych, 0 zerwanych linków**.
- Testy: 11/13 → 2 błędy: title 97 znaków dla nazwy kodowej z operatorem i kwalifikatorem; `formatKm(46.2)` = „46 km”. Poprawione (`titleFor`, 1 miejsce po przecinku < 100 km).
- Ostrzeżenia: 171 (głównie title > 75 dla nazw kodowych noindex; home 76, metodologia 84 → skrócone).

## Iteracja 3 — pełne dane (16 województw, 38 hubów)

- Fetch: zapytanie POI dla Pomorskiego (7 hubów + 22 plaże curated, `(area.pl)` w każdej instrukcji) przekraczało
  240 s po stronie serwera. Poprawka: filtr obszaru stosowany raz na zebranym zbiorze (`node.x(area.pl)`),
  huby dzielone na porcje po 3; region zapisywany do cache tylko, gdy wszystkie porcje się powiodły.
  Pełny fetch: 32 zadania, łącznie ok. 75 min (z przerwami na rate-limit).
- Engine: 1 347 surowych POI → 1 296 po dedupe (51 duplikatów node/way scalonych), 1 561 relacji tras;
  25 z 28 wpisów curated dopasowanych do OSM (`curated+osm`).
- Dataset: 1 228 parkingów (publicznie dostępne wg OSM: brak tagu 429, yes 329, customers 227, permissive 23;
  ograniczone: private 148, no 49, permit 14), 1 566 szlaków (1 554 z geometrią; pętle 148; fragmentaryczne 364;
  z odgałęzieniami 83; start/meta 989; rowerowe 557, MTB 107, piesze 821, spacerowe 81), 109 plaż.
- Testy: 13/13 PASS. Build: PASS, 3 072 strony w 1 min 41 s.
- Analizator: **93,0/100**, 2 207 stron indeksowalnych (865 noindex), 2 207 URL w sitemapie, **0 kontroli
  krytycznych, 0 zerwanych linków, 0 sierot**, 16 ostrzeżeń (długość title dla nazw kodowych noindex).
  Klastry (średnia stron indeksowalnych): miasto 99,8 · szlak 93,7 · parking 92,6 · home 92 · województwo 90,3 ·
  plaża 88,9 · miasto/typ 88,4 · indeksy 87,4 · statyczne 84,8.
- Najsłabsze strony indeksowalne (63–69): 5 szlaków curated z Pomorza bez dopasowania w OSM (poza zasięgiem hubów:
  Dolina Łupawy, Hutniczy, Jantarowy, Pocztyliona, Tczewski) — brak geometrii i parkingów przy trasie; parking
  Dino Park Malbork (curated, 4 fakty). Werdykt IMPROVE; poprawa wymaga hubów Słupsk/Lębork/Malbork (ROADMAP).
- Przegląd ręczny: strona plaży Jelitkowo (curated) pokazuje 4 parkingi do 1,5 km i 5 szlaków; Szlak Trójmiejski
  (curated+osm) ma długość z geometrii 46,1 km vs 46,2 km wg PTTK, oznakowanie z osmc:symbol, operatora, stronę WWW.
  Poprawiono spójność miasta szlaku (breadcrumb = podtytuł) i title szlaków (zawsze z typem).

## Iteracja 4 — warstwa wizualna (na życzenie właściciela)

- Tokeny kolorów per kategoria (`data-theme` na `<body>`: parking niebieski, szlak śliwkowy, plaża morski) sterują
  akcentem nagłówka, znacznikami mapy, kafelkami statystyk i chipami; tryb ciemny przez `prefers-color-scheme`.
- Hero na stronie głównej (3 kafelki z ikonami SVG i licznikami), kafelki statystyk, chipy w tabelach
  (płatny/bezpłatny, dostęp, typ trasy, pętla, całodobowo), ikony liniowe przy faktach (`Icon.astro`, inline SVG),
  karty w listach linków, sticky nagłówek na desktopie, przebudowana stopka.
- Zero JavaScriptu; CSS wyniesiony przez Astro do jednego pliku 10 KB (`/_astro/*.css`, cache `immutable`).
- Build: PASS (3 072 strony, 2 min 12 s). Analizator: 93,0/100, 0 krytycznych (bez zmian – markup mierzony
  przez analizator zachowany). Przegląd w przeglądarce: desktop jasny/ciemny, mobile 375 px bez przewijania poziomego.

## Stan końcowy

| Kontrola | Wynik |
| --- | --- |
| Build | PASS (3 072 strony) |
| Testy | PASS (13/13) |
| SEO QA (kontrole krytyczne analizatora) | PASS (0) |
| Page Quality QA | PASS (93,0 / 100 ≥ 90) |
| Audytor | PASS z 2 uwagami do decyzji właściciela (tożsamość wydawcy, CMP dla reklam) |
