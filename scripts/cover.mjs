// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a warm gradient, a wall-hung
// boiler with its flame and display, a pressure gauge and a room thermostat
// linked by radio waves. Plain Node (zlib), no dependency. Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
const smooth = (edge, distance) => Math.min(1, Math.max(0, edge - distance + 0.5));

const DARK = [28, 22, 40];
const PLUM = [92, 36, 60];
const WHITE = [240, 242, 246];
const STEEL = [196, 202, 212];
const SCREEN = [24, 40, 56];
const CYAN = [90, 210, 230];
const ORANGE = [255, 140, 40];
const YELLOW = [255, 214, 90];
const RED = [230, 70, 60];

/** Distance from a point to a rounded rectangle (negative inside). */
function roundedBox(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - halfW + radius;
  const qy = Math.abs(y - cy) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Distance to a segment. */
function segment(x, y, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
}

function pixel(x, y) {
  let color = mix(DARK, PLUM, (x / WIDTH) * 0.6 + (y / HEIGHT) * 0.4);

  // The boiler: a white cabinet with a display and a flame window.
  const boiler = roundedBox(x, y, 300, 260, 130, 180, 18);
  color = mix(color, STEEL, smooth(0, Math.abs(boiler) - 2));
  color = mix(color, WHITE, smooth(0, boiler + 2));
  const display = roundedBox(x, y, 300, 150, 80, 28, 6);
  color = mix(color, SCREEN, smooth(0, display));
  // Two digits "21" drawn as segments on the display.
  const DIGITS = [
    [270, 136, 286, 136],
    [286, 136, 286, 150],
    [286, 150, 270, 150],
    [270, 150, 270, 164],
    [270, 164, 286, 164],
    [312, 136, 312, 164],
  ];
  for (const [x0, y0, x1, y1] of DIGITS) {
    color = mix(color, CYAN, smooth(2.5, segment(x, y, x0, y0, x1, y1)));
  }
  // Flame window and flame.
  const window = roundedBox(x, y, 300, 300, 60, 70, 30);
  color = mix(color, DARK, smooth(0, window));
  if (window < 0) {
    const fx = (x - 300) / 38;
    const fy = (y - 330) / 52;
    const flame = fx * fx + fy * fy * (fy < 0 ? 0.55 : 1.6);
    color = mix(color, ORANGE, smooth(1, flame * 26 - 20));
    const core = fx * fx * 2.4 + (fy + 0.15) ** 2 * (fy < -0.15 ? 1.1 : 3.2);
    color = mix(color, YELLOW, smooth(1, core * 26 - 18));
  }
  // Pipes under the boiler.
  for (const px of [230, 280, 320, 370]) {
    const pipe = roundedBox(x, y, px, 470, 7, 30, 3);
    color = mix(color, STEEL, smooth(0, pipe));
  }

  // The pressure gauge on the right of the boiler.
  const gauge = Math.hypot(x - 375, y - 405);
  color = mix(color, STEEL, smooth(26, gauge));
  color = mix(color, WHITE, smooth(22, gauge));
  color = mix(color, RED, smooth(2, segment(x, y, 375, 405, 389, 391)));

  // The room thermostat, linked by radio waves.
  const stat = Math.hypot(x - 620, y - 260);
  color = mix(color, STEEL, smooth(70, stat));
  color = mix(color, WHITE, smooth(66, stat));
  const ring = Math.abs(stat - 46);
  const angle = Math.atan2(y - 260, x - 620);
  if (angle > -2.4 && angle < 0.8) color = mix(color, ORANGE, smooth(4, ring));
  color = mix(color, SCREEN, smooth(22, stat));
  const waves = Math.hypot(x - 455, y - 260);
  if (x > 440 && x < 540 && Math.abs(y - 260) < (x - 440) * 0.9) {
    for (const r of [30, 55, 80]) color = mix(color, CYAN, smooth(2.5, Math.abs(waves - r)));
  }
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);
