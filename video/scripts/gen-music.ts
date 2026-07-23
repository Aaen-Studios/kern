/**
 * Procedural music generator — synthesizes a dark ambient-tech bed at 120 BPM
 * so the promo is fully self-contained (no external track licensing) and
 * beat-synced to the animations (FRAMES_PER_BEAT = 15).
 *
 * Layers (all A minor for a brooding, "control-room" mood):
 *   • sub-bass pulse on every beat (kick-like sine thump)
 *   • minor pad chord (Am / F / C / G) swelling per bar
 *   • arpeggiated "radar ping" blips on off-beats
 *   • filtered noise riser under the final bars
 *
 * Pure-TS synthesis (no Web Audio runtime needed) → 16-bit PCM WAV.
 * Re-run with `bun run music`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const SR = 44100;
const BPM = 120;
const BEAT = 60 / BPM; // 0.5s per beat
const BARS = 56; // ~28s of music (4 beats/bar) — covers the trimmed promo
const DURATION = BARS * 4 * BEAT;
const OUT_DIR = join(import.meta.dirname, "..", "public", "audio");

type SampleBuffer = {
  length: number;
  channels: Float32Array[];
  sampleRate: number;
};

const make = (seconds: number, channels = 2): SampleBuffer => {
  const length = Math.ceil(SR * seconds);
  return {
    length,
    channels: Array.from({ length: channels }, () => new Float32Array(length)),
    sampleRate: SR,
  };
};

/** Write a mono buffer into both channels of a stereo buffer at offset t. */
const place = (dst: SampleBuffer, mono: Float32Array, tSec: number): void => {
  const start = Math.floor(tSec * SR);
  for (let i = 0; i < mono.length; i++) {
    const idx = start + i;
    if (idx >= dst.length) break;
    for (let c = 0; c < dst.channels.length; c++) {
      dst.channels[c][idx] += mono[i];
    }
  }
};

/** Exponential decay envelope: quick attack, exp release. */
const env = (n: number, attack: number, decay: number): number => {
  const t = n / SR;
  return Math.min(1, t / attack) * Math.exp(-t * decay);
};

/** A kick-style sub-bass thump (sine drop + click). */
const kick = (): Float32Array => {
  const dur = 0.35;
  const out = new Float32Array(Math.ceil(SR * dur));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const freq = 110 * Math.exp(-t * 28) + 42; // pitch drop 110→~42Hz
    phase += (freq / SR) * 2 * Math.PI;
    const body = Math.sin(phase) * env(i / SR, 0.004, 9) * 0.85;
    const click = (Math.random() * 2 - 1) * Math.exp(-t * 400) * 0.3;
    out[i] = body + click;
  }
  return out;
};

/** A sustained pad note (detuned saws + lowpass) of given freq + length. */
const pad = (freq: number, seconds: number): Float32Array => {
  const out = new Float32Array(Math.ceil(SR * seconds));
  const detunes = [0, 0.6, -0.6, 1.1]; // cents-ish detune for width
  const phases = detunes.map(() => Math.random() * 2 * Math.PI);
  // Simple one-pole lowpass state.
  let lp = 0;
  const cutoff = 0.06; // 0..1, lower = darker
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    // Slow attack + slow release swell across the note.
    const a = Math.min(1, t / (seconds * 0.3));
    const r = Math.min(1, (seconds - t) / (seconds * 0.4));
    const amp = Math.max(0, Math.min(a, r)) * 0.12;
    let s = 0;
    for (let d = 0; d < detunes.length; d++) {
      phases[d] += ((freq * Math.pow(2, detunes[d] / 12)) / SR) * 2 * Math.PI;
      // Sawtooth.
      s += ((phases[d] % (2 * Math.PI)) / Math.PI - 1);
    }
    s /= detunes.length;
    lp += cutoff * (s - lp); // smooth
    out[i] = lp * amp;
  }
  return out;
};

