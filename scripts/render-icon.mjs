// Renders src-tauri/icons/icon.svg → src-tauri/icons/icon.png (1024×1024 master)
// using @resvg/resvg-js (no native cairo needed). The resulting PNG is the
// source consumed by `bun run tauri icon`.
//
// Run:  node scripts/render-icon.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync('src-tauri/icons/icon.svg', 'utf8');
// NOTE: no forced background — the SVG's rounded-square frame leaves the
// corners transparent, so the rounded shape is preserved (a solid background
// here would fill the corners back in and undo the rounding).
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1024 },
});
const png = resvg.render().asPng();
writeFileSync('src-tauri/icons/icon.png', png);
console.log(`Wrote src-tauri/icons/icon.png  (${png.length} bytes)`);
