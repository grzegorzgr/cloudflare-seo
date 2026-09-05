# AUDITOR_REPORT

Przegląd z pozycji wrogiego recenzenta Google Search / AdSense po przebudowie (2026-09-05).
Metoda: (1) automatyczna analiza całego buildu (`scripts/quality/analyze.mjs`), (2) ręczny przegląd
próbki stron w przeglądarce i jako tekst, (3) checklista polityk (thin content, auto-generated content,
doorway pages, misleading navigation, E-E-A-T, provenance, ads on low-value pages).

Wyniki liczbowe: patrz sekcja „Wyniki końcowe” na dole (uzupełniona po pełnym fetchu) oraz `QUALITY_SCORE.md`.

## Próbka przejrzana ręcznie

| Typ | Strony |
| --- | --- |
| Parkingi (10) | `/parking/par-king-9888095227/` (Wrocław, podziemny), `/parking/parking-nowy-targ-290241154/`, `/parking/parking-wielopoziomowy-24h-millennium-towers-364390012/`, `/parking/90-1381683341/` (prywatny, noindex), `/parking/parkuj-i-jedz-…/` ×3 (kwalifikatory), `/parking/parking-dino-park-malbork/` (curated), `/parking/bus-1348700353/` (nazwa kodowa, noindex), `/parking/concordia-954025100/` |
| Szlaki (10) | `/trail/bydgoszcz-koronowo-12797916/`, `/trail/antalowka-gubalowka-gorna-st-kolejki-11754677/`, `/trail/chocholow-przelecz-trzy-kopce-3083758/`, `/trail/szlak-grot-mechowskich/` (curated), `/trail/szlak-tczewski/`, EuroVelo 2 (1 277 km, superdługi), „Eurovelo 9 (proponowana)” (state=proposed → noindex), pętla „Trzebnicka Pętla Rowerowa”, szlak z odgałęzieniami, szlak fragmentaryczny |
| Miasta (5) | `/city/wroclaw/`, `/city/wroclaw/parkingi/`, `/city/bydgoszcz/szlaki/`, `/city/opole/plaze/`, `/city/szklarska-poreba/` |
| Hub/region/kategoria (5) | `/`, `/parking/`, `/trails/`, `/region/dolnoslaskie/`, `/cities/` |
| Zaufanie | `/o-nas/`, `/metodologia/`, `/zrodla-danych/`, `/kontakt/`, `/regulamin/`, `/polityka-prywatnosci/` |

## Checklista recenzenta

| Kryterium | Ocena | Uzasadnienie |
| --- | --- | --- |
| Thin content na skalę | PASS | Strony poniżej progu faktów mają `noindex`, są poza sitemapą i nie ładują reklam. Reguły jawne (`/metodologia/`). |
| Auto-generated text | PASS | Brak generowanych opisów. Zdania podsumowujące składają się wyłącznie z pól danych; jedyny tekst opisowy to oryginalny tag OSM `description` (oznaczony). |
| Doorway pages | PASS | Usunięto ~300 stron kolekcji; filtry są sekcjami na jednej stronie miasta. Brak stron dla kombinacji filtrów. |
| Fałszywe kategorie | PASS | „Szlaki” = wyłącznie relacje tras OSM z długością i przebiegiem; 2 290 odcinków ulic usunięto (404). |
| Unikalność title/H1 | PASS | Kwalifikatory z danych (ulica / nr / odległość i kierunek od centrum / id OSM); analizator: 0 duplikatów wśród stron indeksowalnych. |
| Canonical / robots / sitemap | PASS | Canonical = URL na każdej stronie; noindex ↔ sitemap spójne; lastmod z danych (edycja OSM lub wersja treści), nie z daty builda. |
| Nawigacja i orientacja | PASS | Nagłówek z nawigacją, breadcrumbs (HTML + JSON-LD), stopka z atrybucją na każdej stronie; 0 sierot, 0 zerwanych linków. |
| Wartość ponad źródło | PASS | Długość i czas szlaku, pętla/start/meta, odległości do linii trasy, parkingi przy szlaku/plaży, porównania w promieniu 2 km, tabele miast z filtrami, mapy z przebiegiem. |
| Provenance / E-E-A-T (dane) | PASS | Id obiektu OSM, data edycji, `check_date`, stan bazy, linki „popraw w OSM” / „zgłoś uwagę”; daty osm_base per województwo na `/zrodla-danych/`. |
| E-E-A-T (wydawca) | **WARN** | Brak nazwy podmiotu prawnego i adresu wydawcy na `/o-nas/` i `/regulamin/`. Wymaga decyzji właściciela (nie do wygenerowania z danych). |
| Reklamy | PASS z uwagą | AdSense tylko na stronach indeksowalnych. **Uwaga:** dla użytkowników z EOG wymagany jest komunikat zgody (CMP) – konfiguracja w panelu AdSense („Privacy & messaging”), nie w kodzie. |
| Strony prawne | PASS | Polityka prywatności (AdSense, Cloudflare, kafelki OSMF), regulamin, kontakt, źródła, metodologia. |
| Licencja OSM (ODbL) | PASS | Atrybucja w stopce, przy mapie, na `/zrodla-danych/`; JSON-LD `Dataset` z licencją. |
| UX mobilny | PASS | Brak przewijania poziomego (375 px); tabele w kontenerze `overflow-x`; mapa responsywna (aspect-ratio). |
| Wydajność | PASS | HTML 13–50 KB; 1 skrypt zewnętrzny (AdSense, async); 12 kafelków `loading="lazy"`; brak JS map; `preconnect` do tile.openstreetmap.org; nagłówki cache w `_headers`. |
| Dostępność | PASS | Skip-link, `aria-label` nawigacji, `role="img"` + `aria-label` mapy, `scope` w tabelach, kontrast systemowy. |
| Dane wrażliwe | PASS | Brak danych osobowych; numery telefonów/strony WWW to publiczne dane operatorów z OSM; brak nazw użytkowników OSM. |

