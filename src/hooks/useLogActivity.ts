import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Derives a normalized "activity" signal (0.0..1.0+) from how fast log lines are
 * arriving for a server instance. Feeds the reactor-channel bar shader so the
 * matrix reacts to output churn as well as CPU/RAM.
 *
 * Approach: a sliding 1-second window counts incoming lines. Each render tick
 * the count decays exponentially (toward 0 when the stream is quiet), so a burst
 * of output flares up then settles. The value is normalized so ~10 lines/sec
 * reads as "fully active" (≥1.0).
 *
 * Mirrors useServerControl's subscription hygiene: a generation guard + disposed
 * flag drop listeners that resolve after the server changes or the component
 * unmounts, preventing leaks and double-counting under React StrictMode.
 */

/** Lines-per-second that maps to "fully active" (≥1.0). Tuned so normal request
 *  logging reads as visibly busy without saturating instantly. */
const FULL_ACTIVITY_LPS = 10;

/** Per-tick decay multiplier. Applied every REFRESH_MS; an idle stream fades to
 *  ~1% within about a second. */
const DECAY = 0.82;

/** How often the decay loop runs + state updates. */
const REFRESH_MS = 80;

/**
 * Returns a live activity value for the given instance, or 0 when `serverId`
 * is null. Subscribes to the same `log:<id>:stream` event the terminal uses.
 */
export function useLogActivity(serverId: string | null): number {
  const [activity, setActivity] = useState(0);
  // Accumulated line count in the current window; bumped by the listener,
  // drained by the decay loop. Held in a ref so the listener closure stays
  // stable across renders.
  const windowCountRef = useRef(0);
  const counterRef = useRef(0);

  // Decay loop: converts the accumulated window count into a smoothed activity
  // value. Runs on a fixed cadence so the fade looks steady regardless of how
  // bursty the log stream is.
  useEffect(() => {
    let raf = 0;
    let interval: ReturnType<typeof setInterval> | undefined;

    const tick = () => {
      const burst = windowCountRef.current;
      windowCountRef.current = 0;
      // Each line adds one "unit" normalized to the full-activity threshold,
      // scaled by how often we sample (lines-per-tick → lines-per-second).
      const instant = (burst / FULL_ACTIVITY_LPS) * (1000 / REFRESH_MS);
      counterRef.current = counterRef.current * DECAY + instant;
      setActivity(counterRef.current);
    };

    interval = setInterval(tick, REFRESH_MS);
    return () => {
      clearInterval(interval);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Subscribe to the log stream for this instance and count arrivals.
  useEffect(() => {
    if (!serverId) {
      windowCountRef.current = 0;
      counterRef.current = 0;
      setActivity(0);
      return;
    }

    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    let localCount = 0;

    (async () => {
      try {
        const fn = await listen<string>(`log:${serverId}:stream`, () => {
          if (disposed) return;
          localCount++;
          windowCountRef.current = localCount;
        });
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
      } catch {
        // Subscription failure is non-fatal — activity just stays at 0.
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
      // Reset counters so a server switch doesn't carry the old burst forward.
      localCount = 0;
      windowCountRef.current = 0;
    };
  }, [serverId]);

  return activity;
}
