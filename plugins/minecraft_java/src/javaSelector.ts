/**
 * javaSelector.ts — Java version mapping & detection integration.
 */

import type { JavaInstall } from "./types";

export type { JavaInstall };

/**
 * Maps a Minecraft version string to the recommended minimum
 * Java major version, optionally considering the server runtime.
 *
 * Modloaders (NeoForge, Forge) sometimes require a higher Java version
 * than vanilla MC for the same MC version. The `runtime` parameter
 * accounts for this.
 *
 * Sources:
 *   https://minecraft.wiki/w/Java_Edition_1.20.5  (Java 21 requirement)
 *   https://minecraft.wiki/w/Java_Edition_1.17     (Java 16 minimum, 17 recommended)
 *   NeoForge class file version 69.0 = Java 25
 */
export function mcVersionToJavaVersion(mcVersion: string, runtime?: string): number {
  if (!mcVersion) return 21; // safe default for unknown / latest

  const parts = mcVersion.split(".");
  const major = parseInt(parts[0] ?? "0", 10);
  const minor = parseInt(parts[1] ?? "0", 10);
  const patch = parseInt(parts[2] ?? "0", 10);

  // MC 26.1+ raised the Java requirement to 25. Earlier post-1.x releases
  // (and 26.0.x) still run on Java 21. A bare "26.1" (no patch segment) is
  // patch 0, so compare on minor alone: 26.1+ → 25.
  const atLeast26_1 = major > 26 || (major === 26 && minor >= 1);
  if (major > 1) return atLeast26_1 ? 25 : 21;

  // Base Java requirement from MC version alone.
  let javaVersion: number;
  if (minor >= 21) {
    javaVersion = 21;
  } else if (minor === 20 && patch >= 5) {
    javaVersion = 21;
  } else if (minor >= 17) {
    javaVersion = 17;
  } else if (minor === 16) {
    javaVersion = 11;
  } else {
    javaVersion = 8;
  }

  // NeoForge / Forge can require a higher Java than vanilla MC.
  // NeoForge 21.x+ ships with class file version 69.0 (Java 25).
  // Forge generally tracks vanilla, but bump it too for safety.
  if (runtime === "neoforge" && javaVersion < 25) {
    javaVersion = 25;
  } else if (runtime === "forge" && javaVersion < 21) {
    javaVersion = 21;
  }

  return javaVersion;
}

/**
 * Calls the Tauri `detect_java` command to find Java installations.
 * Also scans the server's jdk/ directory for plugin-downloaded JDKs.
 *
 * @param invoke - The invoke function from hostAPI (avoids dynamic import).
 * @param serverPath - Optional server instance path to scan for local JDKs.
 */
export async function detectJava(
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
  serverPath?: string,
): Promise<JavaInstall[]> {
  const results: JavaInstall[] = (await invoke("detect_java", { serverPath: serverPath ?? null })) as JavaInstall[];
  return results;
}

/**
 * Filters Java installations that meet the version requirement for
 * a given MC version, sorted by preference (highest version first).
 */
export function filterJavaForMc(
  installs: JavaInstall[],
  mcVersion: string,
): JavaInstall[] {
  const required = mcVersionToJavaVersion(mcVersion);
  return installs
    .filter((j) => j.majorVersion >= required)
    .sort((a, b) => b.majorVersion - a.majorVersion || b.version.localeCompare(a.version));
}