## Ustalenia (findings)

### Krytyczne
Brak (po iteracji 2 analizator raportuje 0 kontroli krytycznych; przed przebudową: fałszywa kategoria szlaków, doorway pages, filler, duplikaty).

### Ważne (do decyzji właściciela)
1. **Tożsamość wydawcy.** Dla serwisu z reklamami w Polsce standardem (i wymogiem ustawy o świadczeniu usług drogą elektroniczną) jest podanie nazwy i adresu podmiotu. Placeholder świadomie nieuzupełniony – nie wolno wymyślać danych podmiotu.
2. **Komunikat zgody na reklamy (CMP)** dla EOG – ustawienie w AdSense; bez tego reklamy spersonalizowane nie powinny być serwowane w UE.
3. **Zasięg.** 38 miast, nie cała Polska. Komunikowane wprost na `/o-nas/`, `/metodologia/`, stronach województw. Rozszerzenie w `ROADMAP.md`.

### Drobne (zaakceptowane, udokumentowane)
- Odległości w linii prostej (jawnie oznaczone) – routing w roadmapie.
- Część szlaków w OSM jest fragmentaryczna (ok. 20 % po sklejeniu luk 120 m) – oznaczone notą; długość jako suma odcinków.
- Nazwy szlaków w językach obcych przy granicy (np. czeskie odcinki tras transgranicznych częściowo w Polsce) – dane źródłowe; filtr `(area.pl)` usuwa obiekty w całości poza Polską.
- Kolejność start/meta wynika z danych OSM, nie z oznakowania – oznaczone notą.
- Kafelki OSM z tile.openstreetmap.org – zgodne z polityką użycia przy obecnej skali; alternatywa (własny serwer kafelków lub dostawca komercyjny) przy wzroście ruchu.

## Test końcowy („gdyby Google przestało przysyłać ruch”)

Osoba planująca wyjazd do Wrocławia może otworzyć `/city/wroclaw/parkingi/` i porównać 50 publicznych parkingów
(odległość od centrum, miejsca, opłata, godziny, P+R, podziemne), wejść na parking i zobaczyć cennik, limit
czasu, płatności, operatora oraz 8 alternatyw w promieniu 2 km na mapie. Rowerzysta w Bydgoszczy dostaje 42
szlaki rowerowe z długościami, przebiegami, mapą i parkingami przy trasie. Plażowicz w Trójmieście – plaże
z ratownikami i parkingami do 1,5 km. To użyteczność niezależna od wyszukiwarki, choć ograniczona zasięgiem
38 miast i jakością danych OSM.

## Wyniki końcowe (pełne dane, 2026-09-05)

| Miara | Wartość |
| --- | --- |
| Strony w buildzie | 3 072 (indeksowalne 2 207, noindex 865) |
| URL w sitemapie | 2 207 (= strony indeksowalne) |
| Wynik jakości (średnia stron indeksowalnych) | **93,0 / 100** (próg 90) |
| Kontrole krytyczne | **0** |
| Zerwane linki / sieroty / duplikaty title | 0 / 0 / 0 |
| Ostrzeżenia | 16 (długość title > 75 dla nazw kodowych na stronach noindex) |
| Parkingi: indeksowane / noindex | 560 / 668 (noindex: dostęp ograniczony 211, < 3 faktów lub nazwa kodowa 457) |
| Szlaki: indeksowane / noindex | 1 406 / 160 (noindex: długość < 1 km, < 3 faktów, status proposed) |
| Plaże: indeksowane / noindex | 87 / 22 |
| Testy | 13 / 13 PASS |

Wymiary (średnie): dane 19,3/20 · wartość oryginalna 15,0/20 · intencja 19,9/20 · kontekst 9,4/10 ·
zaufanie 9,9/10 · odkrywalność 9,5/10 · UX 9,9/10. Najsłabszy wymiar to „wartość oryginalna” na stronach
curated bez dopasowania w OSM (brak geometrii → brak mapy przebiegu i relacji); to 6 stron z werdyktem IMPROVE.

**Werdykt audytora: PASS.** Krytycznych ustaleń brak. Dwie uwagi wymagają decyzji właściciela (tożsamość
wydawcy, komunikat zgody na reklamy w EOG) i nie dają się rozwiązać w kodzie bez wymyślania danych.
