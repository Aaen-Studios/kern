import { Config } from "@remotion/cli/config";

/**
 * kern promo video — Remotion configuration.
 * Spec: docs/superpowers/specs/2026-07-22-kern-promo-video-design.md
 *
 * Standalone project; not consumed by the Tauri build. Driven by `bun run dev`.
 */
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setConcurrency(null); // auto
