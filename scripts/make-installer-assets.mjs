// Generates every PNG asset for the kern NSIS installer skin, using the
// canonical kern "Signal Radar" palette. Output lands under
// src-tauri/windows/nsis-skin/skin/ (form/ + public/...), which is then
// zipped into skin.zip by make-installer-skin.mjs.
//
// We render with @resvg/resvg-js (already a kern dev-dep, used by the app
// icon pipeline) instead of Python+Pillow, so no extra toolchain is needed.
//
// Run:  node scripts/make-installer-assets.mjs
// Then: node scripts/make-installer-skin.mjs   (zips skin/ -> skin.zip)
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKIN = join(ROOT, 'src-tauri', 'windows', 'nsis-skin', 'skin');
const FORM = join(SKIN, 'form');
const CAP = join(SKIN, 'public', 'caption');
const CHK = join(SKIN, 'public', 'checkbox');
const BK = join(SKIN, 'public', 'bk');
const VSCROLL = join(SKIN, 'public', 'vsrcollbar');
const EDIT = join(SKIN, 'public', 'edit');

// Window geometry — matches the nsNiuniuSkin root window (install.xml).
const W = 508;
const H = 418;

// kern design tokens (see src/styles/global.css @theme). The installer is a
// near-black surface with a single signal-green accent — used for button
// hover fills, the progress bar fill, and a subtle logo bloom.
const BG = '#050506'; // --color-bg-core (page background)
const SURFACE = '#0b0c10'; // --color-bg-surface (filled control background)
const GRID = '#161920'; // --color-grid-bounds (dim grid / faint border)
const SIGNAL = '#4cf5a0'; // --color-signal-high (the accent)
const SIGNAL_DIM = '#2a3a33'; // dimmed green for pressed states
const FG = '#c8c8c8'; // primary text / bright borders
const FG_DIM = '#6a6a6a'; // secondary text / dim borders
const FG_FAINT = '#262626'; // progress track / recessed outlines
const FG_FAINTER = '#1a1a1a'; // pressed button fill
const WHITE = '#ffffff';

// ─── rendering helpers ──────────────────────────────────────────────────

/** Render an SVG string to a PNG file at the SVG's intrinsic size. */
function render(svg, file) {
  // The SVG carries its own width/height; render at 1:1 with no fit override.
  const resvg = new Resvg(svg, { background: 'transparent' });
  const png = resvg.render().asPng();
  writeFileSync(file, png);
}

/** Minimal SVG wrapper sized to w×h with transparent background. */
function svgOpen(w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
}
const svgClose = '</svg>';

// ─── the Signal Radar logo ──────────────────────────────────────────────
// Mirrors scripts/make-icon.mjs: dim dot-matrix grid, three concentric rings
// of signal-green dots radiating from a bright glowing core, on a rounded
// near-black square. Drawn fresh at the target pixel size for crisp dots.
function radarSvg(size) {
  const cx = size / 2;
  const cy = size / 2;
  const corner = size * 0.195; // rounded-square radius, ~same ratio as the icon
  const gridPitch = size / 42; // tight dot-matrix pitch scaled to size
  const gridR = gridPitch * 0.15;

  let gridDots = '';
  for (let y = gridPitch / 2; y < size; y += gridPitch) {
    for (let x = gridPitch / 2; x < size; x += gridPitch) {
      gridDots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${gridR.toFixed(1)}" fill="${GRID}"/>`;
    }
  }

  const rings = [
    { r: size * 0.117, count: 8, dot: size * 0.0078, op: 0.95 },
    { r: size * 0.234, count: 16, dot: size * 0.0063, op: 0.78 },
    { r: size * 0.352, count: 24, dot: size * 0.0049, op: 0.55 },
  ];
  let radarDots = '';
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const ang = (i / ring.count) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(ang) * ring.r;
      const y = cy + Math.sin(ang) * ring.r;
      radarDots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${ring.dot.toFixed(1)}" fill="${SIGNAL}" opacity="${ring.op}"/>`;
    }
  }

  // Glowing core: stacked translucent halos + bright center.
  const core = `
    <circle cx="${cx}" cy="${cy}" r="${(size * 0.045).toFixed(1)}" fill="${SIGNAL}" opacity="0.15"/>
    <circle cx="${cx}" cy="${cy}" r="${(size * 0.029).toFixed(1)}" fill="${SIGNAL}" opacity="0.30"/>
    <circle cx="${cx}" cy="${cy}" r="${(size * 0.0166).toFixed(1)}" fill="${SIGNAL}"/>`;

  // Soft ambient green bloom behind everything.
  const bloom = `
    <defs><radialGradient id="bloom" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${SIGNAL}" stop-opacity="0.12"/>
      <stop offset="55%" stop-color="${SIGNAL}" stop-opacity="0.03"/>
      <stop offset="100%" stop-color="${SIGNAL}" stop-opacity="0"/>
    </radialGradient></defs>
    <rect x="0" y="0" width="${size}" height="${size}" fill="url(#bloom)"/>`;

  return `${svgOpen(size, size)}
    <defs><clipPath id="round"><rect x="0" y="0" width="${size}" height="${size}" rx="${corner}" ry="${corner}"/></clipPath></defs>
    <g clip-path="url(#round)">
      <rect x="0" y="0" width="${size}" height="${size}" rx="${corner}" ry="${corner}" fill="${BG}"/>
      ${bloom}
      <g>${gridDots}</g>
      <g>${radarDots}</g>
      ${core}
    </g>
  ${svgClose}`;
}

