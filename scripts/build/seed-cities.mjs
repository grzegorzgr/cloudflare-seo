#!/usr/bin/env node
// Warstwa DATA (SECONDARY SOURCE): generator City Seed Database dla calej Polski.
//
// ZASADA BEZWZGLEDNA: zero halucynacji.
//   - to sa REALNE miasta Polski (nazwa, wojewodztwo, wspolrzedne centrum),
//     a nie wymyslone encje. Wspolrzedne to publiczne fakty geograficzne.
//   - miasto = anchor node (type:"city"), hub grafu dla fan-out OSM.
//   - brak POI = miasto nadal istnieje jako wezel-hub (0 obiektow, uczciwie).
//
// Wejscie:  curated CITY_TABLE ponizej (16 wojewodztw).
// Wyjscie:  packages/data/cities.json  (schemat /packages/data, deterministyczny)
//           packages/data/regions.json (rejestr 16 wojewodztw = region mapping layer)
//
// Uzycie:
//   node scripts/build/seed-cities.mjs            # zapis do packages/data
//   node scripts/build/seed-cities.mjs --check    # tylko walidacja, bez zapisu

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, '../../packages/data');

// --- Deterministyczny slug (kopia packages/generator/src/slug.ts) ---
const POLISH_CHARS = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n',
  ó: 'o', ś: 's', ź: 'z', ż: 'z',
};
function slugify(input) {
  return String(input)
    .toLowerCase()
    .split('')
    .map((c) => POLISH_CHARS[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// --- Region mapping layer: 16 wojewodztw + stolica (real data) ---
// [ nazwa wyswietlana, stolica, lat stolicy, lng stolicy ]
const VOIVODESHIPS = [
  ['Dolnośląskie', 'Wrocław', 51.1079, 17.0385],
  ['Kujawsko-Pomorskie', 'Bydgoszcz', 53.1235, 18.0084],
  ['Lubelskie', 'Lublin', 51.2465, 22.5684],
  ['Lubuskie', 'Gorzów Wielkopolski', 52.7368, 15.2288],
  ['Łódzkie', 'Łódź', 51.7592, 19.456],
  ['Małopolskie', 'Kraków', 50.0647, 19.945],
  ['Mazowieckie', 'Warszawa', 52.2297, 21.0122],
  ['Opolskie', 'Opole', 50.6751, 17.9213],
  ['Podkarpackie', 'Rzeszów', 50.0413, 21.999],
  ['Podlaskie', 'Białystok', 53.1325, 23.1688],
  ['Pomorskie', 'Gdańsk', 54.352, 18.6466],
  ['Śląskie', 'Katowice', 50.2649, 19.0238],
  ['Świętokrzyskie', 'Kielce', 50.8661, 20.6286],
  ['Warmińsko-Mazurskie', 'Olsztyn', 53.7784, 20.4801],
  ['Wielkopolskie', 'Poznań', 52.4064, 16.9252],
  ['Zachodniopomorskie', 'Szczecin', 53.4285, 14.5528],
];

// --- City Seed Database: realne miasta Polski (nazwa, lat, lng, hub?) ---
// hub=true -> wezel o wyzszej wadze SEO (stolica regionu / silny osrodek
// turystyczny). Miasta wybrane: stolice wojewodztw + osrodki > ~20k oraz
// kluczowe miejscowosci turystyczne (wybrzeze, gory, pojezierza).
const CITY_TABLE = {
  'Dolnośląskie': [
    ['Wrocław', 51.1079, 17.0385, true],
    ['Wałbrzych', 50.771, 16.2843],
    ['Legnica', 51.207, 16.1619],
    ['Jelenia Góra', 50.9044, 15.7197, true],
    ['Lubin', 51.4009, 16.201],
    ['Głogów', 51.664, 16.0846],
    ['Świdnica', 50.8449, 16.4877],
    ['Bolesławiec', 51.261, 15.5699],
    ['Oleśnica', 51.213, 17.38],
    ['Dzierżoniów', 50.7276, 16.6516],
    ['Kłodzko', 50.4347, 16.6619],
    ['Karpacz', 50.7783, 15.75, true],
    ['Szklarska Poręba', 50.8283, 15.5205],
  ],
  'Kujawsko-Pomorskie': [
    ['Bydgoszcz', 53.1235, 18.0084, true],
    ['Toruń', 53.0138, 18.5984, true],
    ['Włocławek', 52.6483, 19.0678],
    ['Grudziądz', 53.4837, 18.7536],
    ['Inowrocław', 52.7982, 18.261],
    ['Brodnica', 53.262, 19.396],
    ['Świecie', 53.4093, 18.4468],
    ['Chełmno', 53.348, 18.4247],
  ],
  'Lubelskie': [
    ['Lublin', 51.2465, 22.5684, true],
    ['Zamość', 50.7231, 23.2519],
    ['Chełm', 51.1431, 23.4716],
    ['Biała Podlaska', 52.0325, 23.1165],
    ['Puławy', 51.4166, 21.969],
    ['Świdnik', 51.2197, 22.696],
    ['Kraśnik', 50.9241, 22.2205],
    ['Łuków', 51.9295, 22.3792],
  ],
  'Lubuskie': [
    ['Gorzów Wielkopolski', 52.7368, 15.2288, true],
    ['Zielona Góra', 51.9356, 15.5062, true],
    ['Nowa Sól', 51.8033, 15.718],
    ['Żary', 51.642, 15.138],
    ['Żagań', 51.6167, 15.3167],
    ['Świebodzin', 52.2472, 15.5333],
  ],
  'Łódzkie': [
    ['Łódź', 51.7592, 19.456, true],
    ['Piotrków Trybunalski', 51.4055, 19.703],
    ['Pabianice', 51.6647, 19.3546],
    ['Tomaszów Mazowiecki', 51.53, 20.008],
    ['Bełchatów', 51.3688, 19.3564],
    ['Zgierz', 51.856, 19.406],
    ['Kutno', 52.2308, 19.3644],
    ['Radomsko', 51.0678, 19.4448],
    ['Sieradz', 51.5959, 18.7303],
  ],
  'Małopolskie': [
    ['Kraków', 50.0647, 19.945, true],
    ['Tarnów', 50.0121, 20.9858],
    ['Nowy Sącz', 49.6217, 20.6969],
    ['Oświęcim', 50.0344, 19.2098],
    ['Chrzanów', 50.135, 19.402],
    ['Nowy Targ', 49.477, 20.03],
    ['Zakopane', 49.2992, 19.9496, true],
    ['Wieliczka', 49.9871, 20.0649],
    ['Bochnia', 49.9691, 20.4304],
    ['Krynica-Zdrój', 49.4218, 20.9576],
  ],
  'Mazowieckie': [
    ['Warszawa', 52.2297, 21.0122, true],
    ['Radom', 51.4027, 21.1471],
    ['Płock', 52.5468, 19.7064],
    ['Siedlce', 52.1676, 22.2902],
    ['Pruszków', 52.1706, 20.811],
    ['Ostrołęka', 53.0857, 21.576],
    ['Ciechanów', 52.8813, 20.6194],
    ['Legionowo', 52.4, 20.933],
    ['Otwock', 52.1057, 21.2615],
    ['Wołomin', 52.3413, 21.2419],
    ['Żyrardów', 52.0489, 20.4459],
  ],
  'Opolskie': [
    ['Opole', 50.6751, 17.9213, true],
    ['Kędzierzyn-Koźle', 50.349, 18.226],
    ['Nysa', 50.474, 17.333],
    ['Brzeg', 50.86, 17.467],
    ['Kluczbork', 50.973, 18.217],
    ['Prudnik', 50.3216, 17.5798],
  ],
  'Podkarpackie': [
    ['Rzeszów', 50.0413, 21.999, true],
    ['Przemyśl', 49.7838, 22.7677],
    ['Stalowa Wola', 50.582, 22.053],
    ['Mielec', 50.287, 21.424],
    ['Tarnobrzeg', 50.573, 21.679],
    ['Krosno', 49.688, 21.77],
    ['Sanok', 49.556, 22.206],
    ['Jarosław', 50.0165, 22.6779],
    ['Dębica', 50.0516, 21.4114],
  ],
  'Podlaskie': [
    ['Białystok', 53.1325, 23.1688, true],
    ['Suwałki', 54.1, 22.93],
    ['Łomża', 53.178, 22.059],
    ['Augustów', 53.843, 22.979, true],
    ['Bielsk Podlaski', 52.769, 23.187],
    ['Zambrów', 52.9855, 22.245],
    ['Grajewo', 53.6467, 22.4555],
  ],
  'Pomorskie': [
    ['Gdańsk', 54.352, 18.6466, true],
    ['Gdynia', 54.5189, 18.5305, true],
    ['Sopot', 54.4418, 18.5601, true],
    ['Tczew', 54.092, 18.777],
    ['Wejherowo', 54.605, 18.236],
    ['Rumia', 54.5713, 18.388],
    ['Reda', 54.603, 18.348],
    ['Pruszcz Gdański', 54.262, 18.635],
    ['Starogard Gdański', 53.966, 18.53],
    ['Słupsk', 54.4641, 17.0287],
    ['Ustka', 54.5805, 16.8615],
    ['Łeba', 54.759, 17.554],
    ['Władysławowo', 54.791, 18.401],
    ['Hel', 54.608, 18.801],
  ],
  'Śląskie': [
    ['Katowice', 50.2649, 19.0238, true],
    ['Częstochowa', 50.8118, 19.1203, true],
    ['Sosnowiec', 50.2863, 19.104],
    ['Gliwice', 50.2945, 18.6714],
    ['Zabrze', 50.3249, 18.7857],
    ['Bytom', 50.348, 18.932],
    ['Bielsko-Biała', 49.8224, 19.0584, true],
    ['Rybnik', 50.097, 18.541],
    ['Tychy', 50.131, 18.966],
    ['Dąbrowa Górnicza', 50.321, 19.187],
    ['Chorzów', 50.297, 18.954],
    ['Ruda Śląska', 50.256, 18.856],
    ['Cieszyn', 49.75, 18.633],
    ['Wisła', 49.6555, 18.8586],
    ['Ustroń', 49.7183, 18.8117],
  ],
  'Świętokrzyskie': [
    ['Kielce', 50.8661, 20.6286, true],
    ['Ostrowiec Świętokrzyski', 50.929, 21.385],
    ['Starachowice', 51.036, 21.071],
    ['Skarżysko-Kamienna', 51.114, 20.871],
    ['Sandomierz', 50.682, 21.749],
    ['Końskie', 51.1917, 20.4083],
    ['Busko-Zdrój', 50.4707, 20.7186],
  ],
  'Warmińsko-Mazurskie': [
    ['Olsztyn', 53.7784, 20.4801, true],
    ['Elbląg', 54.1522, 19.4088],
    ['Giżycko', 54.038, 21.766, true],
    ['Ełk', 53.828, 22.364],
    ['Mrągowo', 53.864, 21.304],
    ['Mikołajki', 53.802, 21.573],
    ['Ostróda', 53.696, 19.965],
    ['Iława', 53.596, 19.568],
    ['Pisz', 53.627, 21.81],
    ['Kętrzyn', 54.076, 21.376],
    ['Szczytno', 53.5626, 20.9857],
    ['Bartoszyce', 54.2525, 20.8095],
  ],
  'Wielkopolskie': [
    ['Poznań', 52.4064, 16.9252, true],
    ['Kalisz', 51.761, 18.091],
    ['Konin', 52.223, 18.251],
    ['Piła', 53.151, 16.738],
    ['Ostrów Wielkopolski', 51.649, 17.816],
    ['Gniezno', 52.535, 17.582],
    ['Leszno', 51.841, 16.574],
    ['Śrem', 52.0894, 17.0159],
    ['Września', 52.3255, 17.5651],
    ['Krotoszyn', 51.6952, 17.4361],
  ],
  'Zachodniopomorskie': [
    ['Szczecin', 53.4285, 14.5528, true],
    ['Koszalin', 54.1943, 16.1714, true],
    ['Stargard', 53.336, 15.05],
    ['Kołobrzeg', 54.1758, 15.583, true],
    ['Świnoujście', 53.91, 14.247, true],
    ['Szczecinek', 53.708, 16.698],
    ['Police', 53.5522, 14.5719],
    ['Gryfino', 53.2531, 14.4881],
    ['Międzyzdroje', 53.9276, 14.4499],
  ],
};

function buildCity(name, region, lat, lng, hub) {
  const slug = slugify(name);
  return {
    id: slug,
    slug,
    type: 'city',
    name,
    location: { city: name, region, country: 'Polska' },
    coordinates: { lat, lng },
    features: [],
    amenities: {
      parking: null,
      toilets: null,
      dog_friendly: null,
      accessibility: null,
      paid_entry: null,
    },
    tags: hub ? ['city-hub', 'hub'] : ['city-hub'],
    access: null,
    seo: null,
  };
}

function numFlag(argv, name) {
  const pref = `${name}=`;
  const hit = argv.find((a) => a.startsWith(pref));
  if (!hit) return NaN;
  const n = Number(hit.slice(pref.length));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : NaN;
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const hubsOnly = argv.includes('--hubs-only');
  const maxPerRegion = numFlag(argv, '--max-per-region'); // np. 5 miast/wojewodztwo
  const limit = numFlag(argv, '--limit'); // globalny cap na liczbe miast

  // Deterministyczna kolejnosc: regiony wg VOIVODESHIPS, miasta wg tabeli.
  const regionOrder = VOIVODESHIPS.map((v) => v[0]);
  const cities = [];
  const slugSeen = new Map();

  for (const region of regionOrder) {
    let rows = CITY_TABLE[region] ?? [];
    // Limity sa deterministyczne: kolejnosc wierszy w CITY_TABLE jest stala,
    // stolica/hub sa na poczatku listy wiec przycinamy "od gory".
    if (hubsOnly) rows = rows.filter((r) => r[3] === true);
    if (Number.isFinite(maxPerRegion)) rows = rows.slice(0, maxPerRegion);
    for (const [name, lat, lng, hub] of rows) {
      if (Number.isFinite(limit) && cities.length >= limit) break;
      const city = buildCity(name, region, lat, lng, hub === true);
      if (slugSeen.has(city.slug)) {
        throw new Error(
          `Duplikat slug "${city.slug}" (${name} / ${region}) ` +
            `koliduje z ${slugSeen.get(city.slug)}`,
        );
      }
      slugSeen.set(city.slug, `${name} / ${region}`);
      cities.push(city);
    }
    if (Number.isFinite(limit) && cities.length >= limit) break;
  }

  // Region mapping layer (16 wojewodztw) z licznikiem miast-seed.
  const regions = VOIVODESHIPS.map(([region, capital, lat, lng]) => ({
    region,
    slug: slugify(region),
    capital,
    coordinates: { lat, lng },
    citySeeds: cities.filter((c) => c.location.region === region).length,
  }));

  const stats = {
    voivodeships: regions.length,
    cities: cities.length,
    hubs: cities.filter((c) => c.tags.includes('hub')).length,
    perRegion: Object.fromEntries(regions.map((r) => [r.region, r.citySeeds])),
  };

  if (check) {
    process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
    process.stderr.write('[--check] Walidacja OK, bez zapisu.\n');
    return;
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(
    resolve(DATA_DIR, 'cities.json'),
    JSON.stringify(cities, null, 2) + '\n',
    'utf8',
  );
  writeFileSync(
    resolve(DATA_DIR, 'regions.json'),
    JSON.stringify(regions, null, 2) + '\n',
    'utf8',
  );

  process.stderr.write(
    `City Seed Database: ${cities.length} miast, ${regions.length} wojewodztw, ` +
      `${stats.hubs} hubow -> packages/data/cities.json + regions.json\n`,
  );
  if (hubsOnly || Number.isFinite(maxPerRegion) || Number.isFinite(limit)) {
    process.stderr.write(
      `  limity: ${hubsOnly ? 'hubs-only ' : ''}` +
        `${Number.isFinite(maxPerRegion) ? `max/region=${maxPerRegion} ` : ''}` +
        `${Number.isFinite(limit) ? `limit=${limit}` : ''}\n`,
    );
  }
}

main();
