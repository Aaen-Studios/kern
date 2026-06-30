/**
 * main.ts - Plugin mount entry point.
 *
 * Exports mount() and unmount() as required by the Kern plugin system.
 *
 * The plugin contributes to the host UI through extension points:
 *   - "Setup" tab — the installer wizard (version, Java, RAM, install)
 *   - "Chat" tab  — live chat log + player list
 *
 * The server section subscribes to backend events via hostAPI.listen() to
 * receive live log output and status changes from the running MC process.
 *
 * Each tab renders a full tab-page layout matching the kern design system.
 */

import type { ServerInstance, HostAPI, JavaInstall, InstallStep, UnlistenFn, StatusPayload, InstanceMetrics } from "./types";
import type { VersionInfo } from "./versionFetcher";
import { fetchVersionsForRuntime } from "./versionFetcher";
import { detectJava, mcVersionToJavaVersion, filterJavaForMc } from "./javaSelector";
import { runInstall } from "./installer";
import { downloadJava } from "./downloadManager";

interface WizardState {
  serverData: ServerInstance;
  hostAPI: HostAPI;
  javaInstalls: JavaInstall[];
  selectedJava: string;
  mcVersion: string;
  mcVersions: VersionInfo[];
  fetchingVersions: boolean;
  includeSnapshots: boolean;
  installing: boolean;
  installSteps: InstallStep[];
  installLog: string[];
  installError: boolean;
  javaMajor: number;
  javaMissing: boolean;
  downloadingJava: boolean;
  running: boolean;
  chatLines: string[];
  players: string[];
  playerCount: string;
  chatInput: string;
  unlistenLog: UnlistenFn | null;
  unlistenStatus: UnlistenFn | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  metricsTimer: ReturnType<typeof setInterval> | null;
  metrics: InstanceMetrics;
  downloadProgress: number;
  // Server management tab state
  serverProps: Record<string, string>;
  /** Original server.properties text, line by line, preserved verbatim
   *  (comments, blank lines, ordering, unknown keys) so a save re-emits the
   *  file losslessly — only substituting values for keys the UI exposed. */
  serverPropsRaw: string[];
  propsLoaded: boolean;
  whitelist: string[];
  whitelistEnabled: boolean;
  bans: string[];
  ops: string[];
  manageTab: "properties" | "whitelist" | "bans" | "ops";
  backups: Array<{ name: string; size: number }>;
  backupLoading: boolean;
  /** True once loadBackups() has resolved at least once, so the lazy-load guard
   *  in renderBackupSection doesn't re-fire forever when the list is empty. */
  backupsLoaded: boolean;
  backupRunning: boolean;
}

let state: WizardState | null = null;
let rootEl: HTMLElement | null = null;
let opsListLoaded = false;
let listsLoaded = false;

// Tab update hooks — called from render() so plugin-registered tabs stay in sync.
// Keyed by tab id so each tab only removes its own entry on unmount.
let tabUpdateFns = new Map<string, () => void>();
// The id of the tab whose mount point is currently in the DOM. The host only
// renders the active plugin tab, so only one update fn has a live element at a
// time; render() re-runs just that one rather than rebuilding detached trees.
let activeTabId: string | null = null;


function $<T extends HTMLElement = HTMLDivElement>(
  tag: string, attrs: Record<string, string | undefined> = {}, children: (string | HTMLElement)[] = [],
): T {
  const el = document.createElement(tag) as T;
  for (const [k, v] of Object.entries(attrs)) { if (v === undefined) continue; el.setAttribute(k, v); }
  for (const child of children) {
    if (typeof child === "string") el.appendChild(document.createTextNode(child));
    else el.appendChild(child);
  }
  return el;
}

function cls(...names: string[]): string { return names.filter(Boolean).join(" "); }

declare global { interface Element { tap(fn: (el: this) => void): this; } }
if (!Element.prototype.tap) {
  Element.prototype.tap = function <T extends Element>(this: T, fn: (el: T) => void): T { fn(this); return this; };
}

const RUNTIME_LABELS: Record<string, string> = {
  vanilla: "Vanilla", paper: "Paper", purpur: "Purpur",
  fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt",
};
const RAM_PRESETS = [1, 2, 4, 6, 8, 12, 16];

function getDefaultHeapGb(runtime: string): number {
  return runtime === "forge" || runtime === "neoforge" ? 4 :
    runtime === "fabric" || runtime === "quilt" ? 3 : 2;
}

function getDefaultJvmArgs(runtime: string): string {
  const heap = getDefaultHeapGb(runtime);
  return [
    `-Xms${heap}G -Xmx${heap}G`,
    "-XX:+UseG1GC", "-XX:+ParallelRefProcEnabled", "-XX:MaxGCPauseMillis=200",
    "-XX:+UnlockExperimentalVMOptions", "-XX:+DisableExplicitGC", "-XX:+AlwaysPreTouch",
    "-XX:G1NewSizePercent=30", "-XX:G1MaxNewSizePercent=40", "-XX:G1HeapRegionSize=8M",
    "-XX:G1ReservePercent=20", "-XX:G1HeapWastePercent=5", "-XX:G1MixedGCCountTarget=4",
    "-XX:InitiatingHeapOccupancyPercent=15", "-XX:G1MixedGCLiveThresholdPercent=90",
    "-XX:G1RSetUpdatingPauseTimePercent=5", "-XX:SurvivorRatio=32", "-XX:MaxTenuringThreshold=1",
  ].join(" ");
}

function setHeapInJvmArgs(jvmArgs: string, heapGb: number): string {
  const newHeap = `-Xms${heapGb}G -Xmx${heapGb}G`;
  if (/-Xms\d+G\s+-Xmx\d+G/.test(jvmArgs)) return jvmArgs.replace(/-Xms\d+G\s+-Xmx\d+G/, newHeap);
  return `${newHeap} ${jvmArgs}`;
}

function getHeapFromJvmArgs(jvmArgs: string): number {
  const match = jvmArgs.match(/-Xmx(\d+)G/);
  return match ? parseInt(match[1], 10) : 0;
}

function persistOverride(hostAPI: HostAPI, serverData: ServerInstance, key: string, value: string): void {
  const overrides = { ...(serverData.userOverrides ?? {}), [key]: value };
  const payload: ServerInstance = { ...serverData, userOverrides: overrides };
  void hostAPI.invoke("update_server", { server: payload })
    .catch((err) => console.warn(`[minecraft_java] failed to save ${key}:`, err));
}

function heapTier(runtime: string): string {
  return runtime === "forge" || runtime === "neoforge" ? "heavy (4 GB)" :
    runtime === "fabric" || runtime === "quilt" ? "moderate (3 GB)" : "lightweight (2 GB)";
}


/* ─────────────────────────────────────────────────
 *  mount / unmount
 * ───────────────────────────────────────────────── */

