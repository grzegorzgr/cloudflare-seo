// Tlumaczenia wartosci tagow OSM na czytelny polski oraz formatery liczb.
// Zasada: tlumaczymy TYLKO znane wartosci; nieznane pokazujemy w oryginale
// (uzytkownik widzi prawdziwa wartosc z danych, nie zgadujemy).

const SURFACE: Record<string, string> = {
  asphalt: 'asfalt',
  paving_stones: 'kostka brukowa',
  'paving_stones:30': 'kostka brukowa',
  concrete: 'beton',
  'concrete:plates': 'płyty betonowe',
  'concrete:lanes': 'płyty betonowe (pasy)',
  gravel: 'żwir',
  fine_gravel: 'drobny żwir',
  compacted: 'utwardzona (kruszywo)',
  unpaved: 'nieutwardzona',
  paved: 'utwardzona',
  ground: 'grunt',
  dirt: 'ziemia',
  earth: 'ziemia',
  grass: 'trawa',
  sand: 'piasek',
  sett: 'kostka kamienna',
  cobblestone: 'bruk',
  unhewn_cobblestone: 'bruk (kamień polny)',
  pebblestone: 'otoczaki',
  wood: 'drewno',
  metal: 'metal',
  grass_paver: 'płyty ażurowe',
  mud: 'błoto',
  rock: 'skała',
  shells: 'muszle',
  tartan: 'tartan',
  woodchips: 'zrębki',
};

const PARKING_TYPE: Record<string, string> = {
  surface: 'parking naziemny',
  'multi-storey': 'parking wielopoziomowy',
  underground: 'parking podziemny',
  street_side: 'parking przyuliczny',
  lane: 'pas postojowy na jezdni',
  rooftop: 'parking na dachu',
  garage_boxes: 'garaże (boksy)',
  carports: 'wiaty',
  sheds: 'wiaty',
  layby: 'zatoka postojowa',
};

const ACCESS: Record<string, string> = {
  yes: 'publiczny',
  public: 'publiczny',
  customers: 'dla klientów',
  private: 'prywatny',
  no: 'brak dostępu publicznego',
  permissive: 'dostęp tolerowany przez właściciela',
  permit: 'na przepustkę / zezwolenie',
  destination: 'tylko dla docelowych',
  employees: 'dla pracowników',
  residents: 'dla mieszkańców',
  delivery: 'dla dostaw',
  designated: 'wyznaczony',
};

const ROUTE_TYPE: Record<string, string> = {
  bicycle: 'szlak rowerowy',
  hiking: 'szlak pieszy',
  foot: 'szlak pieszy (spacerowy)',
  mtb: 'trasa MTB',
};

const NETWORK: Record<string, string> = {
  lcn: 'lokalna sieć rowerowa',
  rcn: 'regionalna sieć rowerowa',
  ncn: 'krajowa sieć rowerowa',
  icn: 'międzynarodowa sieć rowerowa',
  lwn: 'lokalny szlak pieszy',
  rwn: 'regionalny szlak pieszy',
  nwn: 'krajowy szlak pieszy',
  iwn: 'międzynarodowy szlak pieszy',
};

const COLOUR: Record<string, string> = {
  red: 'czerwony',
  blue: 'niebieski',
  green: 'zielony',
  yellow: 'żółty',
  black: 'czarny',
  white: 'biały',
  orange: 'pomarańczowy',
  purple: 'fioletowy',
  violet: 'fioletowy',
  brown: 'brązowy',
  grey: 'szary',
  gray: 'szary',
  pink: 'różowy',
};

const OSMC_SHAPE: Record<string, string> = {
  bar: 'pasek poziomy',
  stripe: 'pasek pionowy',
  dot: 'kropka',
  circle: 'okrąg',
  triangle: 'trójkąt',
  triangle_turned: 'trójkąt odwrócony',
  cross: 'krzyż',
  x: 'krzyżyk',
  diamond: 'romb',
  rectangle: 'prostokąt',
  arch: 'łuk',
  corner: 'narożnik',
  pointer: 'strzałka',
  shell: 'muszla',
  shell_modern: 'muszla',
  turned_T: 'odwrócone T',
  L: 'litera L',
  crest: 'herb',
  backslash: 'ukośnik',
  slash: 'ukośnik',
  wheel: 'koło',
};

