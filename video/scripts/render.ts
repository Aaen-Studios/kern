/**
 * Render both deliverables via the Remotion renderer API.
 * Usage: `bun run scripts/render.ts`
 *
 * Produces:
 *   out/kern-promo.mp4       — the ~35s main promo
 *   out/kern-hero-loop.mp4   — the 6s seamless loop
 *
 * Both at 1920×1080 @ 30fps, H.264 MP4, JPEG image format.
 */
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "src", "index.ts");
const OUT_DIR = join(import.meta.dirname, "..", "out");

interface Job {
  id: string;
  file: string;
}

const jobs: Job[] = [
  { id: "KernVideo", file: "kern-promo.mp4" },
  { id: "HeroLoop", file: "kern-hero-loop.mp4" },
];

console.log("bundling compositions…");
const serve = await bundle({ entryPoint: ROOT });

for (const job of jobs) {
  const comp = await selectComposition({ serveUrl: serve, id: job.id });
  const outPath = join(OUT_DIR, job.file);
  await mkdir(dirname(outPath), { recursive: true });
  console.log(`rendering ${job.id} → ${outPath} …`);
  await renderMedia({
    composition: comp,
    serveUrl: serve,
    codec: "h264",
    outputLocation: outPath,
    imageFormat: "jpeg",
  });
  console.log(`  ✓ ${job.file}`);
}

console.log("all renders complete.");