export async function mount(
  mountPoint: HTMLElement, serverData: ServerInstance, hostAPI: HostAPI,
): Promise<void> {
  // Defensive teardown: module-level state (state, tabUpdateFns, listeners)
  // would be clobbered if a second mount races a first (two server detail
  // views, or a React StrictMode remount). Tear down any prior mount first so
  // its listeners/timers don't leak and its tabs don't bleed into this one.
  if (state) unmount();

  rootEl = mountPoint;
  const overrides = serverData.userOverrides ?? {};
  const mcVersion = overrides.mc_version || "";
  const runtime = overrides.runtime || "paper";

  let javaInstalls: JavaInstall[] = [];
  try { javaInstalls = await detectJava(hostAPI.invoke); } catch { /* non-fatal */ }

  let autoJava = overrides.java_path || "java";
  if (autoJava === "java" && javaInstalls.length > 0) {
    const filtered = filterJavaForMc(javaInstalls, mcVersion || "1.21");
    autoJava = filtered.length > 0 ? filtered[0].path : javaInstalls[0].path;
  }

  const javaMajor = mcVersionToJavaVersion(mcVersion || "1.21");
  const javaMissing = javaInstalls.length === 0 ||
    !javaInstalls.some((j) => j.majorVersion >= javaMajor);

  state = {
    serverData, hostAPI, javaInstalls, selectedJava: autoJava,
    mcVersion, mcVersions: [], fetchingVersions: true,
    includeSnapshots: false, installing: false, installSteps: [],
    installLog: [], installError: false, javaMajor, javaMissing,
    downloadingJava: false,
    running: false, chatLines: [], players: [], playerCount: "",
    chatInput: "", unlistenLog: null, unlistenStatus: null, pollTimer: null,
    metricsTimer: null, metrics: { cpu: 0, ram: 0, status: "stopped" },
    downloadProgress: 0,
    serverProps: {}, serverPropsRaw: [], propsLoaded: false,
    whitelist: [], whitelistEnabled: false,
    bans: [], ops: [],
    manageTab: "properties",
    backups: [], backupLoading: false, backupsLoaded: false, backupRunning: false,
  };

  render();
  await fetchAndSetVersions(runtime, false);
  subscribeToServer();
  void checkRunning();

  // ── Register "Setup" tab ────────────────────────────────────
  hostAPI.registerTab({
    id: "mc-setup",
    label: "Setup",
    mount: (el) => {
      const update = () => {
        if (!state) return;
        el.innerHTML = "";
        el.appendChild(renderSetupTab());
      };
      tabUpdateFns.set("mc-setup", update);
      activeTabId = "mc-setup";
      update();
    },
    unmount: () => {
      tabUpdateFns.delete("mc-setup");
      if (activeTabId === "mc-setup") activeTabId = null;
    },
  });

  // ── Register "Chat" tab ─────────────────────────────────────
  hostAPI.registerTab({
    id: "mc-chat",
    label: "Chat",
    mount: (el) => {
      const update = () => {
        if (!state) return;
        el.innerHTML = "";
        el.appendChild(renderChatTab());
      };
      tabUpdateFns.set("mc-chat", update);
      activeTabId = "mc-chat";
      update();
    },
    unmount: () => {
      tabUpdateFns.delete("mc-chat");
      if (activeTabId === "mc-chat") activeTabId = null;
    },
  });

  // ── Register "Manage" tab ──────────────────────────────────
  hostAPI.registerTab({
    id: "mc-manage",
    label: "Manage",
    mount: (el) => {
      const update = () => {
        if (!state) return;
        el.innerHTML = "";
        el.appendChild(renderManageTab());
      };
      tabUpdateFns.set("mc-manage", update);
      activeTabId = "mc-manage";
      update();
    },
    unmount: () => {
      tabUpdateFns.delete("mc-manage");
      if (activeTabId === "mc-manage") activeTabId = null;
    },
  });

  // ── Register "Backup World" toolbar action ─────────────────
  hostAPI.registerToolbarAction({
    id: "mc-backup",
    label: "backup world",
    disabled: false,
    order: 50,
    onClick() {
      void runBackupWithFeedback();
    },
  });
}

export function unmount(): void {
  if (state?.unlistenLog) { state.unlistenLog(); state.unlistenLog = null; }
  if (state?.unlistenStatus) { state.unlistenStatus(); state.unlistenStatus = null; }
  if (state?.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  if (state?.metricsTimer) { clearInterval(state.metricsTimer); state.metricsTimer = null; }
  state = null;
  rootEl = null;
  activeTabId = null;
  chatUserScrolledUp = false;
  opsListLoaded = false;
  listsLoaded = false;
  manageFeedback = "";
}

async function checkRunning(): Promise<void> {
  if (!state) return;
  try {
    const isRunning = await state.hostAPI.invoke("is_server_running", { id: state.serverData.id }) as boolean;
    if (!state) return;
    state.running = isRunning;
    render();
  } catch { /* non-fatal */ }
}

function subscribeToServer(): void {
  if (!state) return;
  const id = state.serverData.id;

  state.hostAPI.listen(`log:${id}:stream`, (payload) => {
    if (!state) return;
    handleLogLine(String(payload));
  }).then((unlisten) => { if (state) state.unlistenLog = unlisten; })
    .catch(() => { /* non-fatal */ });

  state.hostAPI.listen(`status:${id}`, (payload) => {
    if (!state) return;
    const status = payload as StatusPayload;
    if (status.state === "running") {
      state.running = true;
      startPlayerPolling();
      startMetricsPolling();
    } else {
      state.running = false;
      state.players = [];
      state.playerCount = "";
      stopPlayerPolling();
      stopMetricsPolling();
    }
    render();
  }).then((unlisten) => { if (state) state.unlistenStatus = unlisten; })
    .catch(() => { /* non-fatal */ });
}


function handleLogLine(line: string): void {
  if (!state) return;

  const chatMatch = line.match(/\]: <([^>]+)> (.+)$/);
  if (chatMatch) {
    state.chatLines.push(`<${chatMatch[1]}> ${chatMatch[2]}`);
  }

  const joinMatch = line.match(/\]: (\S+) joined the game$/);
  if (joinMatch) {
    state.chatLines.push(`→ ${joinMatch[1]} joined`);
    void sendCommand("list");
  }

  const leaveMatch = line.match(/\]: (\S+) left the game$/);
  if (leaveMatch) {
    state.chatLines.push(`← ${leaveMatch[1]} left`);
    void sendCommand("list");
  }

  const listMatch = line.match(/\]: There are (\d+) of a max of (\d+) players online:(.*)$/);
  if (listMatch) {
    state.playerCount = `${listMatch[1]}/${listMatch[2]}`;
    const names = listMatch[3].trim();
    state.players = names ? names.split(", ").map((n) => n.trim()) : [];
  }

  // Whitelist / banlist responses (for Manage tab)
  parseListResponse(line);

  if (state.chatLines.length > 200) {
    state.chatLines = state.chatLines.slice(-200);
  }
  render();
}

async function sendCommand(cmd: string): Promise<void> {
  if (!state || !state.running) return;
  try {
    await state.hostAPI.invoke("write_stdin_to_instance", {
      id: state.serverData.id, data: cmd + "\n",
    });
  } catch { /* non-fatal */ }
}

async function sendChat(message: string): Promise<void> {
  if (!message.trim()) return;
  await sendCommand(`say ${message}`);
  if (state) { state.chatLines.push(`[Server] ${message}`); render(); }
}

function startPlayerPolling(): void {
  if (!state || state.pollTimer) return;
  void sendCommand("list");
  state.pollTimer = setInterval(() => { void sendCommand("list"); }, 12000);
}

