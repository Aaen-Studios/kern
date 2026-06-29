/**
 * main.ts - Plugin mount entry point.
 *
 * Exports mount() and unmount() as required by the Kern plugin system.
 *
 * Layout: two collapsible sections -
 *   1. Setup  - the installer wizard (version, Java, RAM, install button)
 *   2. Server - the live dashboard (chat, players, quick commands)
 *
 * The Server section subscribes to backend events via hostAPI.listen() to
 * receive live log output and status changes from the running MC process.
 */

import type { ServerInstance, HostAPI, JavaInstall, InstallStep, UnlistenFn, StatusPayload } from "./types";
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
  setupExpanded: boolean;
  serverExpanded: boolean;
  running: boolean;
  chatLines: string[];
  players: string[];
  playerCount: string;
  chatInput: string;
  unlistenLog: UnlistenFn | null;
  unlistenStatus: UnlistenFn | null;
  pollTimer: ReturnType<typeof setInterval> | null;
}

let state: WizardState | null = null;
let rootEl: HTMLElement | null = null;


function $<T extends HTMLElement = HTMLDivElement>(
  tag: string, attrs: Record<string, string> = {}, children: (string | HTMLElement)[] = [],
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
  Element.prototype.tap = function<T extends Element>(this: T, fn: (el: T) => void): T { fn(this); return this; };
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


export async function mount(
  mountPoint: HTMLElement, serverData: ServerInstance, hostAPI: HostAPI,
): Promise<void> {
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
    downloadingJava: false, setupExpanded: true, serverExpanded: true,
    running: false, chatLines: [], players: [], playerCount: "",
    chatInput: "", unlistenLog: null, unlistenStatus: null, pollTimer: null,
  };

  render();
  await fetchAndSetVersions(runtime, false);
  subscribeToServer();
  void checkRunning();
}

export function unmount(): void {
  if (state?.unlistenLog) { state.unlistenLog(); state.unlistenLog = null; }
  if (state?.unlistenStatus) { state.unlistenStatus(); state.unlistenStatus = null; }
  if (state?.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  state = null;
  rootEl = null;
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
    } else {
      state.running = false;
      state.players = [];
      state.playerCount = "";
      stopPlayerPolling();
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
      const shouldAutoSelect = !state.mcVersion || !versions.find((v) => v.version === state.mcVersion);
      if (shouldAutoSelect) state.mcVersion = versions[0].version;
    }
  } catch {
    if (!state) return;
    state.mcVersions = [];
    state.fetchingVersions = false;
  }
  render();
}


function render(): void {
  if (!rootEl || !state) return;
  rootEl.innerHTML = "";
  rootEl.appendChild($("div", { class: "mc-wizard" }, [
    renderHeader(),
    renderSetupSection(),
    renderServerSection(),
  ]));
}

function renderHeader(): HTMLElement {
  return $("div", { class: "mc-header" }, [
    $("h2", { class: "mc-title" }, [`⛏ ${state!.serverData.name}`]),
    $("span", { class: "mc-subtitle" }, [
      `Server type: ${state!.serverData.serverType}`,
      `  ·  Path: ${state!.serverData.path}`,
    ]),
  ]);
}

function renderSetupSection(): HTMLElement {
  const s = state!;
  const chevron = s.setupExpanded ? "▼" : "▶";
  const header = $("div", { class: "mc-section-header" }, [
    $("span", { class: "mc-section-chevron" }, [chevron]),
    $("span", { class: "mc-section-title" }, ["Setup"]),
  ]);
  header.addEventListener("click", () => {
    if (!state) return;
    state.setupExpanded = !state.setupExpanded;
    render();
  });

  const body = $("div", { class: cls("mc-section-body", s.setupExpanded ? "" : "mc-section-hidden") }, [
    renderVersionSelector(),
    renderConfigGrid(),
    renderJavaSection(),
    renderActionButtons(),
  ]);
  return $("div", { class: "mc-section" }, [header, body]);
}