const PAYMENT: Record<string, string> = {
  cash: 'gotówka',
  coins: 'monety',
  cards: 'karta płatnicza',
  contactless: 'płatność zbliżeniowa',
  app: 'aplikacja mobilna',
  sms: 'SMS',
};

const WHEELCHAIR: Record<string, string> = {
  yes: 'tak',
  limited: 'ograniczony',
  no: 'nie',
  designated: 'wyznaczone',
};

const DAYS: Record<string, string> = {
  Mo: 'pon.',
  Tu: 'wt.',
  We: 'śr.',
  Th: 'czw.',
  Fr: 'pt.',
  Sa: 'sob.',
  Su: 'niedz.',
  PH: 'święta',
  SH: 'wakacje szkolne',
};

const SAC_SCALE: Record<string, string> = {
  hiking: 'łatwy (turystyka piesza)',
  mountain_hiking: 'górski',
  demanding_mountain_hiking: 'wymagający górski',
  alpine_hiking: 'alpejski',
  demanding_alpine_hiking: 'wymagający alpejski',
  difficult_alpine_hiking: 'trudny alpejski',
};

const MTB_SCALE: Record<string, string> = {
  '0': 'S0 – bardzo łatwa',
  '1': 'S1 – łatwa',
  '2': 'S2 – średnia',
  '3': 'S3 – trudna',
  '4': 'S4 – bardzo trudna',
  '5': 'S5 – ekstremalna',
};

const yesNo = (v: string): string | null => (v === 'yes' ? 'tak' : v === 'no' ? 'nie' : null);

export const labels = {
  surface: (v: string) => SURFACE[v] ?? v,
  parkingType: (v: string) => PARKING_TYPE[v] ?? `parking (${v})`,
  access: (v: string) => ACCESS[v] ?? v,
  routeType: (v: string) => ROUTE_TYPE[v] ?? v,
  network: (v: string) => NETWORK[v] ?? v,
  colour: (v: string) => COLOUR[v.toLowerCase()] ?? v,
  payment: (v: string) => PAYMENT[v] ?? v,
  wheelchair: (v: string) => WHEELCHAIR[v] ?? v,
  sacScale: (v: string) => SAC_SCALE[v] ?? v,
  mtbScale: (v: string) => MTB_SCALE[v] ?? v,
  yesNo,
  /** yes/no albo oryginal (np. "train", "bus;tram" dla park_ride). */
  yesNoOr: (v: string) => yesNo(v) ?? v,
};

/** Czy wartosc oznacza dostep publiczny (do list "gdzie zaparkowac"). */
export function isPublicAccess(access: string | undefined): boolean {
  if (!access) return true; // brak tagu = brak informacji o ograniczeniu
  return ['yes', 'public', 'permissive', 'customers', 'destination'].includes(access);
}
export function isRestrictedAccess(access: string | undefined): boolean {
  if (!access) return false;
  return ['private', 'no', 'permit', 'employees', 'residents', 'delivery'].includes(access);
}

/** "2 minutes" -> "2 min", "2 days" -> "2 dni", "no" -> "bez limitu". */
export function formatMaxstay(v: string): string {
  const t = v.trim();
  if (t === 'no' || t === 'unlimited') return 'bez limitu';
  const m = /^(\d+(?:[.,]\d+)?)\s*(minutes?|min|hours?|h|days?|weeks?)$/i.exec(t);
  if (!m) return t;
  const n = m[1].replace('.', ',');
  const unit = m[2].toLowerCase();
  if (unit.startsWith('min')) return `${n} min`;
  if (unit.startsWith('h')) return `${n} godz.`;
  if (unit.startsWith('day')) return `${n} ${plural(Number(m[1]), 'dzień', 'dni', 'dni')}`;
  if (unit.startsWith('week')) return `${n} tyg.`;
  return t;
}