// ─── buttons ────────────────────────────────────────────────────────────
// App-style rounded rectangle: outlined dim normal, solid signal-green on
// hover (the one place the accent appears as a fill), dimmed pressed.
// Geometry mirrors galdr's make_button (radius = min(w,h)//6).
function buttonSvg(w, h, { fill, outline }) {
  const r = Math.floor(Math.min(w, h) / 6);
  return `${svgOpen(w, h)}
    <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${r}" ry="${r}" fill="${fill}" stroke="${outline}" stroke-width="1"/>
  ${svgClose}`;
}

function makeButton(w, h, prefix) {
  const base = (name, fill, outline) =>
    render(buttonSvg(w, h, { fill, outline }), join(FORM, `${prefix}_${name}.png`));
  base('normal', SURFACE, FG); // dim fill, light-grey outline
  base('hover', SIGNAL, SIGNAL); // solid green — the accent
  base('pressed', FG_FAINTER, FG_DIM); // subtle depression
}

// ─── caption (window chrome) buttons ────────────────────────────────────
// Subtle always-visible glyph in normal state; filled bg + bright glyph on
// hover/press. The close button goes red on hover (conventional, also matches
// the app's fault-vector red).
function captionGlyph(icon, size) {
  const pad = Math.floor(size / 3);
  if (icon === 'close') {
    return `<line x1="${pad}" y1="${pad}" x2="${size - pad - 1}" y2="${size - pad - 1}" stroke="COLOR" stroke-width="2" stroke-linecap="round"/>
            <line x1="${size - pad - 1}" y1="${pad}" x2="${pad}" y2="${size - pad - 1}" stroke="COLOR" stroke-width="2" stroke-linecap="round"/>`;
  }
  // min
  const y = Math.floor(size / 2);
  return `<line x1="${pad}" y1="${y}" x2="${size - pad - 1}" y2="${y}" stroke="COLOR" stroke-width="2" stroke-linecap="round"/>`;
}

function makeCaptionBtn(size, icon) {
  // normal: faint glyph only
  render(
    `${svgOpen(size, size)}${captionGlyph(icon, size).replaceAll('COLOR', FG_DIM)}${svgClose}`,
    join(CAP, `${icon}_normal.png`)
  );
  const bgHover = icon === 'close' ? '#8b0000' : SURFACE;
  const bgPressed = icon === 'close' ? '#cc0000' : FG_FAINTER;
  for (const [name, bg] of [['hover', bgHover], ['pressed', bgPressed]]) {
    render(
      `${svgOpen(size, size)}
        <rect x="0" y="0" width="${size}" height="${size}" rx="4" ry="4" fill="${bg}"/>
        ${captionGlyph(icon, size).replaceAll('COLOR', FG)}
      ${svgClose}`,
      join(CAP, `${icon}_${name}.png`)
    );
  }
}

