import { loadFont } from "@remotion/google-fonts/JetBrainsMono";

/**
 * JetBrains Mono — kern's canonical UI typeface (declared in global.css but
 * never self-hosted in the app; we load it here so renders are pixel-stable).
 *
 * We load only the two weights + latin subset we actually use, to avoid the
 * dozens of network requests the full family triggers.
 */
export const { fontFamily } = loadFont("normal", {
  weights: ["400", "600"],
  subsets: ["latin"],
});
