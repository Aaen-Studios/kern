// Generates the kern "Signal Radar" master SVG icon (1024×1024 viewBox).
// Design: near-black rounded-square, dim dot-matrix grid, concentric rings of
// signal-green dots radiating from a bright glowing core. Pure, crisp, scalable.
//
// Run:  node scripts/make-icon.mjs
// Then render to PNG:  node scripts/render-icon.mjs
import { writeFileSync } from 'node:fs';

const SIZE = 1024;
const CX = SIZE / 2;
const CY = SIZE / 2;
const CORNER_R = 200; // rounded-square frame radius (~19.5% — slick, not iOS-full)

// Palette (canonical kern design tokens — see src/styles/global.css)
const BG = '#050506'; // --color-bg-core
const GRID = '#161920'; // --color-grid-bounds
const SIGNAL = '#4cf5a0'; // --color-signal-high (running / nominal)

// ---- dim matrix grid: dots on an even pitch (recessive boundary texture) ----
const gridPitch = 24;
const gridDotR = 3.5;
let gridDots = '';
for (let y = gridPitch / 2; y < SIZE; y += gridPitch) {
  for (let x = gridPitch / 2; x < SIZE; x += gridPitch) {
    gridDots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${gridDotR}" fill="${GRID}"/>`;
  }
}

// ---- signal radar: 3 concentric rings of green dots around a glowing core ----
// Tighter + brighter near the core, fading toward the outer ring.
// ~94px arc-spacing kept uniform across rings for a clean, intentional look.
const rings = [
  { r: 120, count: 8, dot: 8, op: 0.95 }, // inner
  { r: 240, count: 16, dot: 6.5, op: 0.78 }, // middle
  { r: 360, count: 24, dot: 5, op: 0.55 }, // outer
];

let radarDots = '';
for (const ring of rings) {
  for (let i = 0; i < ring.count; i++) {
    const ang = (i / ring.count) * Math.PI * 2 - Math.PI / 2; // start at top
    const x = CX + Math.cos(ang) * ring.r;
    const y = CY + Math.sin(ang) * ring.r;
    radarDots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${ring.dot}" fill="${SIGNAL}" opacity="${ring.op}"/>`;
  }
}

// Bright glowing core node (stacked opacities = soft glow)
const core = `
  <circle cx="${CX}" cy="${CY}" r="46" fill="${SIGNAL}" opacity="0.15"/>
  <circle cx="${CX}" cy="${CY}" r="30" fill="${SIGNAL}" opacity="0.30"/>
  <circle cx="${CX}" cy="${CY}" r="17" fill="${SIGNAL}"/>
`;

// Soft ambient green bloom behind everything
const bloom = `
  <radialGradient id="bloom" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="${SIGNAL}" stop-opacity="0.12"/>
    <stop offset="55%" stop-color="${SIGNAL}" stop-opacity="0.03"/>
    <stop offset="100%" stop-color="${SIGNAL}" stop-opacity="0"/>
  </radialGradient>
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="url(#bloom)"/>
`;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="kern">
  <title>kern</title>
  <defs>
    <clipPath id="round">
      <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="${CORNER_R}" ry="${CORNER_R}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#round)">
    <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="${CORNER_R}" ry="${CORNER_R}" fill="${BG}"/>
    ${bloom}
    <g>${gridDots}</g>
    <g>${radarDots}</g>
    ${core}
  </g>
</svg>
`;

writeFileSync('src-tauri/icons/icon.svg', svg, 'utf8');
console.log(`Wrote src-tauri/icons/icon.svg  (${svg.length} bytes)`);
