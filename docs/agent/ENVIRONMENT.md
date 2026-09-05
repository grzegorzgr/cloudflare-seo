# ENVIRONMENT

Stan srodowiska wykonawczego uzywanego przez agenta (zweryfikowany 2026-09-05).

## Repozytorium

| Klucz | Wartosc |
| --- | --- |
| Sciezka (WSL) | `/mnt/c/Projects/cloudflare-seo` |
| Sciezka (Windows) | `C:\Projects\cloudflare-seo` |
| Uwaga | Brief podawal `/mnt/c/Projects/coudflare-seo` (literowka). Repo lezy celowo na systemie plikow Windows; nie przenosimy go, nie klonujemy kopii, nie tworzymy worktree. |
| Branch | `master` (remote `origin` = github.com:grzegorzgr/cloudflare-seo) |

## System

| Klucz | Wartosc |
| --- | --- |
| Host | Windows 11 Home 10.0.26200 |
| WSL | WSL2, kernel `6.18.33.2-microsoft-standard-WSL2` |
| Dystrybucja | **Ubuntu 20.04.3 LTS (Focal)** — brief zakladal 22.04; realnie zainstalowana jest 20.04. Wszystkie polecenia i tak wykonujemy wylacznie w tym WSL. |
| sudo | dziala bez hasla (`sudo -n true` OK) |
| Python | 3.8.10 (`/usr/bin/python3`) |
| curl / wget | dostepne |

## Node.js

| Klucz | Wartosc |
| --- | --- |
| Systemowy node | `/usr/bin/node` v14.21.3 — **za stary** (projekt wymaga `>=22.12.0`) |
| nvm | `~/.nvm` z wersjami 20.20.2 i **22.23.1** |
| Uzywana wersja | **Node 22.23.1 / npm 10.9.8** (`nvm alias default 22` ustawiony przez agenta) |
| Aktywacja w skryptach nieinteraktywnych | `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22` |

Wszystkie polecenia (git, node, npm, npx, python, curl, build Astro, testy, skrypty jakosci)
uruchamiane sa w WSL. Zadnych narzedzi Windows-native (PowerShell, cmd, node.exe, npm.exe,
git.exe, wrangler.exe) nie uzywano do pracy nad projektem.

## Projekt

| Klucz | Wartosc |
| --- | --- |
| Framework | Astro 7.0.6, `output: static`, `trailingSlash: always` |
| Monorepo | npm workspaces: `apps/web` (strona), `packages/generator` (czyste funkcje TS), `packages/data` (JSON) |
| Dane | `packages/data/{beaches,parkings,trails,cities,regions}.json` |
| Pipeline danych | `scripts/build/seed-cities.mjs` -> `scripts/build/geo-engine.mjs` (Overpass API, cache w `scripts/build/cache/osm/`) |
| Hosting | Cloudflare Pages, `pages_build_output_dir = apps/web/dist` (`wrangler.toml`) |
| CI | `.github/workflows/deploy.yml` (build na push), `.github/workflows/seo-cron.yml` (codzienny `npm run geo:ci` + commit danych) |

## Siec

Overpass API (`https://overpass-api.de/api/interpreter`) jest osiagalne z WSL (status 200,
2 sloty). Zapytania `area[...]` po nazwie wojewodztwa bywaja odrzucane bledem dispatcher-a;
zapytania `around` wokol miast-hubow dzialaja stabilnie.

Czas pelnego pobrania (16 wojewodztw, 38 hubow, filtr `(area.pl)`): zapytania POI 90–230 s
kazde (rate-limit i retry wliczone), zapytania relacji tras 3–25 s; lacznie ok. 60–80 min.
W trakcie prac deweloperskich uzywac czesciowego cache (engine toleruje brakujace wojewodztwa)
albo `--regions=pomorskie,opolskie`.

## Procesy w tle

Dlugie zadania (fetch, build) uruchamiac jako proces w tle narzedzia (wsl.exe w pierwszym
planie tego procesu). `nohup … &` wewnatrz `wsl.exe -e bash -c` ginie razem z sesja wsl.exe.
Podglad zbudowanej strony: `python3 -m http.server 8123 --bind 127.0.0.1` w `apps/web/dist`
(dostepny z Windows przez localhost).