/** A bright "radar ping" blip (sine + octave, fast decay). */
const ping = (freq: number): Float32Array => {
  const dur = 0.4;
  const out = new Float32Array(Math.ceil(SR * dur));
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    p1 += (freq / SR) * 2 * Math.PI;
    p2 += ((freq * 2) / SR) * 2 * Math.PI;
    const e = Math.min(1, t / 0.006) * Math.exp(-t * 6);
    out[i] = (Math.sin(p1) * 0.7 + Math.sin(p2) * 0.25) * e * 0.3;
  }
  return out;
};

/** Filtered noise riser — sweeps in intensity over `seconds`. */
const riser = (seconds: number): Float32Array => {
  const out = new Float32Array(Math.ceil(SR * seconds));
  let lp = 0;
  const cutoff0 = 0.005;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const prog = t / seconds;
    const cutoff = cutoff0 + prog * 0.08;
    const noise = Math.random() * 2 - 1;
    lp += cutoff * (noise - lp);
    const amp = Math.pow(prog, 2) * 0.18;
    out[i] = lp * amp;
  }
  return out;
};

const barsPerChord = 4;
// A minor progression, one chord per `barsPerChord` bars.
const chords = [
  [110, 130.81, 164.81], // Am: A3 C4 E4
  [87.31, 130.81, 174.61], // F:  F3 C4 F4
  [130.81, 164.81, 196], // C:  C4 E4 G4
  [98, 146.83, 196], // G:  G3 D4 G4
];

console.log(`generating music → public/audio/music.wav  (${DURATION.toFixed(1)}s, ${BPM} BPM)`);
const buf = make(DURATION);

const k = kick();
for (let beat = 0; beat < BARS * 4; beat++) {
  place(buf, k, beat * BEAT);
}

// Pad chord per phrase.
for (let bar = 0; bar < BARS; bar += barsPerChord) {
  const chord = chords[(bar / barsPerChord) % chords.length];
  const len = barsPerChord * 4 * BEAT;
  for (const f of chord) place(buf, pad(f, len), bar * 4 * BEAT);
}

// Radar pings — A minor scale notes, on off-beats, sparse.
const scale = [220, 261.63, 329.63, 349.23, 392, 523.25]; // A3..C5 ish
for (let beat = 0; beat < BARS * 4; beat++) {
  // Pings land on the "and" of beats 2 and 4 (off-beats).
  if (beat % 2 === 1 && Math.random() > 0.45) {
    const f = scale[Math.floor(Math.random() * scale.length)];
    place(buf, ping(f), beat * BEAT + BEAT * 0.5);
  }
}

// Riser under the final 8 bars building toward the outro resolve.
place(buf, riser(8 * 4 * BEAT), (BARS - 8) * 4 * BEAT);

// Soft overall saturation + makeup gain, then normalize gently.
let peak = 0;
for (const ch of buf.channels) for (const s of ch) peak = Math.max(peak, Math.abs(s));
const norm = peak > 0 ? 0.9 / peak : 1;
for (const ch of buf.channels) {
  for (let i = 0; i < ch.length; i++) {
    const s = Math.tanh(ch[i] * norm * 1.2); // soft clip
    ch[i] = s * 0.85;
  }
}

// Encode 16-bit PCM WAV.
const numCh = buf.channels.length;
const dataLen = buf.length * numCh * 2;
const out = Buffer.alloc(dataLen + 44);
const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
const ws = (o: number, s: string) => {
  for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
};
ws(0, "RIFF");
view.setUint32(4, out.length - 8, true);
ws(8, "WAVE");
ws(12, "fmt ");
view.setUint32(16, 16, true);
view.setUint16(20, 1, true);
view.setUint16(22, numCh, true);
view.setUint32(24, SR, true);
view.setUint32(28, SR * numCh * 2, true);
view.setUint16(32, numCh * 2, true);
view.setUint16(34, 16, true);
ws(36, "data");
view.setUint32(40, dataLen, true);
let off = 44;
for (let i = 0; i < buf.length; i++) {
  for (let c = 0; c < numCh; c++) {
    const s = Math.max(-1, Math.min(1, buf.channels[c][i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
}

const outPath = join(OUT_DIR, "music.wav");
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, out);
console.log(
  `  ✓ music.wav  (${(DURATION).toFixed(1)}s, ${Math.round(out.length / 1024)}KB)`,
);
