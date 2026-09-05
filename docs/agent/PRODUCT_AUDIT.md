# PRODUCT_AUDIT

Audyt stanu wyjściowego gdziemy.pl (kod + dane + strona live), wykonany 2026-09-05 przed przebudową.
Ocena z perspektywy wrogiego recenzenta Google Search / AdSense: „czy ta strona byłaby użyteczna,
gdyby wyszukiwarka nie przysłała ani jednego użytkownika?”.

## Stan wyjściowy w liczbach

| Miara | Wartość |
| --- | --- |
| Strony w buildzie | 3 558 HTML |
| URL w sitemapie | 1 325 |
| Encje | 923 parkingi, 2 318 „szlaki”, 89 plaże |
| „Szlaki” będące relacjami tras OSM | 0 (2 290 to pojedyncze odcinki `highway=path/footway/cycleway`; 28 to ręczna lista) |
| „Szlaki” z realną długością | 30 |
| Parkingi z jakimkolwiek opisem | 35 (3,8 %) |
| Parkingi z adresem | 89 (9,6 %) |
| Strony kolekcji (`/collection/*`) | ~300, wszystkie duplikaty stron miast/regionów/kategorii |
| Miasta z własną stroną | 77 (30 hubów + 47 miejscowości z 1–3 obiektami) |
| Testy automatyczne | brak (`npm test` niezdefiniowany) |
| Kontrola jakości stron | brak |

## Krytyczne problemy (blokujące dla recenzenta)

1. **Fałszywa kategoria „Szlaki”.** 98,8 % stron szlaków to ulice, chodniki i „Wejście nr 21” na plażę
   (`/trail/robotnicza-901098920/`, `/trail/wejscie-40-1083888567/`). Strona pokazywała „Robotnicza – szlak Wrocław”
   z faktem „nawierzchnia: asphalt”. Około 500 z nich trafiało do indeksu (miały ≥ 3 „sygnały”, np. nawierzchnia +
   szerokość + nachylenie). To klasyczny profil auto-generated low value content.
2. **Doorway pages.** Kolekcje typu „Parkingi – Parking” (wszystkie parkingi), „Szlaki w Warszawa” (494 ulic),
   „Parkingi w Pomorskie” — kombinatoryczne listy bez wartości dodanej względem stron miast/regionów.
3. **Tekst wypełniający.** Każda strona encji zaczynała się od „Jeśli szukasz parkingu w lokalizacji Wrocław, ta strona
   zawiera najważniejsze informacje.”, strona główna od „Deterministyczny katalog GEO: 16 regionów…”, brand
   „Katalog miejsc — GEO graf”. Meta description z szablonu.
4. **Dane wyświetlane surowo.** „nawierzchnia: concrete”, „operator: Descont Sp. z o.o.”, kraj „nieznane”,
   `charge: 2-6 PLN/hour`, brak tłumaczenia wartości OSM; brak typu parkingu (`parking=*`), dostępu (`access=*`),
   limitów czasu/wysokości, płatności — choć te tagi były w pobranych danych.
5. **Brak provenance.** Strona nie podawała identyfikatora obiektu OSM, daty edycji ani sposobu poprawy danych
   (jedynie ogólny link do OSM w stopce). Sitemap `lastmod` = data każdego builda (dziennego), co jest sygnałem
   fałszywej świeżości.
6. **Brak nawigacji.** Strony encji nie miały nagłówka z nawigacją ani breadcrumbs; jedynie stopka.
7. **Mapa 256×256 px** z jednym kafelkiem – mało użyteczna; brak mapy przebiegu szlaku.

## Problemy poważne