function stopPlayerPolling(): void {
  if (!state) return;
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

/**
 * Polls process-tree CPU/RAM telemetry from the backend at 1 Hz.
 * The backend walks the full process tree rooted at the server PID,
 * so worker children (e.g. modloader threads) are included.
 *
 * Patches the gauges in place instead of triggering a full re-render — a 1 Hz
 * rebuild would tear down the whole Chat tab (status bar, log, input) every
 * second, losing input focus and yanking the chat scroll to the bottom.
 */
function startMetricsPolling(): void {
  if (!state || state.metricsTimer) return;
  const id = state.serverData.id;
  state.metricsTimer = setInterval(async () => {
    if (!state) return;
    try {
      const m = await state.hostAPI.invoke("get_instance_metrics", { id }) as InstanceMetrics;
      if (!state) return;
      state.metrics = { cpu: m.cpu, ram: m.ram, status: m.status };
      patchMetricGauges(m.cpu, m.ram);
    } catch {
      /* non-fatal — leave last reading in place */
    }
  }, 1000);
}

/**
 * Updates the rendered CPU/RAM gauges in place. The gauges live in the Chat tab
 * status bar and are rebuilt with stable data-label attributes so we can find
 * them without re-rendering. If the gauges aren't in the DOM (e.g. a non-Chat
 * tab is active, or the server isn't shown as running) this is a no-op — the
 * next full render will draw them fresh from state.metrics.
 */
function patchMetricGauges(cpu: number, ram: number): void {
  const root = rootEl?.getRootNode() as ShadowRoot | Document | null;
  if (!root) return;
  for (const [label, value] of [["cpu", cpu], ["ram", ram]] as const) {
    const gauge = root.querySelector<HTMLElement>(`.mc-metric-gauge[data-label="${label}"]`);
    if (!gauge) continue;
    const pct = Math.round(value * 100);
    const color = value > 0.85 ? "#f54c4c" : value > 0.7 ? "#f5a04c" : "#4cf5a0";
    const fill = gauge.querySelector<HTMLElement>(".mc-metric-bar-fill");
    if (fill) { fill.style.width = `${pct}%`; fill.style.background = color; }
    const pctEl = gauge.querySelector<HTMLElement>(".mc-metric-pct");
    if (pctEl) pctEl.textContent = `${pct}%`;
    gauge.title = `${label.toUpperCase()}: ${pct}%`;
  }
}

function stopMetricsPolling(): void {
  if (!state) return;
  if (state.metricsTimer) { clearInterval(state.metricsTimer); state.metricsTimer = null; }
  state.metrics = { cpu: 0, ram: 0, status: "stopped" };
}

async function fetchAndSetVersions(runtime: string, includeSnapshots: boolean): Promise<void> {
  if (!state) return;
  state.fetchingVersions = true;
  state.mcVersions = [];
  render();

  try {
    const versions = await fetchVersionsForRuntime(runtime, includeSnapshots, state.hostAPI.invoke);
    if (!state) return;
    state.mcVersions = versions;
    state.fetchingVersions = false;

    if (versions.length > 0) {
      const shouldAutoSelect = !state!.mcVersion || !versions.find((v) => v.version === state!.mcVersion);
      if (shouldAutoSelect) state!.mcVersion = versions[0].version;
    }
  } catch {
    if (!state) return;
    state.mcVersions = [];
    state.fetchingVersions = false;
  }
  render();
}


/* ─────────────────────────────────────────────────
 *  render — re-renders the currently-active tab.
 *
 *  The host keeps only the active plugin tab mounted (inactive tabs are
 *  unmounted), so there's exactly one live mount point at a time. Rebuilding
 *  only that tab — instead of every registered tab's detached tree — avoids
 *  wasted work and the focus/scroll churn that the old "render all tabs every
 *  state change" loop caused.
 *
 *  For the high-frequency cases (1 Hz metrics polling, per-byte download
 *  progress, keystrokes) prefer the targeted patch helpers below; reserve
 *  render() for genuine structural changes.
 * ───────────────────────────────────────────────── */

function render(): void {
  if (!state || !activeTabId) return;
  const fn = tabUpdateFns.get(activeTabId);
  if (!fn) return;
  // A throw inside a tab's rebuild would corrupt the active tab's DOM (leaving
  // it half-built with no working event handlers) AND, since the same throwing
  // code runs on every subsequent render, permanently wedge the tab — buttons
  // stop responding. Wrap so one bad render path degrades to a logged warning
  // instead of bricking the UI.
  try {
    fn();
  } catch (err) {
    console.warn(`[minecraft_java] render of tab "${activeTabId}" failed:`, err);
  }
}


/* ═════════════════════════════════════════════════
 *  SETUP TAB — full tab page
 * ═════════════════════════════════════════════════ */

function renderSetupTab(): HTMLElement {
  const s = state!;
  const overrides = s.serverData.userOverrides ?? {};
  const runtime = overrides.runtime || "paper";
  const runtimeLabel = RUNTIME_LABELS[runtime] || runtime;

  return $("div", { class: "mc-tab mc-setup-tab" }, [
    // ── Tab header ──────────────────────────────────
    $("div", { class: "mc-tab-header" }, [
      $("span", { class: "mc-tab-header-icon" }, ["::"]),
      $("span", { class: "mc-tab-header-title" }, ["Setup"]),
      $("span", { class: "mc-tab-header-badge" }, [runtimeLabel]),
      $("span", { class: "mc-tab-header-sub" }, [
        s.mcVersion ? `v${s.mcVersion}` : "",
      ]),
    ]),
    // ── Scrollable body ──────────────────────────────
    $("div", { class: "mc-tab-body" }, [
      // Version section
      $("div", { class: "mc-section" }, [
        $("div", { class: "mc-section-header" }, [
          $("span", { class: "mc-section-title" }, ["Version"]),
        ]),
        $("div", { class: "mc-section-body" }, [
          renderVersionSelector(),
        ]),
      ]),
      // Configuration section
      $("div", { class: "mc-section" }, [
        $("div", { class: "mc-section-header" }, [
          $("span", { class: "mc-section-title" }, ["Configuration"]),
        ]),
        $("div", { class: "mc-section-body" }, [
          renderConfigGrid(),
        ]),
      ]),
      // Java section
      $("div", { class: "mc-section" }, [
        $("div", { class: "mc-section-header" }, [
          $("span", { class: "mc-section-title" }, ["Java Runtime"]),
        ]),
        $("div", { class: "mc-section-body" }, [
          renderJavaSection(),
        ]),
      ]),
      // Install
      $("div", { class: "mc-section" }, [
        $("div", { class: "mc-section-header" }, [
          $("span", { class: "mc-section-title" }, ["Installation"]),
        ]),
        $("div", { class: "mc-section-body" }, [
          renderInstallSection(),
        ]),
      ]),
      // World backup
      $("div", { class: "mc-section" }, [
        $("div", { class: "mc-section-header" }, [
          $("span", { class: "mc-section-title" }, ["World Backup"]),
        ]),
        $("div", { class: "mc-section-body" }, [
          renderBackupSection(),
        ]),
      ]),
    ]),
  ]);
}


/* ═════════════════════════════════════════════════
 *  CHAT TAB — full tab page
 * ═════════════════════════════════════════════════ */

function renderChatTab(): HTMLElement {
  const s = state!;
  const overrides = s.serverData.userOverrides ?? {};
  const runtime = overrides.runtime || "paper";
  const runtimeLabel = RUNTIME_LABELS[runtime] || runtime;

  return $("div", { class: "mc-tab mc-chat-tab" }, [
    // ── Status bar ───────────────────────────────────
    renderChatStatusBar(s.running, runtimeLabel, overrides),
    // ── Main layout ──────────────────────────────────
    $("div", { class: "mc-chat-layout" }, [
      // Chat column
      $("div", { class: "mc-chat-column" }, [
        renderChatLog(),
        renderChatInput(),
      ]),
      // Players column
      renderPlayersColumn(),
    ]),
  ]);
}

function renderChatStatusBar(
  running: boolean, runtimeLabel: string, overrides: Record<string, string>,
): HTMLElement {
  const s = state!;
  const items: HTMLElement[] = [];

  // Status dot + label
  const dot = $("span", {
    class: cls("mc-status-dot", running ? "mc-status-dot-running" : "mc-status-dot-stopped"),
  });
  const statusText = $("span", {
    class: "mc-status-text",
  }, [running ? "running" : "stopped"]);
  items.push($("span", { class: "mc-chat-status-item" }, [dot, statusText]));

  items.push($("div", { class: "mc-chat-status-divider" }));

  // Runtime
  items.push($("span", { class: "mc-chat-status-item" }, [runtimeLabel]));

  // Version
  if (overrides.mc_version) {
    items.push($("span", { class: "mc-chat-status-item" }, [`v${overrides.mc_version}`]));
  }

  // Port
  items.push($("span", { class: "mc-chat-status-item" }, [`Port ${overrides.server_port || "25565"}`]));

  // Player count (if running)
  if (running && s.playerCount) {
    items.push($("div", { class: "mc-chat-status-divider" }));
    items.push($("span", { class: "mc-chat-status-item" }, [`${s.playerCount} players`]));
  }

  // CPU / RAM gauges (when running — driven by get_instance_metrics)
  if (running) {
    items.push($("div", { class: "mc-chat-status-divider" }));
    items.push(renderMetricGauge("cpu", s.metrics.cpu));
    items.push(renderMetricGauge("ram", s.metrics.ram));
  }

  return $("div", { class: "mc-chat-status" }, items);
}

/**
 * Renders a tiny bar gauge with a label (cpu/ram) and percentage.
 * Color shifts: green < 70%, amber 70-85%, red > 85% — matches kern's
 * signal-high / warn-vector / fault-vector palette.
 */
function renderMetricGauge(label: string, value: number): HTMLElement {
  const pct = Math.round(value * 100);
  const color = value > 0.85 ? "#f54c4c" : value > 0.7 ? "#f5a04c" : "#4cf5a0";
  return $("span", {
    class: "mc-metric-gauge",
    "data-label": label,
    title: `${label.toUpperCase()}: ${pct}%`,
  }, [
    $("span", { class: "mc-metric-label" }, [label]),
    $("span", { class: "mc-metric-bar" }, [
      $("span", {
        class: "mc-metric-bar-fill",
        style: `width:${pct}%;background:${color}`,
      }),
    ]),
    $("span", { class: "mc-metric-pct" }, [`${pct}%`]),
  ]);
}

/**
 * Renders a determinate progress bar for downloads/installs.
 * Progress is 0-100 (percentage). Used inline during Java download and
 * server JAR download steps so the user sees real transfer progress
 * instead of an indeterminate spinner.
 */
function renderDownloadProgress(source: string, pct: number): HTMLElement {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = clamped >= 100 ? "#4cf5a0" : "#4cf5a0";
  return $("div", { class: "mc-dl-progress" }, [
    $("div", { class: "mc-dl-bar" }, [
      $("div", {
        class: "mc-dl-bar-fill",
        style: `width:${clamped}%;background:${color}`,
      }),
    ]),
    $("span", { class: "mc-dl-pct" }, [`${clamped}%`]),
  ]);
}

function renderChatLog(): HTMLElement {
  const s = state!;
  const log = $("div", { class: "mc-chat-log" });

  if (s.chatLines.length === 0) {
    log.appendChild($("div", { class: "mc-chat-empty" }, [
      s.running ? "Waiting for chat messages…" : "Start the server to see chat activity.",
    ]));
  } else {
    for (const line of s.chatLines.slice(-100)) {
      log.appendChild($("div", { class: "mc-chat-line" }, [line]));
    }
  }

  // Auto-scroll to bottom only when the user is already parked at the bottom —
  // otherwise leave their scroll position alone so reading history isn't yanked
  // back down by a poll- or log-driven re-render. The scroll listener below
  // keeps chatUserScrolledUp in sync as the user scrolls.
  log.addEventListener("scroll", () => {
    chatUserScrolledUp = log.scrollTop + log.clientHeight < log.scrollHeight - 24;
  });
  requestAnimationFrame(() => {
    if (chatUserScrolledUp) return;
    log.scrollTop = log.scrollHeight;
  });

  return log;
}

/** Tracks whether the chat log is scrolled away from the bottom (user reading
 *  history). Set by a scroll listener on the chat log so log-driven re-renders
 *  don't fight the user's position. */
let chatUserScrolledUp = false;

function renderChatInput(): HTMLElement {
  const s = state!;
  const row = $("div", { class: "mc-chat-input-row" });

  const input = $<HTMLInputElement>("input", {
    class: "mc-chat-input", type: "text",
    placeholder: s.running ? "Type a message or /command..." : "Server stopped — start to chat",
    value: s.chatInput,
  });
  input.disabled = !s.running;

  input.addEventListener("input", () => { if (state) state.chatInput = input.value; });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && state && state.running) {
      handleChatSubmit();
    }
  });

  const sendBtn = $("button", { class: "mc-btn mc-btn-sm", type: "button" }, ["send"]);
  sendBtn.tap((btn) => {
    btn.addEventListener("click", () => { if (state && state.running) handleChatSubmit(); });
  });
  if (!s.running) { sendBtn.setAttribute("disabled", "true"); }

  row.appendChild(input);
  row.appendChild(sendBtn);
  return row;
}

