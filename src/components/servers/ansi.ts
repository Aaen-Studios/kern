/**
 * Minimal ANSI SGR (color) parser — converts a log line containing CSI color
 * sequences into styled React spans.
 *
 * Servers commonly emit ANSI codes (e.g. `node`, `next`, `pytest` with color).
 * Rather than pull a dependency, this handles the common 8-color foreground
 * set (30-37) + bright (90-97), plus bold/dim, mapping them onto hex values
 * tuned for the kern dark palette.
 */

type StyleState = {
  color?: string;
  bold?: boolean;
  dim?: boolean;
};

interface Segment {
  text: string;
  style: StyleState;
}

const FG: Record<number, string> = {
  30: "#4c525e", // black → grid gray (signal-low)
  31: "#f54c4c", // red → fault-vector
  32: "#4cf5a0", // green → signal-high
  33: "#f5a04c", // yellow → warn-vector
  34: "#5c8cff", // blue
  35: "#c77dff", // magenta
  36: "#4cd8f5", // cyan
  37: "#c8ccd4", // white → soft zinc
};

const RESET = "#c8ccd4";

/**
 * Parses a single line into colored segments. Unknown SGR codes are ignored
 * gracefully — text always renders.
 */
export function parseAnsi(line: string): Segment[] {
  const segments: Segment[] = [];
  let current: StyleState = {};
  let buf = "";

  const flush = () => {
    if (buf) {
      segments.push({ text: buf, style: { ...current } });
      buf = "";
    }
  };

  // Match CSI sequences: \x1b[ ... m
  const regex = /\x1b\[([\d;]*)m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    // Text before this escape.
    buf += line.slice(lastIndex, match.index);
    flush();

    const params = match[1] === "" ? ["0"] : match[1].split(";");
    for (const p of params) {
      applySgr(Number(p), current);
    }

    lastIndex = regex.lastIndex;
  }

  // Trailing text after the last escape.
  buf += line.slice(lastIndex);
  flush();

  return segments.length ? segments : [{ text: line, style: {} }];
}

function applySgr(code: number, state: StyleState) {
  switch (code) {
    case 0:
      state.color = undefined;
      state.bold = undefined;
      state.dim = undefined;
      break;
    case 1:
      state.bold = true;
      break;
    case 2:
      state.dim = true;
      break;
    case 22:
      state.bold = undefined;
      state.dim = undefined;
      break;
    default:
      // 30-37 standard, 90-97 bright (treated the same here)
      if (FG[code]) state.color = FG[code];
      else if (FG[code - 60]) state.color = FG[code - 60];
      else if (code === 39) state.color = undefined; // default fg
      break;
  }
}

/** Default foreground for a segment with no explicit color. */
export const DEFAULT_FG = RESET;