function renderServerSection(): HTMLElement {
  const s = state!;
  const chevron = s.serverExpanded ? "▼" : "▶";
  const header = $("div", { class: "mc-section-header" }, [
    $("span", { class: "mc-section-chevron" }, [chevron]),
    $("span", { class: "mc-section-title" }, ["Server"]),
    s.running
      ? $("span", { class: "mc-status-dot mc-status-running" }, ["•"])
      : $("span", { class: "mc-status-dot mc-status-stopped" }, ["•"]),
  ]);
  header.addEventListener("click", () => {
    if (!state) return;
    state.serverExpanded = !state.serverExpanded;
    render();
  });

  const body = $("div", { class: cls("mc-section-body", s.serverExpanded ? "" : "mc-section-hidden") }, [
    s.running ? renderDashboardContent() : renderNotRunning(),
  ]);
  return $("div", { class: "mc-section" }, [header, body]);
}

function renderNotRunning(): HTMLElement {
  return $("div", { class: "mc-server-empty" }, [
    $("p", { class: "mc-server-empty-text" }, [
      "Server is not running. Start it from the controls above to see live data.",
    ]),
  ]);
}


function renderDashboardContent(): HTMLElement {
  const s = state!;
  const overrides = s.serverData.userOverrides ?? {};
  const runtime = overrides.runtime || "paper";
  const runtimeLabel = RUNTIME_LABELS[runtime] || runtime;

  return $("div", { class: "mc-server-dashboard" }, [
    $("div", { class: "mc-server-status-bar" }, [
      $("span", { class: "mc-server-status-item" }, [
        $("span", { class: "mc-status-dot mc-status-running" }, ["•"]),
        $("span", {}, ["running"]),
      ]),
      $("span", { class: "mc-server-status-item" }, [runtimeLabel]),
      $("span", { class: "mc-server-status-item" }, [overrides.mc_version || "unknown"]),
      $("span", { class: "mc-server-status-item" }, [`Port ${overrides.server_port || "25565"}`]),
    ]),
    $("div", { class: "mc-server-grid" }, [
      $("div", { class: "mc-chat-column" }, [
        $("div", { class: "mc-chat-header" }, ["Chat"]),
        $("div", { class: "mc-chat-log" },
          s.chatLines.length === 0
            ? [$("div", { class: "mc-chat-empty" }, ["No messages yet…"])]
            : s.chatLines.slice(-50).map((line) =>
                $("div", { class: "mc-chat-line" }, [line])
              )
        ),
        $("div", { class: "mc-chat-input-row" }, [
          $<HTMLInputElement>("input", {
            class: "mc-chat-input", type: "text",
            placeholder: "Type a message or /command...",
            value: s.chatInput,
          }).tap((input) => {
            input.addEventListener("input", () => { if (state) state.chatInput = input.value; });
            input.addEventListener("keydown", (e) => {
              if (e.key === "Enter" && state) {
                const msg = state.chatInput.trim();
                if (msg) {
                  if (msg.startsWith("/")) { void sendCommand(msg.slice(1)); }
                  else { void sendChat(msg); }
                  state.chatInput = "";
                }
              }
            });
          }),
          $("button", { class: "mc-btn mc-btn-sm", type: "button" }, ["send"]).tap((btn) => {
            btn.addEventListener("click", () => {
              if (!state) return;
              const msg = state.chatInput.trim();
              if (msg) {
                if (msg.startsWith("/")) { void sendCommand(msg.slice(1)); }
                else { void sendChat(msg); }
                state.chatInput = "";
              }
            });
          }),
        ]),
      ]),
      $("div", { class: "mc-players-column" }, [
        $("div", { class: "mc-players-header" }, [
          $("span", {}, [`Players${s.playerCount ? ` (${s.playerCount})` : ""}`]),
          $("button", { class: "mc-btn mc-btn-sm", type: "button" }, ["↻"]).tap((btn) => {
            btn.addEventListener("click", () => { void sendCommand("list"); });
          }),
        ]),
        $("div", { class: "mc-player-list" },
          s.players.length === 0
            ? [$("div", { class: "mc-player-empty" }, ["No players online"])]
            : s.players.map((name) =>
                $("div", { class: "mc-player-item" }, [
                  $("span", { class: "mc-player-dot" }, ["•"]),
                  $("span", { class: "mc-player-name" }, [name]),
                ])
              )
        ),
      ]),
    ]),
    $("div", { class: "mc-quick-cmds" }, [
      $("span", { class: "mc-quick-cmds-label" }, ["Quick:"]),
      ...[
        { label: "list", cmd: "list" },
        { label: "save", cmd: "save-all" },
        { label: "day", cmd: "time set day" },
        { label: "night", cmd: "time set night" },
        { label: "clear", cmd: "weather clear" },
        { label: "rain", cmd: "weather rain" },
      ].map(({ label, cmd }) =>
        $("button", { class: "mc-btn mc-btn-sm mc-quick-cmd", type: "button" }, [label]).tap((btn) => {
          btn.addEventListener("click", () => { void sendCommand(cmd); });
        })
      ),
    ]),
  ]);
}