function handleChatSubmit(): void {
  if (!state) return;
  const msg = state.chatInput.trim();
  if (!msg) return;
  if (msg.startsWith("/")) {
    void sendCommand(msg.slice(1));
  } else {
    void sendChat(msg);
  }
  if (state) {
    state.chatInput = "";
    render();
  }
}

function renderPlayersColumn(): HTMLElement {
  const s = state!;
  const col = $("div", { class: "mc-players-column" });

  // Header
  const header = $("div", { class: "mc-players-header" }, [
    $("span", {}, [`Players${s.playerCount ? ` (${s.playerCount})` : ""}`]),
    $("button", { class: "mc-btn mc-btn-sm", type: "button" }, ["[ref]"]).tap((btn) => {
      btn.addEventListener("click", () => { void sendCommand("list"); });
    }),
  ]);
  col.appendChild(header);

  // Player list
  const list = $("div", { class: "mc-player-list" });
  if (s.players.length === 0) {
    list.appendChild($("div", { class: "mc-player-empty" }, ["No players online"]));
  } else {
    for (const name of s.players) {
      list.appendChild($("div", { class: "mc-player-item" }, [
        $("span", { class: "mc-player-dot" }),
        $("span", { class: "mc-player-name" }, [name]),
      ]));
    }
  }
  col.appendChild(list);

  return col;
}

/* ═════════════════════════════════════════════════
 *  MANAGE TAB — server.properties, whitelist, bans, ops
 * ═════════════════════════════════════════════════
 *
 * Uses existing file I/O commands (read_server_file / write_server_file)
 * for server.properties and ops.json, and console commands
 * (via write_stdin_to_instance) for whitelist/bans which are runtime-managed.
 */

function renderManageTab(): HTMLElement {
  const s = state!;
  return $("div", { class: "mc-tab mc-manage-tab" }, [
    // Tab header with sub-nav
    renderManageHeader(),
    // Sub-tab navigation
    renderManageNav(s.manageTab, (tab) => {
      if (!state) return;
      s.manageTab = tab;
      render();
    }),
    // Content area
    $("div", { class: "mc-manage-body" }, [
      s.manageTab === "properties" ? renderPropertiesPanel()
        : s.manageTab === "whitelist" ? renderWhitelistPanel()
          : s.manageTab === "bans" ? renderBansPanel()
            : renderOpsPanel(),
    ]),
  ]);
}

function renderManageHeader(): HTMLElement {
  const s = state!;
  const overrides = s.serverData.userOverrides ?? {};
  const runtime = overrides.runtime || "paper";
  return $("div", { class: "mc-tab-header" }, [
    $("span", { class: "mc-tab-header-icon" }, ["::"]),
    $("span", { class: "mc-tab-header-title" }, ["Manage"]),
    $("span", { class: "mc-tab-header-badge" }, [RUNTIME_LABELS[runtime] || runtime]),
    $("span", { class: "mc-tab-header-sub" }, [
      s.running ? "online" : "offline",
    ]),
  ]);
}

function renderManageNav(
  active: string,
  onSelect: (tab: "properties" | "whitelist" | "bans" | "ops") => void,
): HTMLElement {
  const tabs = [
    { id: "properties" as const, label: "Properties" },
    { id: "whitelist" as const, label: "Whitelist" },
    { id: "bans" as const, label: "Bans" },
    { id: "ops" as const, label: "Ops" },
  ];
  return $("div", { class: "mc-manage-nav" },
    tabs.map((t) =>
      $("button", {
        class: cls("mc-manage-nav-btn", active === t.id ? "mc-manage-nav-active" : ""),
        type: "button",
      }, [t.label]).tap((btn) => {
        btn.addEventListener("click", () => onSelect(t.id));
      })
    )
  );
}

// ─── Properties panel ───────────────────────────────────

function renderPropertiesPanel(): HTMLElement {
  const s = state!;
  if (!s.propsLoaded) {
    void loadServerProperties();
    return $("div", { class: "mc-manage-loading" }, ["Loading server.properties…"]);
  }

  const props = s.serverProps;
  const row = (label: string, key: string) =>
    $("div", { class: "mc-prop-row" }, [
      $("label", { class: "mc-prop-label" }, [label]),
      renderPropControl(key, props[key] ?? ""),
    ]);

  return $("div", { class: "mc-manage-content" }, [
    // Game settings
    $("div", { class: "mc-manage-section" }, [
      $("div", { class: "mc-manage-section-title" }, ["Game Settings"]),
      $("div", { class: "mc-manage-section-body" }, [
        row("MOTD", "motd"),
        row("Gamemode", "gamemode"),
        row("Difficulty", "difficulty"),
        row("Max Players", "max-players"),
        row("Level Seed", "level-seed"),
        row("Level Name", "level-name"),
      ]),
    ]),
    // Access & security
    $("div", { class: "mc-manage-section" }, [
      $("div", { class: "mc-manage-section-title" }, ["Access & Security"]),
      $("div", { class: "mc-manage-section-body" }, [
        row("Online Mode", "online-mode"),
        row("Allow Flight", "allow-flight"),
        row("PVP", "pvp"),
        row("Enforce Whitelist", "enforce-whitelist"),
        row("Spawn Protection", "spawn-protection"),
      ]),
    ]),
    // Network
    $("div", { class: "mc-manage-section" }, [
      $("div", { class: "mc-manage-section-title" }, ["Network"]),
      $("div", { class: "mc-manage-section-body" }, [
        row("Server Port", "server-port"),
        row("View Distance", "view-distance"),
        row("Simulation Distance", "simulation-distance"),
      ]),
    ]),
    // Save button
    $("div", { class: "mc-manage-actions" }, [
      $("button", { class: "mc-btn mc-btn-primary", type: "button" }, ["Save Properties"])
        .tap((btn) => { btn.addEventListener("click", () => void saveServerProperties()); }),
    ]),
  ]);
}

function renderPropControl(key: string, value: string): HTMLElement {
  // Boolean toggle keys
  const boolKeys = ["online-mode", "allow-flight", "pvp", "enforce-whitelist", "white-list"];
  if (boolKeys.includes(key)) {
    const toggle = $<HTMLInputElement>("input", { type: "checkbox", class: "mc-prop-checkbox" });
    toggle.checked = value.toLowerCase() === "true";
    toggle.addEventListener("change", () => {
      if (!state) return;
      state.serverProps[key] = toggle.checked ? "true" : "false";
      render();
    });
    return toggle;
  }

  // Select dropdowns for enumerated values
  if (key === "gamemode") {
    return renderPropSelect(key, value, ["survival", "creative", "adventure", "spectator"]);
  }
  if (key === "difficulty") {
    return renderPropSelect(key, value, ["peaceful", "easy", "normal", "hard"]);
  }

  // Text/number input (default)
  const input = $<HTMLInputElement>("input", {
    class: "mc-prop-input", type: "text", value,
  });
  input.addEventListener("input", () => {
    // Mutate state but DON'T re-render on each keystroke — a full rebuild of
    // the Properties panel would recreate this very input mid-typing and drop
    // focus. The value is read back from state on save.
    if (state) state.serverProps[key] = input.value;
  });
  return input;
}

function renderPropSelect(key: string, value: string, options: string[]): HTMLElement {
  const sel = $<HTMLSelectElement>("select", { class: "mc-prop-select" });
  for (const opt of options) {
    const optEl = $<HTMLOptionElement>("option", { value: opt }, [opt]);
    if (opt === value) optEl.selected = true;
    sel.appendChild(optEl);
  }
  sel.addEventListener("change", () => {
    if (!state) return;
    state.serverProps[key] = sel.value;
    render();
  });
  return sel;
}

