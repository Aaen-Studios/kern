/**
 * Procedural SFX generator — synthesizes the promo's sound effects to WAV
 * files in public/audio/ so the video is fully self-contained (no external
 * SFX licensing needed). Re-run with `bun run sfx`.
 *
 * Produces:
 *   sfx-blip.wav    — short bright blip for chip registrations (sine chirp,
 *                     fast exponential decay).
 *   sfx-whoosh.wav  — sweeping bandpass-style noise for the telemetry handoff.
 *   sfx-resolve.wav — a soft major-chord pad for the outro lockup.
 *
 * Pure-TS synthesis (no Web Audio runtime needed) — generates sample buffers
 * directly and encodes them as 16-bit PCM WAV. Works under bun or node.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const SR = 44100;
const OUT_DIR = join(import.meta.dirname, "..", "public", "audio");

type SampleBuffer = {
  length: number;
  channels: Float32Array[];
  sampleRate: number;
};

const silence = (seconds: number, channels = 2): SampleBuffer => {
  const length = Math.ceil(SR * seconds);
  return {
    length,
    channels: Array.from({ length: channels }, () => new Float32Array(length)),
    sampleRate: SR,
  };
};

const mix = (dst: SampleBuffer, src: SampleBuffer, gain = 1): void => {
  for (let c = 0; c < dst.channels.length; c++) {
    const sc = src.channels[Math.min(c, src.channels.length - 1)];
    for (let i = 0; i < Math.min(dst.length, src.length); i++) {
      dst.channels[c][i] += sc[i] * gain;
    }
  }
};

/** Blip: sine with exp decay + upward chirp from f0 to f1. */
const blip = (): SampleBuffer => {
  const dur = 0.22;
  const buf = silence(dur);
  const f0 = 880;
  const f1 = 1320;
  let phase = 0;
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    const freq = f0 * Math.pow(f1 / f0, t / 0.08);
    phase += (freq / SR) * 2 * Math.PI;
    const env = Math.min(1, t / 0.005) * Math.exp(-t * 24);
    const s = Math.sin(phase) * env * 0.6;
    for (let c = 0; c < buf.channels.length; c++) buf.channels[c][i] = s;
  }
  return buf;
};

/** Whoosh: white noise shaped by a sweeping bandpass approximation. */
const whoosh = (): SampleBuffer => {
  const dur = 1.3;
  const buf = silence(dur);
  // Simple resonant bandpass: comb-delay whose center sweeps 300→4000→500Hz.
  const delayLen = Math.ceil(SR * 0.02);
  const delayLine = new Float32Array(delayLen);
  let delayIdx = 0;
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    const prog = t / dur;
    const sweep = prog < 0.6
      ? 300 * Math.pow(4000 / 300, prog / 0.6)
      : 4000 * Math.pow(500 / 4000, (prog - 0.6) / 0.4);
    // Feedback coefficient from target frequency (closer to 1 = sharper reso).
    const feedback = Math.max(0, Math.min(0.95, 1 - sweep / (SR * 0.5)));
    const noise = Math.random() * 2 - 1;
    const delayed = delayLine[delayIdx];
    const out = noise + delayed * feedback;
    delayLine[delayIdx] = out;
    delayIdx = (delayIdx + 1) % delayLen;
    const env =
      Math.min(1, t / (dur * 0.4)) *
      Math.exp(-Math.max(0, t - dur * 0.4) * 3);
    for (let c = 0; c < buf.channels.length; c++) {
      buf.channels[c][i] = out * env * 0.35;
    }
  }
  return buf;
};

/** Resolve: A major triad (A4/C#5/E5) triangle pad with slow attack+release. */
const resolve = (): SampleBuffer => {
  const dur = 2.5;
  const buf = silence(dur);
  const freqs = [440, 554.37, 659.25];
  for (const f of freqs) {
    const note = silence(dur);
    let phase = 0;
    for (let i = 0; i < note.length; i++) {
      const t = i / SR;
      phase += (f / SR) * 2 * Math.PI;
      // Triangle via abs(sin).
      const tri = Math.abs(Math.sin(phase)) * 2 - 1;
      const env = Math.min(1, t / 0.4) * Math.exp(-Math.max(0, t - 0.4) * 1.4);
      for (let c = 0; c < note.channels.length; c++) {
        note.channels[c][i] = tri * env * 0.18;
      }
    }
    mix(buf, note);
  }
  return buf;
};

/** Encode a float sample buffer as 16-bit PCM WAV. */
const encodeWav = (buf: SampleBuffer): Buffer => {
  const numCh = buf.channels.length;
  const dataLen = buf.length * numCh * 2;
  const out = Buffer.alloc(dataLen + 44);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  const writeU32 = (off: number, v: number) => view.setUint32(off, v, true);
  const writeU16 = (off: number, v: number) => view.setUint16(off, v, true);

  writeStr(0, "RIFF");
  writeU32(4, out.length - 8);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  writeU32(16, 16);
  writeU16(20, 1); // PCM
  writeU16(22, numCh);
  writeU32(24, SR);
  writeU32(28, SR * numCh * 2);
  writeU16(32, numCh * 2);
  writeU16(34, 16);
  writeStr(36, "data");
  writeU32(40, dataLen);

  let off = 44;
  for (let i = 0; i < buf.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, buf.channels[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return out;
};

const write = async (name: string, buf: SampleBuffer): Promise<void> => {
  const out = join(OUT_DIR, name);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, encodeWav(buf));
  console.log(
    `  ✓ ${name}  (${(buf.length / SR).toFixed(2)}s, ${Math.round(
      (buf.length * 2 * buf.channels.length) / 1024,
    )}KB)`,
  );
};

console.log("generating SFX → public/audio/");
await write("sfx-blip.wav", blip());
await write("sfx-whoosh.wav", whoosh());
await write("sfx-resolve.wav", resolve());
console.log("done.");
