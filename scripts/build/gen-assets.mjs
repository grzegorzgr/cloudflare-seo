#!/usr/bin/env node
// Generator statycznych assetow marki (favicon + og-image) bez zaleznosci.
// Rysuje pinezke mapy (brand #0b57d0) per-pixel i koduje PNG przez node:zlib.
// Deterministyczny: ten sam skrypt zawsze daje identyczne pliki.
//
// Wyjscie (apps/web/public/):
//   favicon.svg           wektorowy (nowoczesne przegladarki)
//   favicon.ico           32x32 (PNG-in-ICO, fallback)
//   apple-touch-icon.png  180x180
//   og-default.png        1200x630 (Open Graph / Twitter Card)
//
// Uzycie: node scripts/build/gen-assets.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/web/public');

// Brand: kolor linkow z BaseLayout (--link) + ciemniejszy wariant na gradient.
const BRAND = [11, 87, 208];
const BRAND_DARK = [8, 59, 143];
const WHITE = [255, 255, 255];

// --- PNG encoder (RGBA, bit depth 8, color type 6) -------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
// ICO z osadzonym PNG (obslugiwane przez wszystkie wspolczesne przegladarki).
function encodeIco(png, size) {
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(1, 2); // typ: icon
  header.writeUInt16LE(1, 4); // liczba obrazow
  header[6] = size === 256 ? 0 : size;
  header[7] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, 10);  // planes
  header.writeUInt16LE(32, 12); // bpp
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // offset danych
  return Buffer.concat([header, png]);
}

// --- Geometria pinezki (per-pixel, supersampling 3x3) -----------------------
function inCircle(x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
function inRoundedRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const cx = Math.max(r, Math.min(x, w - r));
  const cy = Math.max(r, Math.min(y, h - r));
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}
// Pokrycie pinezki: sylwetka (kolo + trojkat) minus otwor. Zwraca 0..1.
function pinCoverage(x, y, cx, headY, r, tipY) {
  const baseY = headY + r * 0.55;
  const halfW = r * 0.74;
  const silhouette =
    inCircle(x, y, cx, headY, r) ||
    inTriangle(x, y, cx - halfW, baseY, cx + halfW, baseY, cx, tipY);
  if (!silhouette) return 0;
  return inCircle(x, y, cx, headY, r * 0.42) ? -1 : 1; // -1 = otwor
}
function blend(dst, src, alpha) {
  return [
    Math.round(dst[0] + (src[0] - dst[0]) * alpha),
    Math.round(dst[1] + (src[1] - dst[1]) * alpha),
    Math.round(dst[2] + (src[2] - dst[2]) * alpha),
  ];
}
// Probkowanie 3x3 dla wygladzenia krawedzi ksztaltu shapeFn(x,y) -> -1|0|1.
function sample(shapeFn, x, y) {
  let hit = 0, hole = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const v = shapeFn(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3);
      if (v > 0) hit++;
      else if (v < 0) hole++;
    }
  }
  return { fill: hit / 9, hole: hole / 9 };
}

// --- Ikona: niebieski zaokraglony kwadrat + biala pinezka -------------------
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cornerR = size * 0.22;
  const cx = size / 2, headY = size * 0.4, r = size * 0.25, tipY = size * 0.86;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bg = sample(
        (px, py) => (inRoundedRect(px, py, size, size, cornerR) ? 1 : 0),
        x, y,
      );
      const pin = sample((px, py) => pinCoverage(px, py, cx, headY, r, tipY), x, y);
      let color = BRAND;
      let alpha = bg.fill;
      if (pin.fill > 0) color = blend(BRAND, WHITE, pin.fill);
      if (pin.hole > 0) color = blend(color, BRAND, pin.hole);
      const i = (y * size + x) * 4;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

// --- OG image: gradient + pinezka + napis "GDZIEMY.PL" (font bitmapowy 5x7) -
const FONT = {
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  '.': ['.....', '.....', '.....', '.....', '.....', '..##.', '..##.'],
};
function drawOg(width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  const text = 'GDZIEMY.PL';
  const scale = 16;
  const glyphW = 6 * scale; // 5 kolumn + 1 odstepu
  const textW = text.length * glyphW - scale;
  const textX = Math.round((width - textW) / 2);
  const textY = 400;
  const cx = width / 2, headY = 190, r = 78, tipY = 330;

  for (let y = 0; y < height; y++) {
    const t = y / height;
    const bgRow = blend(BRAND, BRAND_DARK, t);
    for (let x = 0; x < width; x++) {
      let color = bgRow;

      const pin = sample((px, py) => pinCoverage(px, py, cx, headY, r, tipY), x, y);
      if (pin.fill > 0) color = blend(color, WHITE, pin.fill);
      if (pin.hole > 0) color = blend(color, bgRow, pin.hole);

      if (y >= textY && y < textY + 7 * scale && x >= textX && x < textX + textW) {
        const col = Math.floor((x - textX) / scale);
        const row = Math.floor((y - textY) / scale);
        const glyph = FONT[text[Math.floor(col / 6)]];
        const gx = col % 6;
        if (glyph && gx < 5 && glyph[row][gx] === '#') color = WHITE;
      }

      const i = (y * width + x) * 4;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

// --- SVG favicon (ten sam motyw co raster) ----------------------------------
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#0b57d0"/>
  <path d="M16 5.2c-4.3 0-7.8 3.4-7.8 7.6 0 5.6 7.8 14.7 7.8 14.7s7.8-9.1 7.8-14.7c0-4.2-3.5-7.6-7.8-7.6z" fill="#fff"/>
  <circle cx="16" cy="12.8" r="3.3" fill="#0b57d0"/>
</svg>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, 'favicon.svg'), FAVICON_SVG, 'utf8');
writeFileSync(resolve(OUT_DIR, 'favicon.ico'), encodeIco(encodePng(32, 32, drawIcon(32)), 32));
writeFileSync(resolve(OUT_DIR, 'apple-touch-icon.png'), encodePng(180, 180, drawIcon(180)));
writeFileSync(resolve(OUT_DIR, 'og-default.png'), encodePng(1200, 630, drawOg(1200, 630)));
process.stderr.write(`Zapisano favicon.svg, favicon.ico, apple-touch-icon.png, og-default.png -> ${OUT_DIR}\n`);