async function loadServerProperties(): Promise<void> {
  if (!state || state.propsLoaded) return;
  try {
    const content = await state.hostAPI.invoke("read_server_file", {
      id: state.serverData.id, relPath: "server.properties",
    }) as string;
    if (!state) return;
    // Keep the raw line array (comments, ordering, unknown keys intact) so
    // saveServerProperties() can re-emit the file losslessly instead of
    // rewriting it from the ~14 fields the UI exposes.
    const rawLines = content.split("\n");
    const props: Record<string, string> = {};
    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      props[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
    state.serverPropsRaw = rawLines;
    state.serverProps = props;
    state.propsLoaded = true;
  } catch {
    if (!state) return;
    // File doesn't exist yet — seed with defaults so the UI is still usable.
    // serverPropsRaw is empty, so the first save will emit the edited defaults
    // as a fresh file (plus a header comment).
    state.serverPropsRaw = [];
    state.serverProps = defaultServerProperties();
    state.propsLoaded = true;
  }
  render();
}

function defaultServerProperties(): Record<string, string> {
  return {
    "motd": "A Minecraft Server",
    "gamemode": "survival",
    "difficulty": "easy",
    "max-players": "20",
    "online-mode": "true",
    "allow-flight": "false",
    "pvp": "true",
    "enforce-whitelist": "false",
    "white-list": "false",
    "spawn-protection": "16",
    "server-port": "25565",
    "view-distance": "10",
    "simulation-distance": "10",
    "level-name": "world",
    "level-seed": "",
  };
}

async function saveServerProperties(): Promise<void> {
  if (!state) return;
  // Re-emit the original file losslessly: substitute only the values for keys
  // present in the edited map, leaving comments, ordering, and unknown keys
  // untouched. This preserves the ~60 vanilla keys the UI doesn't expose and
  // avoids corrupting advanced users' configs.
  const edited = state.serverProps;
  const emitted = state.serverPropsRaw.map((line) => {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) return line; // comment, blank, or malformed — verbatim
    const key = line.slice(0, eqIdx).trim();
    if (key in edited) return `${key}=${edited[key]}`;
    return line;
  });

  // If the raw array was empty (file didn't exist), emit the edited defaults
  // as a fresh file. Also append any newly-edited keys that weren't in the
  // original file (rare, but keeps edits from being silently dropped).
  let out: string[];
  if (state.serverPropsRaw.length === 0) {
    out = ["# Minecraft server properties", `# Created by Kern minecraft_java plugin — ${new Date().toISOString()}`];
    for (const [key, value] of Object.entries(edited)) out.push(`${key}=${value}`);
  } else {
    out = emitted;
    const present = new Set(state.serverPropsRaw.map((l) => {
      const eq = l.indexOf("=");
      return eq === -1 ? "" : l.slice(0, eq).trim();
    }));
    for (const [key, value] of Object.entries(edited)) {
      if (!present.has(key)) out.push(`${key}=${value}`);
    }
  }

  try {
    await state.hostAPI.invoke("write_server_file", {
      id: state.serverData.id, relPath: "server.properties",
      content: out.join("\n") + "\n",
    });
    if (!state) return;
    // Refresh the raw snapshot so a subsequent save stays lossless and the
    // newly-added/edited values round-trip correctly.
    state.serverPropsRaw = out;
    pushManageFeedback("[ok]  server.properties saved");
    render();
  } catch (err) {
    if (!state) return;
    pushManageFeedback(`[err]  Failed to save: ${err}`);
    render();
  }
}

// Feedback line for manage actions
let manageFeedback = "";
function pushManageFeedback(msg: string): void {
  manageFeedback = msg;
}

// ─── Whitelist panel ────────────────────────────────────

function renderWhitelistPanel(): HTMLElement {
  const s = state!;
  const canEdit = s.running;

  // Load once — ensureListsLoaded calls render() via log parsing,
  // so triggering it on every render would create an infinite loop.
  if (!listsLoaded) {
    listsLoaded = true;
    void ensureListsLoaded();
    return $("div", { class: "mc-manage-loading" }, ["Loading whitelist…"]);
  }

  const addRow = $("div", { class: "mc-list-add-row" }, [
    $<HTMLInputElement>("input", {
      class: "mc-list-add-input", type: "text",
      placeholder: canEdit ? "Player name…" : "Start the server to manage whitelist",
    }).tap((input) => {
      if (!canEdit) input.disabled = true;
    }),
    $<HTMLButtonElement>("button", { class: "mc-btn mc-btn-sm", type: "button" }, ["+ add"]).tap((btn) => {
      if (!canEdit) btn.disabled = true;
      btn.addEventListener("click", async () => {
        const input = btn.previousSibling as HTMLInputElement;
        const name = input.value.trim();
        if (!name || !state || !state.running) return;
        await sendCommand(`whitelist add ${name}`);
        input.value = "";
        await refreshLists();
        pushManageFeedback(`[ok]  Added ${name} to whitelist`);
        render();
      });
    }),
  ]);

  const entries = s.whitelist.length === 0
    ? [$("div", { class: "mc-list-empty" }, ["Whitelist is empty (or not yet loaded)"])]
    : s.whitelist.map((name) =>
      $("div", { class: "mc-list-item" }, [
        $("span", { class: "mc-list-item-name" }, [name]),
        $<HTMLButtonElement>("button", { class: "mc-btn mc-btn-sm mc-btn-danger", type: "button" }, ["x"]).tap((btn) => {
          if (!canEdit) btn.disabled = true;
          btn.addEventListener("click", async () => {
            if (!state || !state.running) return;
            await sendCommand(`whitelist remove ${name}`);
            await refreshLists();
            pushManageFeedback(`[err]  Removed ${name} from whitelist`);
            render();
          });
        }),
      ])
    );

  return $("div", { class: "mc-manage-content" }, [
    $("div", { class: "mc-manage-section" }, [
      $("div", { class: "mc-manage-section-title" }, [
        "Whitelist",
        $("span", { class: "mc-list-badge" }, [`${s.whitelist.length}`]),
      ]),
      $("div", { class: "mc-manage-section-body" }, [
        // Enable/disable toggle
        $("div", { class: "mc-prop-row" }, [
          $("label", { class: "mc-prop-label" }, ["Whitelist Enabled"]),
          (() => {
            const toggle = $<HTMLInputElement>("input", { type: "checkbox", class: "mc-prop-checkbox" });
            toggle.checked = s.whitelistEnabled;
            if (!canEdit) toggle.disabled = true;
            toggle.addEventListener("change", async () => {
              if (!state || !state.running) return;
              await sendCommand(toggle.checked ? "whitelist on" : "whitelist off");
              pushManageFeedback(toggle.checked ? "[ok]  Whitelist enabled" : "[disabled]  Whitelist disabled");
              render();
            });
            return toggle;
          })(),
        ]),
        addRow,
      ]),
    ]),
    $("div", { class: "mc-list-table" }, entries),
    renderManageFeedback(),
  ]);
}

// ─── Bans panel ─────────────────────────────────────────

function renderBansPanel(): HTMLElement {
  const s = state!;
  const canEdit = s.running;

  // Guard against re-fetching on every render (same pattern as ops panel).
  // Data is already loaded if listsLoaded is true.
  if (!listsLoaded) {
    listsLoaded = true;
    void ensureListsLoaded();
    return $("div", { class: "mc-manage-loading" }, ["Loading ban list…"]);
  }

  const entries = s.bans.length === 0
    ? [$("div", { class: "mc-list-empty" }, ["No banned players"])]
    : s.bans.map((entry) => {
      const name = entry.split(" ")[0]; // "player — reason" format
      return $("div", { class: "mc-list-item" }, [
        $("span", { class: "mc-list-item-name" }, [entry]),
        $<HTMLButtonElement>("button", { class: "mc-btn mc-btn-sm", type: "button" }, ["pardon"]).tap((btn) => {
          if (!canEdit) btn.disabled = true;
          btn.addEventListener("click", async () => {
            if (!state || !state.running) return;
            await sendCommand(`pardon ${name}`);
            await refreshLists();
            pushManageFeedback(`[ok]  Pardoned ${name}`);
            render();
          });
        }),
      ]);
    });

  return $("div", { class: "mc-manage-content" }, [
    $("div", { class: "mc-manage-section" }, [
      $("div", { class: "mc-manage-section-title" }, [
        "Banned Players",
        $("span", { class: "mc-list-badge" }, [`${s.bans.length}`]),
      ]),
      $("div", { class: "mc-manage-section-body" }, [
        canEdit
          ? $("div", { class: "mc-list-hint" }, ["Use /ban <player> in the chat console to issue new bans."])
          : $("div", { class: "mc-list-hint" }, ["Start the server to manage bans."]),
      ]),
    ]),
    $("div", { class: "mc-list-table" }, entries),
    renderManageFeedback(),
  ]);
}