/** "2.2" / "2.3 m" / "3.50" -> "2,2 m". */
export function formatMaxheight(v: string): string {
  const m = /^(\d+(?:[.,]\d+)?)\s*(m)?$/i.exec(v.trim());
  if (!m) return v;
  const n = Number(m[1].replace(',', '.'));
  return `${n.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} m`;
}

/** Lekkie tlumaczenie opening_hours (24/7, zakresy dni, godziny). Nieznane -> oryginal. */
export function formatOpeningHours(v: string): string {
  const t = v.trim();
  if (t === '24/7') return 'całodobowo';
  return t
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)\b/g, (d) => DAYS[d] ?? d)
    .replace(/(\d{2}:\d{2})-(\d{2}:\d{2})/g, '$1–$2')
    .replace(/(pon\.|wt\.|śr\.|czw\.|pt\.|sob\.|niedz\.)-(pon\.|wt\.|śr\.|czw\.|pt\.|sob\.|niedz\.)/g, '$1–$2')
    .replace(/\boff\b/g, 'nieczynne')
    .replace(/;\s*/g, '; ');
}

/** "yes @ (Mo-Fr 07:00-17:00)" -> "płatny: pon.–pt. 07:00–17:00". */
export function formatFeeConditional(v: string): string {
  const parts = v.split(';').map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const m = /^(yes|no)\s*@\s*\(?([^)]*)\)?$/i.exec(part);
    if (!m) {
      out.push(part);
      continue;
    }
    const head = m[1].toLowerCase() === 'yes' ? 'płatny' : 'bezpłatny';
    let cond = m[2].trim();
    cond = cond
      .replace(/stay\s*<\s*(\d+)\s*(minutes?|hours?)/i, (_s, n, u) => `postój do ${n} ${/^h/i.test(u) ? 'godz.' : 'min'}`)
      .replace(/stay\s*>\s*(\d+)\s*(minutes?|hours?)/i, (_s, n, u) => `postój powyżej ${n} ${/^h/i.test(u) ? 'godz.' : 'min'}`)
      .replace(/stay\s*<=\s*(\d+)\s*(minutes?|hours?)/i, (_s, n, u) => `postój do ${n} ${/^h/i.test(u) ? 'godz.' : 'min'}`);
    cond = formatOpeningHours(cond);
    out.push(`${head}: ${cond}`);
  }
  return out.join('; ');
}

/** Cennik: podmiana jednostek na polskie; URL zostaje URL-em. */
export function formatCharge(v: string): string {
  if (/^https?:\/\//i.test(v)) return v;
  return v
    .replace(/PLN/g, 'zł')
    .replace(/\/\s*hour/gi, '/godz.')
    .replace(/\/\s*h\b/gi, '/godz.')
    .replace(/\/\s*24\s*h/gi, '/24 godz.')
    .replace(/\/\s*day/gi, '/dzień')
    .replace(/\/\s*month/gi, '/mies.')
    .replace(/\/\s*minute/gi, '/min');
}

/** osmc:symbol "red:white:red_bar" -> "czerwony pasek poziomy na białym tle". */
export function formatOsmcSymbol(v: string): string {
  const parts = v.split(':');
  if (parts.length < 3) return v;
  const background = COLOUR[parts[1]] ?? parts[1];
  const fg = parts[2];
  const m = /^([a-z]+)_([a-zA-Z_]+)$/.exec(fg);
  if (!m) return v;
  const colour = COLOUR[m[1]] ?? m[1];
  const shape = OSMC_SHAPE[m[2]] ?? m[2];
  return `${colour} ${shape} na ${background === 'biały' ? 'białym' : background} tle`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  if (abs === 1) return one;
  const m10 = abs % 10;
  const m100 = abs % 100;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km >= 100) return `${Math.round(km).toLocaleString('pl-PL')} km`;
  const v = Math.round(km * 10) / 10;
  return `${v.toLocaleString('pl-PL', { minimumFractionDigits: Number.isInteger(v) ? 0 : 1, maximumFractionDigits: 1 })} km`;
}

