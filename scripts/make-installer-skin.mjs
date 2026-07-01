// Zips the skin/ directory (XML pages + PNG assets) into skin.zip, which the
// nsNiuniuSkin.dll engine loads at install time. Port of galdr's
// generate-skin-zip.py, using Node so no Python is required.
//
// Run:  node scripts/make-installer-skin.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKIN_DIR = join(__dirname, '..', 'src-tauri', 'windows', 'nsis-skin', 'skin');
const OUTPUT = join(__dirname, '..', 'src-tauri', 'windows', 'nsis-skin', 'skin.zip');

// Minimal ZIP writer (deflate via zlib + a hand-rolled Central Directory) so
// the output is a standard .zip that NSIS's `File` command can extract.
function listFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

// CRC-32 (standard table-based) — needed for every local + central entry.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function buildZip() {
  const files = listFiles(SKIN_DIR).sort();
  const localChunks = [];
  const central = [];
  let offset = 0;

  for (const full of files) {
    const arc = relative(SKIN_DIR, full).replace(/\\/g, '/');
    const data = readFileSync(full);
    // ZIP method 8 = raw DEFLATE (RFC 1951, no zlib header/trailer). Using
    // deflateSync (zlib wrapper) here was the bug that made the nsNiuniuSkin
    // engine reject install.xml at runtime — it's a strict unzip.
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const nameBuf = Buffer.from(arc, 'utf8');
    const useDeflate = compressed.length < data.length;

    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? compressed : data;

    // Local file header (signature 0x04034b50)
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0), // flags
      u16(method),
      u16(0), u16(0), // mod time/date (zeroed — irrelevant to NSIS)
      u32(crc),
      u32(payload.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      payload,
    ]);
    localChunks.push(local);

    // Central directory record (signature 0x02014b50)
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20), // version made by
        u16(20), // version needed
        u16(0),
        u16(method),
        u16(0), u16(0),
        u32(crc),
        u32(payload.length),
        u32(data.length),
        u16(nameBuf.length),
        u16(0), // extra len
        u16(0), // comment len
        u16(0), // disk number
        u16(0), // internal attrs
        u32(0), // external attrs
        u32(offset), // offset of local header
        nameBuf,
      ])
    );

    offset += local.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50), // EOCD signature
    u16(0), u16(0), // disk number / disk with CD
    u16(files.length), u16(files.length), // entries on this disk / total
    u32(centralBuf.length),
    u32(offset), // offset of CD
    u16(0), // comment len
  ]);

  return Buffer.concat([...localChunks, centralBuf, end]);
}

writeFileSync(OUTPUT, buildZip());
console.log(`✓ Created ${relative(join(__dirname, '..'), OUTPUT)}`);