// ─── Ops panel ──────────────────────────────────────────

function renderOpsPanel(): HTMLElement {
  const s = state!;
  const canEdit = s.running;

  // Load once — loadOpsList calls render(), so triggering it on every render
  // would create an infinite loop.
  if (!opsListLoaded) {
    opsListLoaded = true;
    void loadOpsList();
    return $("div", { class: "mc-manage-loading" }, ["Loading operators…"]);
  }

  const addRow = $("div", { class: "mc-list-add-row" }, [
    $<HTMLInputElement>("input", {
      class: "mc-list-add-input", type: "text",
      placeholder: canEdit ? "Player name…" : "Start the server to manage ops",
    }).tap((input) => { if (!canEdit) input.disabled = true; }),
    $<HTMLButtonElement>("button", { class: "mc-btn mc-btn-sm", type: "button" }, ["+ op"]).tap((btn) => {
      if (!canEdit) btn.disabled = true;
      btn.addEventListener("click", async () => {
        const input = btn.previousSibling as HTMLInputElement;
        const name = input.value.trim();
        if (!name || !state || !state.running) return;
        await sendCommand(`op ${name}`);
        input.value = "";
        await loadOpsList();
        pushManageFeedback(`[ok]  Opped ${name}`);
        render();
      });
    }),
  ]);

  const entries = s.ops.length === 0
    ? [$("div", { class: "mc-list-empty" }, ["No operators defined"])]
    : s.ops.map((name) =>
      $("div", { class: "mc-list-item" }, [
        $("span", { class: "mc-list-item-name mc-op-badge" }, [name]),
        $<HTMLButtonElement>("button", { class: "mc-btn mc-btn-sm mc-btn-danger", type: "button" }, ["x"]).tap((btn) => {
          if (!canEdit) btn.disabled = true;
          btn.addEventListener("click", async () => {
            if (!state || !state.running) return;
            await sendCommand(`deop ${name}`);
            await loadOpsList();
            pushManageFeedback(`[err]  De-opped ${name}`);
            render();
          });
        }),
      ])
    );

  return $("div", { class: "mc-manage-content" }, [
    $("div", { class: "mc-manage-section" }, [
      $("div", { class: "mc-manage-section-title" }, [
        "Operators",
        $("span", { class: "mc-list-badge" }, [`${s.ops.length}`]),
      ]),
      $("div", { class: "mc-manage-section-body" }, [
        canEdit
          ? $("div", { class: "mc-list-hint" }, ["Use /deop <player> in chat or remove here to revoke operator status."])
          : $("div", { class: "mc-list-hint" }, ["Start the server to manage operators."]),
        addRow,
      ]),
    ]),
    $("div", { class: "mc-list-table" }, entries),
    renderManageFeedback(),
  ]);
}

function renderManageFeedback(): HTMLElement {
  if (!manageFeedback) return $("span", { style: "display:none" });
  const isOk = manageFeedback.startsWith("[ok]");
  return $("div", {
    class: cls("mc-manage-feedback", isOk ? "mc-manage-feedback-ok" : "mc-manage-feedback-warn"),
  }, [manageFeedback]);
}

// ─── Shared list loading ────────────────────────────────

async function ensureListsLoaded(): Promise<void> {
  if (!state) return;
  // Whitelist/bans are read from the running server's console output.
  // We trigger the commands and parse their output from the log stream.
  if (state.running) {
    await sendCommand("whitelist list");
    await sendCommand("banlist");
  }
}

async function refreshLists(): Promise<void> {
  if (!state?.running) return;
  listsLoaded = false;
  await sendCommand("whitelist list");
  await sendCommand("banlist");
  listsLoaded = true;
}

async function loadOpsList(): Promise<void> {
  if (!state) return;
  try {
    const raw = await state.hostAPI.invoke("read_server_file", {
      id: state.serverData.id, relPath: "ops.json",
    }) as string;
    if (!state) return;
    const parsed: unknown = JSON.parse(raw);
    // ops.json is normally an array; coerce defensively so a non-array (empty
    // file, object, null) doesn't throw on .map — renderOpsPanel reads .length.
    const data: Array<{ name: string }> = Array.isArray(parsed) ? parsed : [];
    state.ops = data.map((o) => o.name).sort();
  } catch {
    if (!state) return;
    state.ops = [];
  }
  render();
}

// ─── Hook log parsing for whitelist/bans ────────────────
// Extends handleLogLine behavior for manage-tab data sources.

function parseListResponse(line: string): void {
  if (!state) return;

  // Whitelist responses from `/whitelist list`:
  //   "There are 3 whitelisted players: Alice, Bob, Charlie"  (enabled, has entries)
  //   "There are 0 whitelisted players"                        (enabled, no entries)
  //   "Whitelist is disabled"                                  (explicitly off)
  const wlMatch = line.match(/\]: There are (\d+) whitelisted players?:(.*)$/);
  if (wlMatch) {
    const names = wlMatch[2].trim();
    state.whitelist = names ? names.split(/[,，]\s*/).map((n) => n.trim()) : [];
    state.whitelistEnabled = true;
  }
  const wlOffMatch = line.match(/\]:.*(?:Whitelist|whitelist).*(disabled|not enabled|is off)/i);
  if (wlOffMatch) {
    state.whitelistEnabled = false;
  }

  // Ban list responses from `/banlist`:
  //   "There are 2 banned players: Alice - reason, Bob"
  //   "There are 0 banned players"
  const banMatch = line.match(/\]: There are (\d+) banned players?:(.*)$/);
  if (banMatch) {
    const raw = banMatch[2].trim();
    if (!raw) { state.bans = []; return; }
    // Entries may have " — reason" or " - reason" suffixes. Strip those for the name.
    state.bans = raw.split(/[,，]\s*/).map((entry) => {
      const trimmed = entry.trim();
      const dashIdx = trimmed.search(/\s[-—–]\s/);
      return dashIdx > 0 ? trimmed.slice(0, dashIdx).trim() : trimmed;
    });
  }
}


/* ═════════════════════════════════════════════════
 *  Backup / Restore (toolbar + Setup section)
 * ════════════════════════════════════════─────────── */

async function runBackupWithFeedback(): Promise<void> {
  if (!state || state.backupRunning) return;
  state.backupRunning = true;
  render();
  try {
    const name = await state.hostAPI.invoke("backup_world", { id: state.serverData.id }) as string;
    if (!state) return;
    pushManageFeedback(`[ok]  Backup saved: ${name}`);
    await loadBackups();
  } catch (err) {
    if (!state) return;
    pushManageFeedback(`[err]  Backup failed: ${err}`);
  } finally {
    if (state) state.backupRunning = false;
    render();
  }
}

async function loadBackups(): Promise<void> {
  if (!state) return;
  state.backupLoading = true;
  try {
    const list = await state.hostAPI.invoke("list_backups", {
      id: state.serverData.id,
    }) as Array<{ name: string; size: number }> | null | undefined;
    if (!state) return;
    // Coerce: a non-array (null/undefined from an unexpected backend response)
    // must not poison state.backups — renderBackupSection reads .length on it,
    // and a null there throws and breaks the entire Setup tab's render.
    state.backups = Array.isArray(list) ? list : [];
  } catch {
    if (!state) return;
    state.backups = [];
  }
  state.backupLoading = false;
  state.backupsLoaded = true;
  render();
}

async function restoreBackup(name: string): Promise<void> {
  if (!state) return;
  // Safety: the Rust side creates a pre-restore archive automatically.
  try {
    await state.hostAPI.invoke("restore_world", { id: state.serverData.id, backupName: name });
    if (!state) return;
    pushManageFeedback(`[ok]  Restored from ${name}`);
    await loadBackups();
    render();
  } catch (err) {
    if (!state) return;
    pushManageFeedback(`[err]  Restore failed: ${err}`);
    render();
  }
}

