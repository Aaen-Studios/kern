/**
 * Wire types for the new feature surfaces — marketplace, metrics history,
 * ports, energy. Mirror the Rust structs in registry.rs / metrics.rs /
 * commands.rs (camelCase on the wire).
 */

/** A plugin listing from the kern-web registry. */
export interface RegistryPlugin {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  upvotes: number;
  installCount: number;
  featured: boolean;
  authorGithub?: string | null;
  authorAvatar?: string | null;
  repoUrl?: string | null;
  homepageUrl?: string | null;
  versions: RegistryVersion[];
}

/** A downloadable version of a registry plugin. */
export interface RegistryVersion {
  version: string;
  kernCompat?: string;
  sha256?: string;
  sizeBytes: number;
  changelog?: string;
}

/** A historical telemetry sample (mirrors metrics::MetricSample). */
export interface MetricSample {
  /** Epoch seconds. */
  at: number;
  /** CPU fraction 0.0–1.0. */
  cpu: number;
  /** RAM fraction 0.0–1.0. */
  ram: number;
}

/** A listening TCP port attributed to an instance (mirrors commands::ListeningPort). */
export interface ListeningPort {
  port: number;
  /** Suggested quick-connect, e.g. "localhost:25565". */
  connect: string;
}

/** Result of a find-and-replace-across-files run. */
export interface ReplaceResult {
  filesChanged: number;
  replacements: number;
}

/** Energy cost estimate for an instance. */
export interface EnergyCost {
  id: string;
  hours: number;
  estWatts: number;
  cost: number;
  currencyNote: string;
}

/** An exported registry entry from another machine (sync). */
export interface ExportedRegistry {
  machine: string;
  exportedAt: number;
  instances: Array<{
    id: string;
    name: string;
    serverType: string;
    autoStart: boolean;
    status: string;
  }>;
}

/** Payload for the kern://health-alert event. */
export interface HealthAlert {
  id: string;
  name: string;
  metric: "cpu" | "ram";
  value: number;
  threshold: number;
}