// ─── checkboxes ─────────────────────────────────────────────────────────
// 16×16 rounded squares; checked state = dim fill + bright white check.
function checkboxSvg(size, { fill, border, check }) {
  let checkPath = '';
  if (check) {
    const p1 = `${Math.floor(size * 0.25)},${Math.floor(size * 0.5)}`;
    const p2 = `${Math.floor(size / 3)},${Math.floor((size * 2) / 3)}`;
    const p3 = `${Math.floor(size * 0.75)},${Math.floor(size / 3)}`;
    checkPath = `<polyline points="${p1} ${p2} ${p3}" fill="none" stroke="${WHITE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const f = fill ?? 'none';
  return `${svgOpen(size, size)}
    <rect x="1.5" y="1.5" width="${size - 3}" height="${size - 3}" rx="2" ry="2" fill="${f}"${border ? ` stroke="${border}" stroke-width="1"` : ''}/>
    ${checkPath}
  ${svgClose}`;
}

function makeCheckbox(size) {
  render(checkboxSvg(size, { border: FG_DIM }), join(CHK, 'chk_normal.png'));
  render(checkboxSvg(size, { border: FG }), join(CHK, 'chk_hover.png'));
  render(checkboxSvg(size, { fill: SURFACE, border: FG, check: true }), join(CHK, 'chk_checked.png'));
  render(checkboxSvg(size, { fill: FG_FAINTER, border: FG_FAINT }), join(CHK, 'chk_disabled.png'));
}

// ─── flat rectangles & bars ─────────────────────────────────────────────

function solidPng(w, h, color, file) {
  render(`${svgOpen(w, h)}<rect x="0" y="0" width="${w}" height="${h}" fill="${color}"/>${svgClose}`, file);
}

// ─── main ───────────────────────────────────────────────────────────────

function main() {
  // Ensure all output dirs exist.
  for (const d of [FORM, CAP, CHK, BK, VSCROLL, EDIT]) mkdirSync(d, { recursive: true });

  // Page backgrounds (all solid near-black).
  for (const name of [
    'install_bg',
    'installing_bg',
    'finish_bg',
    'uninstall_bg',
    'uninstalling_bg',
    'uninstallfinish_bg',
  ]) {
    solidPng(W, H, BG, join(FORM, `${name}.png`));
  }

  // Logo (80×80 header on the config page) + progress/finish use a 64×64
  // via the same file scaled by the XML control, so one 80×80 asset suffices.
  render(radarSvg(80), join(FORM, 'logo.png'));

  // Progress bar: green fill over a faint track (448×6 each).
  solidPng(448, 6, SIGNAL, join(FORM, 'fg.png'));
  solidPng(448, 6, FG_FAINT, join(FORM, 'bg.png'));

  // Buttons.
  makeButton(140, 40, 'btn_primary');
  makeButton(80, 30, 'btn_secondary');

  // Caption controls.
  makeCaptionBtn(28, 'close');
  makeCaptionBtn(28, 'min');

  // Checkboxes.
  makeCheckbox(16);

// Install-path edit field background (bottom underline only).
  render(
    `${svgOpen(200, 28)}<rect x="0" y="25" width="200" height="2" fill="${FG_FAINT}"/>${svgClose}`,
    join(EDIT, 'edit0.png')
  );

  // Scrollbar arrows (8×8) + thumb (8×30), normal + hot.
  solidPng(8, 8, FG_DIM, join(VSCROLL, 'vscrollbtn.png'));
  solidPng(8, 8, FG, join(VSCROLL, 'vscrollbtn_hot.png'));
  solidPng(8, 30, FG_FAINT, join(VSCROLL, 'vscrollbar.png'));
  solidPng(8, 30, FG, join(VSCROLL, 'vscrollbar_hot.png'));

  // Background shadow (full-window solid — the window is frameless/transparent).
  solidPng(W, H, BG, join(BK, 'bk_shadow.png'));

  console.log('✓ kern installer skin assets generated under src-tauri/windows/nsis-skin/skin/');
}

main();