async function removeBackup(name: string): Promise<void> {
  if (!state) return;
  try {
    await state.hostAPI.invoke("delete_backup", { id: state.serverData.id, backupName: name });
    if (!state) return;
    await loadBackups();
    render();
  } catch { /* non-fatal */ }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function renderBackupSection(): HTMLElement {
  const s = state!;

  // Lazy-load the backup list exactly once. The old guard keyed on
  // `backups.length === 0`, which re-fired loadBackups() forever whenever the
  // list was empty (each load sets backups=[] then re-renders → re-trigger).
  if (!s.backupsLoaded && !s.backupLoading) {
    void loadBackups();
  }

  const backupBtn = $<HTMLButtonElement>("button", {
    class: cls("mc-btn", "mc-btn-primary", s.backupRunning ? "mc-btn-disabled" : ""),
    type: "button",
  }, [s.backupRunning ? "backup running…" : "Backup Now"]);
  backupBtn.addEventListener("click", () => { if (!s.backupRunning) void runBackupWithFeedback(); });

  const feedbackEl = manageFeedback
    ? $("div", { class: "mc-backup-feedback" }, [manageFeedback])
    : null;

  const entries = s.backups.length === 0
    ? [$("div", { class: "mc-list-empty" }, ["No backups yet — click Backup Now to create one."])]
    : s.backups.map((b) =>
      $("div", { class: "mc-backup-item" }, [
        $("div", { class: "mc-backup-info" }, [
          $("span", { class: "mc-backup-name" }, [b.name]),
          $("span", { class: "mc-backup-size" }, [formatSize(b.size)]),
        ]),
        $("div", { class: "mc-backup-actions" }, [
          $<HTMLButtonElement>("button", { class: "mc-btn mc-btn-sm", type: "button" }, ["restore"])
            .tap((btn) => btn.addEventListener("click", () => void restoreBackup(b.name))),
          $<HTMLButtonElement>("button", { class: "mc-btn mc-btn-sm mc-btn-danger", type: "button" }, ["x"])
            .tap((btn) => btn.addEventListener("click", () => void removeBackup(b.name))),
        ]),
      ])
    );

  return $("div", {}, [
    $("div", { class: "mc-backup-intro" }, [
      $("p", { class: "mc-backup-hint" }, [
        "Create a zip backup of the world directory. It's recommended to run ",
        $("code", {}, ["save-all"]),
        " in the chat console first to flush chunks.",
      ]),
      backupBtn,
    ]),
    feedbackEl ?? $("span", { style: "display:none" }),
    $("div", { class: "mc-list-table" }, entries),
  ]);
}


/* ═════════════════════════════════════════════════
 *  Shared component render functions
 * ═════════════════════════════════════════════════ */

function renderVersionSelector(): HTMLElement {
  const s = state!;
  const overrides = s.serverData.userOverrides ?? {};
  const runtime = overrides.runtime || "paper";

  const select = $<HTMLSelectElement>("select", {
    class: cls("mc-ver-select", s.fetchingVersions ? "mc-ver-select" : ""),
    disabled: s.fetchingVersions ? "true" : undefined,
  });

  if (s.fetchingVersions) {
    select.appendChild($<HTMLOptionElement>("option", { value: "" }, ["Loading versions…"]));
  } else if (s.mcVersions.length === 0) {
    select.appendChild($<HTMLOptionElement>("option", { value: "" }, [s.mcVersion || "No versions found"]));
  } else {
    for (const v of s.mcVersions) {
      const isCurrent = v.version === s.mcVersion;
      const suffix = v.type !== "release" ? ` (${v.type})` : "";
      const opt = $<HTMLOptionElement>("option", { value: v.version }, [`${v.version}${suffix}`]);
      if (isCurrent) opt.selected = true;
      select.appendChild(opt);
    }
    if (!select.value && s.mcVersions.length > 0) {
      select.value = s.mcVersions[0].version;
      if (state) state.mcVersion = s.mcVersions[0].version;
    }
  }

  select.addEventListener("change", () => {
    if (!state) return;
    state.mcVersion = select.value;
    // Persist like the RAM and Java pickers do — otherwise the selected
    // version reverts on reload (the manifest's {{userOverrides.mc_version}}
    // and the host's default-selection both read the persisted value).
    persistOverride(state.hostAPI, state.serverData, "mc_version", select.value);
    state.serverData = {
      ...state.serverData,
      userOverrides: { ...(state.serverData.userOverrides ?? {}), mc_version: select.value },
    };
    // The required Java version tracks the MC version, so recompute the
    // Java-section compatibility hints live instead of waiting until reload.
    state.javaMajor = mcVersionToJavaVersion(select.value || "1.21");
    state.javaMissing = state.javaInstalls.length === 0 ||
      !state.javaInstalls.some((j) => j.majorVersion >= state!.javaMajor);
    render();
  });

  const toggleId = "mc-snap-toggle";
  const toggle = $("label", { class: "mc-toggle", for: toggleId }, [
    $("input", { type: "checkbox", id: toggleId, class: "mc-toggle-input" }).tap((cb) => {
      (cb as HTMLInputElement).checked = s.includeSnapshots;
      cb.addEventListener("change", async () => {
        if (!state) return;
        state.includeSnapshots = (cb as HTMLInputElement).checked;
        await fetchAndSetVersions(runtime, (cb as HTMLInputElement).checked);
      });
    }),
    $("span", { class: "mc-toggle-track" }, [$("span", { class: "mc-toggle-knob" })]),
    $("span", { class: "mc-toggle-label" }, [
      s.includeSnapshots ? "Snapshots ON" : "Snapshots OFF",
    ]),
  ]);

  const refreshBtn = $<HTMLButtonElement>("button", {
    class: cls("mc-btn", "mc-btn-sm", s.fetchingVersions ? "mc-btn-disabled" : ""),
    type: "button",
  });
  refreshBtn.textContent = "[ref]";
  refreshBtn.addEventListener("click", async () => {
    if (!state || state.fetchingVersions) return;
    await fetchAndSetVersions(runtime, state.includeSnapshots);
  });
  if (s.fetchingVersions) { refreshBtn.setAttribute("disabled", "true"); }

  const versionRow = $("div", { class: "mc-version-row" }, [
    $("span", { class: "mc-ver-badge" }, [RUNTIME_LABELS[runtime] || runtime]),
    s.fetchingVersions
      ? $("span", { class: "mc-ver-spinner" }, ["◳"])
      : $("span", { style: "display:none" }),
    select, toggle, refreshBtn,
  ]);

  const hintText = s.fetchingVersions
    ? "Fetching available versions…"
    : s.mcVersions.length > 0
      ? `${s.mcVersions.length} version(s) available`
      : "Could not fetch versions. Check your internet connection.";

  return $("div", {}, [
    versionRow,
    $("span", { class: "mc-ver-hint" }, [hintText]),
  ]);
}

function renderConfigGrid(): HTMLElement {
  const s = state!;
  const overrides = s.serverData.userOverrides ?? {};
  const runtime = overrides.runtime || "paper";
  const runtimeLabel = RUNTIME_LABELS[runtime] || runtime;
  const recommendedJvm = getDefaultJvmArgs(runtime);
  const currentJvm = overrides.jvm_args || recommendedJvm;
  const usingRecommended = currentJvm === recommendedJvm;
  const currentHeap = getHeapFromJvmArgs(currentJvm) || getDefaultHeapGb(runtime);

  const ramSelect = $<HTMLSelectElement>("select", { class: "mc-select" });
  for (const gb of RAM_PRESETS) {
    const opt = $<HTMLOptionElement>("option", { value: String(gb) }, [`${gb} GB`]);
    if (gb === currentHeap) opt.selected = true;
    ramSelect.appendChild(opt);
  }
  ramSelect.addEventListener("change", () => {
    if (!state) return;
    const newHeap = parseInt(ramSelect.value, 10);
    const baseArgs = currentJvm === recommendedJvm ? getDefaultJvmArgs(runtime) : currentJvm;
    const newArgs = setHeapInJvmArgs(baseArgs, newHeap);
    persistOverride(state.hostAPI, state.serverData, "jvm_args", newArgs);
    const newOverrides = { ...overrides, jvm_args: newArgs };
    state.serverData = { ...state.serverData, userOverrides: newOverrides };
    render();
  });

  return $("div", { class: "mc-config-grid" }, [
    $("div", { class: "mc-config-item" }, [
      $("span", { class: "mc-config-label" }, ["Server Port"]),
      $("span", { class: "mc-config-value" }, [overrides.server_port || "25565"]),
    ]),
    $("div", { class: "mc-config-item" }, [
      $("span", { class: "mc-config-label" }, ["RAM"]),
      ramSelect,
    ]),
    $("div", { class: "mc-config-item mc-config-item-full" }, [
      $("span", { class: "mc-config-label" }, [
        "JVM Args",
        $("span", { class: "mc-config-badge" }, [`${heapTier(runtime)} · ${runtimeLabel}`]),
      ]),
      $("code", { class: cls("mc-jvm-flags", usingRecommended ? "" : "mc-jvm-custom") }, [currentJvm]),
    ]),
  ]);
}

function renderJavaSection(): HTMLElement {
  const s = state!;
  const recommended = mcVersionToJavaVersion(s.mcVersion);

  const options = s.javaInstalls.map((j) => {
    const isRec = j.majorVersion >= recommended;
    return {
      value: j.path,
      label: `Java ${j.majorVersion} (${j.version})${isRec ? " ✓" : ""} — ${j.path}`,
      selected: j.path === s.selectedJava,
    };
  });

  if (!options.find((o) => o.value === "java")) {
    options.unshift({ value: "java", label: "java (on PATH)", selected: s.selectedJava === "java" });
  }

  const select = $<HTMLSelectElement>("select", { class: "mc-java-select" });
  for (const opt of options) {
    const el = $<HTMLOptionElement>("option", { value: opt.value }, [opt.label]);
    if (opt.selected) el.selected = true;
    select.appendChild(el);
  }
  select.addEventListener("change", () => {
    if (!state) return;
    state.selectedJava = select.value;
    persistOverride(state.hostAPI, state.serverData, "java_path", select.value);
  });

  const installBtn = $<HTMLButtonElement>("button", {
    class: cls("mc-btn", "mc-btn-sm", s.downloadingJava ? "mc-btn-disabled" : ""),
    type: "button",
  });
  installBtn.textContent = s.downloadingJava ? "downloading…" : `install Java ${s.javaMajor}`;
  if (s.downloadingJava) { installBtn.setAttribute("disabled", "true"); }

  installBtn.addEventListener("click", () => {
    if (!state || state.downloadingJava) return;
    state.downloadingJava = true;
    state.downloadProgress = 0;
    render();
    const destDir = `${state.hostAPI.serverPath}/jdk`;
    downloadJava(state.javaMajor, destDir, state.hostAPI.invoke, state.hostAPI.listen, {
      onProgress(bytes, total) {
        if (!state || total <= 0) return;
        state.downloadProgress = Math.round((bytes / total) * 100);
        render();
      },
      onComplete(installed) {
        if (!state) return;
        state.downloadingJava = false;
        state.downloadProgress = 0;
        const fresh: JavaInstall = installed
          ? { path: installed.path, version: installed.version, majorVersion: installed.majorVersion }
          : { path: `${destDir}/bin/java`, version: `${state.javaMajor}.0.0`, majorVersion: state.javaMajor };
        detectJava(state.hostAPI.invoke)
          .then((detected) => {
            if (!state) return;
            const merged = [fresh];
            for (const j of detected) { if (!merged.some((m) => m.path === j.path)) merged.push(j); }
            state.javaInstalls = merged; state.javaMissing = false;
            state.selectedJava = fresh.path;
            persistOverride(state.hostAPI, state.serverData, "java_path", fresh.path);
            render();
          })
          .catch(() => {
            if (!state) return;
            state.javaInstalls = [fresh]; state.javaMissing = false;
            state.selectedJava = fresh.path; render();
          });
      },
      onError(err) {
        if (!state) return;
        state.downloadingJava = false;
        state.downloadProgress = 0;
        state.installLog.push(`[err]  Java install failed: ${err}`);
        render();
      },
    });
  });

  const javaRow = $("div", { class: "mc-java-row" }, [
    select,
    $("button", { class: "mc-btn mc-btn-sm", type: "button" }, ["[ref]"]).tap((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const installs = await detectJava(state!.hostAPI.invoke);
          if (!state) return;
          state.javaInstalls = installs;
          state.javaMissing = !installs.some((j) => j.majorVersion >= state!.javaMajor);
          render();
        } catch { /* ignore */ }
      });
    }),
    $<HTMLInputElement>("input", {
      class: "mc-java-path-input", type: "text",
      placeholder: "Or type a Java path…", value: s.selectedJava,
    }).tap((input) => {
      // Don't re-render on each keystroke — would recreate the input and drop
      // focus. Persist on blur / change instead.
      input.addEventListener("input", () => { if (state) state.selectedJava = input.value; });
      input.addEventListener("change", () => {
        if (state) persistOverride(state.hostAPI, state.serverData, "java_path", input.value);
      });
    }),
  ]);

  const promptEl: HTMLElement | null =
    s.javaMissing && !s.downloadingJava
      ? $("div", { class: "mc-java-missing" }, [
        $("span", { class: "mc-java-warn" }, [
          `(!) No Java ${s.javaMajor}+ found — required for MC ${s.mcVersion || "selected"}. `,
        ]),
        installBtn,
      ])
      : null;

  const downloadingHint: HTMLElement | null =
    s.downloadingJava
      ? $("div", { class: "mc-java-downloading" }, [
        installBtn,
        renderDownloadProgress("java", s.downloadProgress),
      ])
      : null;

  return $("div", {}, [
    javaRow,
    promptEl ?? $("span", { style: "display:none" }),
    downloadingHint ?? $("span", { style: "display:none" }),
    javaInstallsSummary(s.javaInstalls, s.mcVersion),
  ]);
}