function renderVersionSelector(): HTMLElement {
  const s = state!;
  const overrides = s.serverData.userOverrides ?? {};
  const runtime = overrides.runtime || "paper";

  const select = $<HTMLSelectElement>("select", {
    class: cls("mc-ver-select", s.fetchingVersions ? "mc-ver-loading" : ""),
    disabled: undefined,
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
    disabled: s.fetchingVersions ? "true" : undefined,
  }, ["↻"]);
  refreshBtn.addEventListener("click", async () => {
    if (!state || state.fetchingVersions) return;
    await fetchAndSetVersions(runtime, state.includeSnapshots);
  });

  return $("div", { class: "mc-subsection" }, [
    $("div", { class: "mc-subsection-title" }, ["Version Selection"]),
    $("div", { class: "mc-ver-row" }, [
      $("span", { class: "mc-ver-badge" }, [RUNTIME_LABELS[runtime] || runtime]),
      s.fetchingVersions
        ? $("span", { class: "mc-ver-spinner" }, ["◳"])
        : $("span", { style: "display:none" }),
      select, toggle, refreshBtn,
    ]),
    $("span", { class: "mc-ver-hint" }, [
      s.fetchingVersions
        ? "Fetching available versions…"
        : s.mcVersions.length > 0
          ? `${s.mcVersions.length} version(s) available`
          : "Could not fetch versions. Check your internet connection.",
    ]),
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

  const ramSelect = $<HTMLSelectElement>("select", { class: "mc-ram-select" });
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

  return $("div", { class: "mc-subsection" }, [
    $("div", { class: "mc-subsection-title" }, ["Configuration"]),
    $("div", { class: "mc-config-grid" }, [
      $("div", { class: "mc-config-item" }, [
        $("span", { class: "mc-config-label" }, ["Server Port"]),
        $("span", { class: "mc-config-value" }, [overrides.server_port || "25565"]),
      ]),
      $("div", { class: "mc-config-item" }, [
        $("span", { class: "mc-config-label" }, ["RAM"]),
        ramSelect,
      ]),
      $("div", { class: "mc-config-item mc-config-jvm" }, [
        $("span", { class: "mc-config-label" }, [
          "JVM Args",
          $("span", { class: "mc-config-badge" }, [`${heapTier(runtime)} · ${runtimeLabel}`]),
        ]),
        $("code", { class: cls("mc-config-value", "mc-jvm-flags", usingRecommended ? "" : "mc-jvm-custom") }, [currentJvm]),
      ]),
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
    class: cls("mc-btn", "mc-btn-sm", s.downloadingJava ? "mc-btn-disabled" : "mc-btn-primary"),
    type: "button",
    disabled: s.downloadingJava ? "true" : undefined,
  }, [s.downloadingJava ? "downloading…" : `install Java ${s.javaMajor}`]);

  installBtn.addEventListener("click", () => {
    if (!state || state.downloadingJava) return;
    state.downloadingJava = true;
    render();
    const destDir = `${state.hostAPI.serverPath}/jdk`;
    downloadJava(state.javaMajor, destDir, state.hostAPI.invoke, {
      onComplete(installed) {
        if (!state) return;
        state.downloadingJava = false;
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
        state.installLog.push(`❌  Java install failed: ${err}`);
        render();
      },
    });
  });

  const installPrompt: HTMLElement | null =
    s.javaMissing && !s.downloadingJava
      ? $("div", { class: "mc-java-missing" }, [
          $("span", { class: "mc-java-warn" }, [
            `⚠ No Java ${s.javaMajor}+ found — required for MC ${s.mcVersion || "selected"}. `,
          ]),
          installBtn,
        ])
      : null;

  const downloadingHint: HTMLElement | null =
    s.downloadingJava
      ? $("div", { class: "mc-java-downloading" }, [
          installBtn,
          $("span", { class: "mc-java-hint" }, [
            `Downloading + extracting Java ${s.javaMajor} into jdk/ …`,
          ]),
        ])
      : null;

  return $("div", { class: "mc-subsection" }, [
    $("div", { class: "mc-subsection-title" }, [`Java Runtime  —  recommended: Java ${recommended}`]),
    $("div", { class: "mc-java-row" }, [
      select,
      $("button", { class: "mc-btn mc-btn-sm", type: "button" }, ["↻"]).tap((btn) => {
        btn.addEventListener("click", async () => {
          try {
            const installs = await detectJava(state!.hostAPI.invoke);
            if (!state) return;
            state.javaInstalls = installs;
            state.javaMissing = !installs.some((j) => j.majorVersion >= state.javaMajor);
            render();
          } catch { /* ignore */ }
        });
      }),
      $("input", { class: "mc-java-path-input", type: "text", placeholder: "Or type a Java path…", value: s.selectedJava }).tap((input) => {
        input.addEventListener("input", () => { if (state) state.selectedJava = input.value; });
      }),
    ]),
    installPrompt ?? $("span", { style: "display:none" }),
    downloadingHint ?? $("span", { style: "display:none" }),
    javaInstallsSummary(s.javaInstalls, s.mcVersion),
  ]);
}


function javaInstallsSummary(installs: JavaInstall[], mcVersion: string): HTMLElement {
  const recommended = mcVersionToJavaVersion(mcVersion);
  const filtered = filterJavaForMc(installs, mcVersion);
  if (installs.length === 0) {
    return $("p", { class: "mc-java-warn" }, ["⚠ No Java installations detected. Type a path manually."]);
  }
  return $("p", { class: "mc-java-info" }, [
    `Found ${installs.length} Java installation(s), ${filtered.length} compatible with MC ${mcVersion} (Java ${recommended}+).`,
  ]);
}

function stepDot(status: InstallStep["status"]): string {
  switch (status) {
    case "running": return "signal-high";
    case "done": return "text-zinc-500";
    case "error": return "fault-vector";
    default: return "text-zinc-700";
  }
}

function renderActionButtons(): HTMLElement {
  const s = state!;
  const runtime = (s.serverData.userOverrides ?? {}).runtime || "paper";
  const canInstall = !s.fetchingVersions && s.mcVersion !== "" && !s.installing;

  const btn = $<HTMLButtonElement>("button", {
    class: cls("mc-btn", canInstall ? "" : "mc-btn-disabled"),
    type: "button",
    disabled: canInstall ? undefined : "true",
  }, [
    s.installing
      ? s.installError ? "retry install" : "installing…"
      : s.installSteps.some((st) => st.status === "done") ? "re-install" : "install",
  ]);

  btn.addEventListener("click", () => {
    if (!state || !canInstall) return;
    state.installing = true; state.installSteps = []; state.installLog = []; state.installError = false;
    render();
    runInstall(state.serverData.id, runtime, state.mcVersion, state.selectedJava, state.hostAPI, {
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
        state.installLog.push(success ? `✅  ${message}` : `❌  ${message}`);
        render();
      },
    }).catch((err: unknown) => {
      if (!state) return;
      state.installing = false; state.installError = true;
      state.installLog.push(`❌  ${err}`); render();
    });
  });

  const stepList: HTMLElement | null =
    s.installSteps.length > 0
      ? $("div", { class: "mc-install-steps" },
          s.installSteps.map((st) => {
            const message = st.message ? ` — ${st.message}` : "";
            return $("div", { class: "mc-install-step text-zinc-400" }, [
              $("span", { class: `mc-install-dot ${stepDot(st.status)}` }, ["•"]),
              $("span", { class: "mc-install-label" }, [`${st.label}${message}`]),
            ]);
          }),
        )
      : null;

  const logTail: HTMLElement | null =
    s.installLog.length > 0
      ? $("div", { class: "mc-install-log" },
          s.installLog.slice(-6).map((line) => $("div", { class: "mc-install-log-line" }, [line])),
        )
      : null;

  return $("div", { class: "mc-subsection" }, [
    $("div", { class: "mc-subsection-title" }, ["Installation"]),
    $("div", { class: "mc-install-row" }, [btn, s.installing
      ? $("span", { class: "mc-install-spinner" }, ["◳ working…"])
      : $("span", { class: "mc-install-hint" }, [
          s.mcVersion ? `Downloads + configures ${runtime} ${s.mcVersion}` : "Select a Minecraft version to install",
        ]),
    ]),
    stepList ?? $("span", { style: "display:none" }),
    logTail ?? $("span", { style: "display:none" }),
  ]);
}
