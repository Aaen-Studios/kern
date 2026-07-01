// Pre-build hook (run from Tauri's beforeBuildCommand): puts skin.zip where
// the NSIS compiler will find it at build time, and mirrors the custom
// nsNiuniuSkin DLLs into Tauri's shared NSIS plugins cache so they resolve
// via `!addplugindir "${ADDITIONALPLUGINSPATH}"`.
//
// The DLLs live under nsis-skin/ in the repo (committed) and are only copied
// into the cache if missing — the cache is machine-global and may already be
// populated (e.g. from another project using the same skin engine).
//
// Run:  node scripts/prepare-nsis.mjs
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_TAURI = join(__dirname, '..', 'src-tauri');
const SKIN_DIR = join(SRC_TAURI, 'windows', 'nsis-skin');
const SKIN_ZIP = join(SKIN_DIR, 'skin.zip');

const DLLS = ['nsNiuniuSkin.dll', 'BgWorker.dll', 'nsProcess.dll', 'nsis7zU.dll'];

// Resolve Tauri's global NSIS plugins cache. On Windows this is
// %LOCALAPPDATA%\tauri\NSIS\Plugins\x86-unicode\additional\. NSIS is a
// Windows-only target, so on other platforms we no-op the cache step.
function pluginsCacheDir() {
  if (platform() !== 'win32') return null;
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(local, 'tauri', 'NSIS', 'Plugins', 'x86-unicode', 'additional');
}

function ensureCacheDlls() {
  const cache = pluginsCacheDir();
  if (!cache) return;
  mkdirSync(cache, { recursive: true });
  for (const dll of DLLS) {
    const dest = join(cache, dll);
    if (!existsSync(dest)) {
      copyFileSync(join(SKIN_DIR, dll), dest);
      console.log(`  mirrored ${dll} -> cache`);
    }
  }
}

function main() {
  if (!existsSync(SKIN_ZIP)) {
    console.error(
      `✗ skin.zip not found at ${SKIN_ZIP}.\n` +
        '  Run `bun run installer:assets` first to generate the skin assets and zip.'
    );
    process.exit(1);
  }

  // Copy skin.zip into the NSIS build output dir. Tauri compiles the .nsi from
  // target/release/nsis/x64/, so relative `File` paths in installer.nsi
  // resolve from there.
  const targetNsis = join(SRC_TAURI, 'target', 'release', 'nsis', 'x64');
  mkdirSync(targetNsis, { recursive: true });
  copyFileSync(SKIN_ZIP, join(targetNsis, 'skin.zip'));
  console.log(`✓ Copied skin.zip -> ${join(targetNsis, 'skin.zip')}`);

  ensureCacheDlls();
  console.log('✓ NSIS preparation complete.');
}

main();