function javaInstallsSummary(installs: JavaInstall[], mcVersion: string): HTMLElement {
  const recommended = mcVersionToJavaVersion(mcVersion);
  const filtered = filterJavaForMc(installs, mcVersion);
  if (installs.length === 0) {
    return $("p", { class: "mc-java-warn" }, ["(!) No Java installations detected. Type a path manually."]);
  }
  return $("p", { class: "mc-java-info" }, [
    `Found ${installs.length} Java installation(s), ${filtered.length} compatible with MC ${mcVersion} (Java ${recommended}+).`,
  ]);
}

function renderInstallSection(): HTMLElement {
  const s = state!;
  const overrides = s.serverData.userOverrides ?? {};
  const runtime = overrides.runtime || "paper";
  const canInstall = !s.fetchingVersions && s.mcVersion !== "" && !s.installing;

  const btn = $<HTMLButtonElement>("button", {
    class: cls("mc-btn mc-btn-primary mc-install-btn-stretch", canInstall ? "" : "mc-btn-disabled"),
    type: "button",
  });
  btn.textContent = s.installing
    ? s.installError ? "retry install" : "installing…"
    : s.installSteps.some((st) => st.status === "done") ? "re-install" : "install server";
  if (!canInstall) { btn.setAttribute("disabled", "true"); }

  btn.addEventListener("click", () => {
    if (!state || !canInstall) return;
    state.installing = true; state.installSteps = []; state.installLog = []; state.installError = false;
    render();
    const acceptEula = (overrides.accept_eula === "true");
    runInstall(state.serverData.id, runtime, state.mcVersion, state.selectedJava, acceptEula, overrides.jvm_args, state.hostAPI, {
      onStepUpdate(steps) { if (!state) return; state.installSteps = steps; render(); },
      onLog(line) {
        if (!state) return;
        state.installLog.push(line);
        if (state.installLog.length > 200) state.installLog = state.installLog.slice(-200);
        render();
      },
      onComplete(success, message) {
        if (!state) return;
        state.installing = false; state.installError = !success;
        state.installLog.push(success ? `[ok]  ${message}` : `[err]  ${message}`);
        render();
      },
    }).catch((err: unknown) => {
      if (!state) return;
      state.installing = false; state.installError = true;
      state.installLog.push(`[err]  ${err}`); render();
    });
  });

  const stepList: HTMLElement | null =
    s.installSteps.length > 0
      ? $("div", { class: "mc-install-steps" },
        s.installSteps.map((st) => {
          const message = st.message ? ` — ${st.message}` : "";
          const dotColor =
            st.status === "running" ? "signal-high" :
              st.status === "done" ? "text-zinc-500" :
                st.status === "error" ? "fault-vector" : "text-zinc-700";
          const isRunningDownload = st.status === "running" && /download/i.test(st.label);
          const stepChildren: (string | HTMLElement)[] = [
            $("span", { class: `mc-install-dot ${dotColor}` }, [">"]),
            $("div", { class: "mc-install-label" }, [
              $("span", {}, [`${st.label}${message}`]),
            ]),
          ];
          if (isRunningDownload) {
            // Read the percentage off the step itself (installer.ts sets
            // downloadPct on the step), not state.downloadProgress — which is
            // driven by the unrelated Java-download path and would otherwise
            // leave this bar permanently stuck at 0%.
            stepChildren.push(renderDownloadProgress("install", st.downloadPct ?? 0));
          }
          return $("div", { class: "mc-install-step" }, stepChildren);
        }),
      )
      : null;

  const logTail: HTMLElement | null =
    s.installLog.length > 0
      ? $("div", { class: "mc-install-log" },
        s.installLog.slice(-6).map((line) => $("div", { class: "mc-install-log-line" }, [line])),
      )
      : null;

  return $("div", {}, [
    $("div", { class: "mc-install-row" }, [
      btn,
      s.installing
        ? $("span", { class: "mc-install-spinner" }, ["◳ working…"])
        : $("span", { class: "mc-install-hint" }, [
          s.mcVersion
            ? `Downloads + configures ${RUNTIME_LABELS[overrides.runtime || "paper"] || overrides.runtime || "paper"} ${s.mcVersion}`
            : "Select a Minecraft version to install",
        ]),
    ]),
    stepList ?? $("span", { style: "display:none" }),
    logTail ?? $("span", { style: "display:none" }),
  ]);
}