export function formatInt(n: number): string {
  return n.toLocaleString('pl-PL');
}

/** Szacunkowy czas przejscia/przejazdu z dlugosci (predkosci srednie, zaokraglenie do 15 min). */
export function estimateDuration(lengthKm: number, route: string): { text: string; speedKmh: number } | null {
  const speed = route === 'bicycle' ? 15 : route === 'mtb' ? 12 : route === 'hiking' || route === 'foot' ? 4 : null;
  if (!speed || !(lengthKm > 0)) return null;
  const minutes = Math.round(((lengthKm / speed) * 60) / 15) * 15;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return { text: `ok. ${m} min`, speedKmh: speed };
  if (h >= 24) {
    const days = Math.round((h / 8) * 10) / 10; // dni marszu po 8 godz.
    return { text: `ok. ${h} godz. (${days.toLocaleString('pl-PL')} dni po 8 godz.)`, speedKmh: speed };
  }
  return { text: m ? `ok. ${h} godz. ${m} min` : `ok. ${h} godz.`, speedKmh: speed };
}

/** Odmiana rzeczownika po liczebniku dla typow encji. */
export const COUNT_FORMS: Record<string, [string, string, string]> = {
  parking: ['parking', 'parkingi', 'parkingów'],
  beach: ['plaża', 'plaże', 'plaż'],
  trail: ['szlak', 'szlaki', 'szlaków'],
  city: ['miasto', 'miasta', 'miast'],
  region: ['województwo', 'województwa', 'województw'],
  place: ['miejsce', 'miejsca', 'miejsc'],
};
export function countOf(n: number, kind: keyof typeof COUNT_FORMS): string {
  const [one, few, many] = COUNT_FORMS[kind];
  return `${formatInt(n)} ${plural(n, one, few, many)}`;
}

/** Miejscownik nazw miast: "w Gdańsku". Tylko regularne koncowki; inaczej "w miejscowości X". */
export function inCity(city: string): string {
  const irregular: Record<string, string> = {
    Kraków: 'w Krakowie',
    Wrocław: 'we Wrocławiu',
    Poznań: 'w Poznaniu',
    Gdańsk: 'w Gdańsku',
    Gdynia: 'w Gdyni',
    Sopot: 'w Sopocie',
    Łódź: 'w Łodzi',
    Lublin: 'w Lublinie',
    Szczecin: 'w Szczecinie',
    Bydgoszcz: 'w Bydgoszczy',
    Toruń: 'w Toruniu',
    Katowice: 'w Katowicach',
    Kielce: 'w Kielcach',
    Rzeszów: 'w Rzeszowie',
    Białystok: 'w Białymstoku',
    Olsztyn: 'w Olsztynie',
    Opole: 'w Opolu',
    Warszawa: 'w Warszawie',
    'Zielona Góra': 'w Zielonej Górze',
    'Gorzów Wielkopolski': 'w Gorzowie Wielkopolskim',
    Koszalin: 'w Koszalinie',
    Kołobrzeg: 'w Kołobrzegu',
    Świnoujście: 'w Świnoujściu',
    Zakopane: 'w Zakopanem',
    Karpacz: 'w Karpaczu',
    'Jelenia Góra': 'w Jeleniej Górze',
    Częstochowa: 'w Częstochowie',
    'Bielsko-Biała': 'w Bielsku-Białej',
    Giżycko: 'w Giżycku',
    Augustów: 'w Augustowie',
    Ustka: 'w Ustce',
    Łeba: 'w Łebie',
    Władysławowo: 'we Władysławowie',
    Hel: 'na Helu',
    Międzyzdroje: 'w Międzyzdrojach',
    Mikołajki: 'w Mikołajkach',
    'Szklarska Poręba': 'w Szklarskiej Porębie',
    'Krynica-Zdrój': 'w Krynicy-Zdroju',
  };
  return irregular[city] ?? `w miejscowości ${city}`;
}