- Dziesiątki parkingów o identycznej nazwie w mieście („Parkuj i Jedź” ×29 we Wrocławiu) → identyczne title/H1.
- Nazwy kodowe („P8”, „TIR”, „Bus”, „sektor I1”, „płatny”) jako tytuły stron.
- Parkingi prywatne/pracownicze indeksowane jak publiczne.
- Strony miast to długie listy linków bez danych porównawczych; 47 stron miejscowości z 1–3 obiektami.
- Codzienny cron commitował „daily SEO graph update” bez zmian merytorycznych; pełny fetch Overpass co 24 h.
- W repo śmieciowe ścieżki `apps/web/C:Usersyogi/.nvm/alias/*`; martwy alternatywny pipeline `scripts/crawl/*`;
  puste `db/`, `templates/`, `packages/core`.
- Brak nagłówków bezpieczeństwa (`_headers`), brak strony metodologii i regulaminu.

## Co było dobre (zachowane)

- Astro SSG, czyste funkcje generatora, rozdział danych i widoku, Cloudflare Pages, `trailingSlash: 'always'`,
  canonical/robots/404, `ads.txt`, `security.txt`, atrybucja ODbL w stopce.
- Zasada „zero zgadywania” w kodzie pipeline (choć nie w treści).
- Dobra decyzja o usunięciu syntetycznych FAQ (commit 66f7ed3).
- Cache Overpass per województwo.

## Ocena wg wymiarów (stan wyjściowy, strony indeksowalne, szacunek recenzenta)

| Wymiar | Waga | Ocena | Komentarz |
| --- | --- | --- | --- |
| Wartość danych | 20 | 6 | dane istniały w cache, ale na stronie 2–4 surowe pola |
| Wartość oryginalna | 20 | 3 | „w pobliżu” bez odległości do linii, brak porównań, filler |
| Intencja | 20 | 5 | title/H1 poprawne dla parkingów; „szlaki” = ulice |
| Kontekst | 10 | 4 | linki „podobne miejsca” bez danych |
| Zaufanie | 10 | 3 | brak provenance per obiekt, sztuczny lastmod |
| Odkrywalność | 10 | 5 | sitemap ok, brak nawigacji na encjach |
| UX | 10 | 6 | szybka, ale mapa 256 px, brak nagłówka |
| **Razem** | 100 | **32** | |

## Werdykt wyjściowy

Strona **nie** przetrwałaby ręcznego przeglądu AdSense/Google („low value content”, „auto-generated”).
Gdyby Google przestało przysyłać ruch, nikt nie miałby powodu wejść na gdziemy.pl.

## Klasyfikacja klastrów (stan wyjściowy → decyzja)

| Klaster | Stron | Decyzja |
| --- | --- | --- |
| `/trail/*` odcinki dróg | 2 290 | **REMOVE** (404); zastąpione relacjami tras OSM |
| `/trail/*` lista ręczna | 28 | **IMPROVE** (curated + dopasowanie do OSM) |
| `/collection/*`, `/collections/` | ~300 | **MERGE** → `/city/{miasto}/{typ}/` (filtry jako sekcje); `/collections/` 301 → `/` |
| `/city/*` miejscowości 1–3 obiekty | 47 | **REMOVE** (strony miast tylko dla hubów; obiekty linkowane z województwa) |
| `/city/*` huby | 30 → 38 | **IMPROVE** (tabele, mapa, statystyki) |
| `/parking/*` | 923 | **IMPROVE** + **NOINDEX** dla prywatnych / < 3 faktów / nazw kodowych |
| `/beach/*` | 89 | **IMPROVE** (parkingi przy plaży, ratownicy, psy) |
| `/region/*` | 16 | **IMPROVE** (tabela miast, najdłuższe szlaki, obiekty poza hubami) |
| `/`, `/parking/`, `/trails/`, `/beaches/` | 4 | **IMPROVE** (produktowe wejścia, tabele wg miast) |
| `/o-nas/`, `/kontakt/`, `/zrodla-danych/`, `/polityka-prywatnosci/` | 4 | **IMPROVE** + nowe `/metodologia/`, `/regulamin/` |

Szczegóły wdrożenia: `DECISIONS.md`; wynik po przebudowie: `QUALITY_SCORE.md`, `AUDITOR_REPORT.md`.
