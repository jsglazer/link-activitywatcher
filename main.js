"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => LinkActivityWatcherPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");
var import_os = require("os");

// src/core/activity.ts
function activityState(input) {
  if (input.paused) return "paused";
  if (input.focusOnly && !input.focused) return "unfocused";
  if (input.idleMinutes > 0 && input.now - input.lastInputAt > input.idleMinutes * 6e4) return "idle";
  return "active";
}
function backoffMs(attempt) {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(3e5, 5e3 * 2 ** Math.min(n, 10));
}

// src/core/aw-client.ts
var AwError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "AwError";
  }
};
var AwClient = class {
  constructor(baseUrl, http) {
    this.baseUrl = baseUrl;
    this.http = http;
  }
  async call(method, path, body) {
    const url = `${this.baseUrl}/api/0/${path}`;
    let res;
    try {
      res = await this.http({ url, method, body: body === void 0 ? void 0 : JSON.stringify(body) });
    } catch (e) {
      throw new AwError(`Cannot reach ActivityWatch at ${this.baseUrl}: ${e instanceof Error ? e.message : String(e)}`, null);
    }
    if (res.status >= 400) throw new AwError(`${method} ${path} failed with HTTP ${res.status}: ${res.text.slice(0, 200)}`, res.status);
    return res;
  }
  async info() {
    var _a;
    const res = await this.call("GET", "info");
    let parsed;
    try {
      parsed = JSON.parse(res.text);
    } catch (e) {
      throw new AwError(`Unexpected reply from ${this.baseUrl} (not ActivityWatch?)`, res.status);
    }
    const o = parsed != null ? parsed : {};
    if (typeof o.version !== "string") throw new AwError(`Unexpected reply from ${this.baseUrl} (not ActivityWatch?)`, res.status);
    return { hostname: String((_a = o.hostname) != null ? _a : ""), version: o.version, testing: o.testing === true };
  }
  async ensureBucket(id, type, client, hostname2) {
    await this.call("POST", `buckets/${encodeURIComponent(id)}`, { client, type, hostname: hostname2 });
  }
  async heartbeat(bucketId, pulsetime, event) {
    await this.call("POST", `buckets/${encodeURIComponent(bucketId)}/heartbeat?pulsetime=${pulsetime}`, event);
  }
  async insert(bucketId, events) {
    await this.call("POST", `buckets/${encodeURIComponent(bucketId)}/events`, events);
  }
};

// src/core/events.ts
var WATCHER_NAME = "aw-watcher-obsidian";
var ACTIVITY_BUCKET_TYPE = "app.editor.activity";
var FILE_EVENT_BUCKET_TYPE = "app.editor.fileevent";
function activityBucketId(hostname2) {
  return `${WATCHER_NAME}_${hostname2}`;
}
function fileEventBucketId(hostname2) {
  return `${WATCHER_NAME}-fileevents_${hostname2}`;
}
var LANGUAGES = {
  md: "Markdown",
  canvas: "Canvas",
  base: "Bases",
  pdf: "PDF",
  png: "Image",
  jpg: "Image",
  jpeg: "Image",
  gif: "Image",
  webp: "Image",
  svg: "Image",
  bmp: "Image",
  avif: "Image",
  mp3: "Audio",
  wav: "Audio",
  m4a: "Audio",
  ogg: "Audio",
  flac: "Audio",
  webm: "Video",
  mp4: "Video",
  mov: "Video",
  mkv: "Video",
  ogv: "Video"
};
function languageFor(extension) {
  var _a;
  const ext = extension.toLowerCase().replace(/^\./, "");
  if (ext === "") return "Unknown";
  return (_a = LANGUAGES[ext]) != null ? _a : ext.toUpperCase();
}
function baseData(file, env) {
  var _a;
  const data = {
    file: `/${file.path}`,
    project: (_a = projectFor(file.path, env.projectRules)) != null ? _a : env.vault,
    vault: env.vault,
    language: languageFor(file.extension),
    editor: "Obsidian",
    editorVersion: env.editorVersion
  };
  if (env.vaultPath !== null) data.projectPath = env.vaultPath;
  return data;
}
function activityEvent(file, env, now) {
  return { timestamp: now.toISOString(), duration: 0, data: baseData(file, env) };
}
function fileEvent(kind, file, env, now, oldPath) {
  const data = baseData(file, env);
  data.eventType = kind;
  if (kind === "rename" && oldPath !== void 0) data.oldFile = `/${oldPath}`;
  return { timestamp: now.toISOString(), duration: 0, data };
}
function pulsetimeFor(heartbeatSeconds) {
  return heartbeatSeconds + Math.max(5, Math.ceil(heartbeatSeconds / 2));
}
function escapeRegExp(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}
function globSource(p) {
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += escapeRegExp(c);
    }
  }
  return out;
}
function globToRegExp(pattern) {
  let p = pattern.trim().replace(/^\/+/, "");
  if (p.endsWith("/")) p += "**";
  const out = globSource(p);
  return new RegExp(p.includes("/") ? `^${out}$` : `(?:^|/)${out}$`, "i");
}
function projectRuleToRegExp(rule) {
  const p = rule.trim().replace(/^\/+/, "").replace(/(?:\/\*\*)?\/*$/, "");
  return new RegExp(`^(${globSource(p)})/`, "i");
}
function compileProjectRules(rules) {
  return rules.map(projectRuleToRegExp);
}
function projectFor(path, compiled) {
  for (const re of compiled) {
    const m = re.exec(path);
    if (m) {
      const folder = m[1].replace(/\/+$/, "");
      const name = folder.slice(folder.lastIndexOf("/") + 1);
      if (name !== "") return name;
    }
  }
  return null;
}
function compilePatterns(patterns) {
  return patterns.map(globToRegExp);
}
function isExcluded(path, compiled) {
  return compiled.some((re) => re.test(path));
}

// src/core/settings.ts
var DEFAULT_SETTINGS = {
  serverUrl: "http://127.0.0.1:5600",
  heartbeatSeconds: 10,
  focusOnly: true,
  idleMinutes: 5,
  trackFileEvents: true,
  excludePatterns: [],
  projectRules: [],
  sendVaultPath: true,
  paused: false
};
var HEARTBEAT_MIN = 2;
var HEARTBEAT_MAX = 60;
var IDLE_MAX = 240;
function clampInt(value, min, max, fallback) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function normalizeServerUrl(raw) {
  if (typeof raw !== "string") return DEFAULT_SETTINGS.serverUrl;
  let url = raw.trim();
  if (url === "") return DEFAULT_SETTINGS.serverUrl;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  url = url.replace(/\/+$/, "").replace(/\/api\/0$/i, "");
  return url;
}
function parsePatterns(raw) {
  const lines = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\r?\n/) : [];
  return lines.filter((l) => typeof l === "string").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
}
function normalizeSettings(raw) {
  const src = raw !== null && typeof raw === "object" ? raw : {};
  const d = DEFAULT_SETTINGS;
  return {
    serverUrl: normalizeServerUrl(src.serverUrl),
    heartbeatSeconds: clampInt(src.heartbeatSeconds, HEARTBEAT_MIN, HEARTBEAT_MAX, d.heartbeatSeconds),
    focusOnly: bool(src.focusOnly, d.focusOnly),
    idleMinutes: clampInt(src.idleMinutes, 0, IDLE_MAX, d.idleMinutes),
    trackFileEvents: bool(src.trackFileEvents, d.trackFileEvents),
    excludePatterns: parsePatterns(src.excludePatterns),
    projectRules: parsePatterns(src.projectRules),
    sendVaultPath: bool(src.sendVaultPath, d.sendVaultPath),
    paused: bool(src.paused, d.paused)
  };
}

// src/settings-tab.ts
var import_obsidian = require("obsidian");
var LinkActivityWatcherSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    new import_obsidian.Setting(containerEl).setName("Connection").setHeading();
    let resultEl = null;
    const server = new import_obsidian.Setting(containerEl).setName("Server URL").setDesc("Address of your local aw-server. The default port is 5600; the ActivityWatch testing server uses 5666.").addText((text) => {
      text.setPlaceholder(DEFAULT_SETTINGS.serverUrl).setValue(s.serverUrl);
      text.inputEl.addEventListener("change", () => {
        void this.apply({ serverUrl: text.getValue() }).then(() => text.setValue(this.plugin.settings.serverUrl));
      });
    }).addButton(
      (button) => button.setButtonText("Test connection").onClick(async () => {
        if (!resultEl) return;
        resultEl.setText("Testing\u2026");
        resultEl.removeClass("mod-success", "mod-warning");
        try {
          resultEl.setText(await this.plugin.testConnection(this.plugin.settings.serverUrl));
          resultEl.addClass("mod-success");
        } catch (e) {
          resultEl.setText(e instanceof Error ? e.message : String(e));
          resultEl.addClass("mod-warning");
        }
      })
    );
    resultEl = server.descEl.createDiv({ cls: "link-activitywatcher-test-result" });
    new import_obsidian.Setting(containerEl).setName("Tracking").setHeading();
    new import_obsidian.Setting(containerEl).setName("Pause tracking").setDesc("Stop sending anything to ActivityWatch. Also available from the status bar and the command palette.").addToggle((t) => t.setValue(s.paused).onChange((v) => this.apply({ paused: v })));
    new import_obsidian.Setting(containerEl).setName("Heartbeat interval (seconds)").setDesc(`How often the open note is reported while you are active (${HEARTBEAT_MIN}\u2013${HEARTBEAT_MAX}). Switching notes is reported immediately.`).addSlider(
      (sl) => sl.setLimits(HEARTBEAT_MIN, HEARTBEAT_MAX, 1).setValue(s.heartbeatSeconds).setDynamicTooltip().onChange((v) => this.apply({ heartbeatSeconds: v }))
    );
    new import_obsidian.Setting(containerEl).setName("Only while Obsidian is focused").setDesc("Stop reporting when another app is in front.").addToggle((t) => t.setValue(s.focusOnly).onChange((v) => this.apply({ focusOnly: v })));
    new import_obsidian.Setting(containerEl).setName("Idle timeout (minutes)").setDesc(`Stop reporting after this long without keyboard or mouse input in Obsidian. 0 keeps reporting while a note is open, e.g. when reading without scrolling. Max ${IDLE_MAX}.`).addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0";
      text.inputEl.max = String(IDLE_MAX);
      text.setValue(String(s.idleMinutes)).onChange((v) => {
        if (v.trim() !== "") void this.apply({ idleMinutes: Number(v) });
      });
    });
    new import_obsidian.Setting(containerEl).setName("Record file events").setDesc("Log note create, rename, and delete events to a separate bucket (aw-watcher-obsidian-fileevents_<host>). Events that happen while ActivityWatch is offline are sent when it comes back.").addToggle((t) => t.setValue(s.trackFileEvents).onChange((v) => this.apply({ trackFileEvents: v })));
    new import_obsidian.Setting(containerEl).setName("Projects").setHeading();
    new import_obsidian.Setting(containerEl).setName("Project from folder").setDesc(
      "One folder glob per line. A note inside a matching folder is reported with that folder's name as its project, so ActivityWatch's Editor \u2192 Top projects shows time per folder. Example: Classes/2026-B/* makes every class folder its own project. First matching line wins; other notes use the vault name. Lines starting with # are ignored."
    ).setClass("link-activitywatcher-patterns").addTextArea((ta) => {
      ta.setPlaceholder("Classes/2026-B/*\nProjects/*").setValue(s.projectRules.join("\n"));
      ta.inputEl.rows = 4;
      ta.inputEl.addEventListener("change", () => void this.apply({ projectRules: parsePatterns(ta.getValue()) }));
    });
    new import_obsidian.Setting(containerEl).setName("Privacy").setHeading();
    new import_obsidian.Setting(containerEl).setName("Excluded paths").setDesc(
      "One glob per line, matched against the vault-relative path. Folder/ excludes a whole folder, *.excalidraw.md matches in any folder, Journal/**/private-* spans subfolders. Lines starting with # are ignored. Matching notes are never sent."
    ).setClass("link-activitywatcher-patterns").addTextArea((ta) => {
      ta.setPlaceholder("Private/\n*.secret.md").setValue(s.excludePatterns.join("\n"));
      ta.inputEl.rows = 5;
      ta.inputEl.addEventListener("change", () => void this.apply({ excludePatterns: parsePatterns(ta.getValue()) }));
    });
    new import_obsidian.Setting(containerEl).setName("Send vault folder path").setDesc("Include the vault's absolute folder path (projectPath) in each event. The vault name is always sent.").addToggle((t) => t.setValue(s.sendVaultPath).onChange((v) => this.apply({ sendVaultPath: v })));
  }
  apply(patch) {
    return this.plugin.updateSettings(patch);
  }
};

// src/main.ts
var MAX_PENDING_FILE_EVENTS = 200;
var obsidianHttp = async (req) => {
  const res = await (0, import_obsidian2.requestUrl)({
    url: req.url,
    method: req.method,
    body: req.body,
    contentType: "application/json",
    throw: false
  });
  return { status: res.status, text: res.text };
};
var LinkActivityWatcherPlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.settings = normalizeSettings(null);
    this.connection = "connecting";
    this.lastError = "";
    this.client = new AwClient(this.settings.serverUrl, obsidianHttp);
    this.host = (0, import_os.hostname)();
    this.excluded = [];
    this.projectRules = [];
    this.lastInputAt = Date.now();
    this.docs = /* @__PURE__ */ new Set();
    this.heartbeatTimer = null;
    this.retryTimer = null;
    this.retryAttempt = 0;
    this.pendingFileEvents = [];
    // Requests are chained so heartbeats reach the server in timestamp order.
    this.queue = Promise.resolve();
    this.statusEl = null;
    this.unloaded = false;
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new LinkActivityWatcherSettingTab(this.app, this));
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("link-activitywatcher-status", "mod-clickable");
    this.registerDomEvent(this.statusEl, "click", () => {
      if (this.connection === "offline") this.reconnect();
      else void this.setPaused(!this.settings.paused);
    });
    this.addCommand({ id: "reconnect", name: "Reconnect to ActivityWatch", callback: () => this.reconnect() });
    this.addCommand({
      id: "toggle-tracking",
      name: "Pause / resume tracking",
      callback: () => void this.setPaused(!this.settings.paused)
    });
    this.watchDocument(document);
    this.registerEvent(this.app.workspace.on("window-open", (win) => this.watchDocument(win.doc)));
    this.registerEvent(this.app.workspace.on("window-close", (win) => this.docs.delete(win.doc)));
    this.registerDomEvent(window, "focus", () => this.beat());
    this.registerEvent(this.app.workspace.on("file-open", () => this.beat()));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.onFileEvent("rename", file, oldPath)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.onFileEvent("delete", file)));
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (file) => this.onFileEvent("create", file)));
      this.connect();
    });
    this.restartHeartbeat();
    this.renderStatus();
  }
  onunload() {
    this.unloaded = true;
    this.clearRetry();
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.docs.clear();
  }
  async loadSettings() {
    this.applySettings(normalizeSettings(await this.loadData()));
  }
  async updateSettings(patch) {
    const prevUrl = this.settings.serverUrl;
    const prevBeat = this.settings.heartbeatSeconds;
    this.applySettings(normalizeSettings({ ...this.settings, ...patch }));
    await this.saveData(this.settings);
    if (this.settings.heartbeatSeconds !== prevBeat) this.restartHeartbeat();
    if (this.settings.serverUrl !== prevUrl) this.reconnect();
    this.renderStatus();
  }
  async setPaused(paused) {
    await this.updateSettings({ paused });
    new import_obsidian2.Notice(paused ? "ActivityWatch tracking paused" : "ActivityWatch tracking resumed");
    if (!paused) this.beat();
  }
  reconnect() {
    this.retryAttempt = 0;
    this.connect();
  }
  // Used by the settings tab's "Test connection" button; does not change state.
  async testConnection(url) {
    const info = await new AwClient(url, obsidianHttp).info();
    return `Connected: ActivityWatch ${info.version} on ${info.hostname}${info.testing ? " (testing server)" : ""}`;
  }
  currentState() {
    return activityState({
      now: Date.now(),
      focused: [...this.docs].some((d) => d.hasFocus()),
      lastInputAt: this.lastInputAt,
      paused: this.settings.paused,
      focusOnly: this.settings.focusOnly,
      idleMinutes: this.settings.idleMinutes
    });
  }
  applySettings(settings) {
    if (settings.serverUrl !== this.settings.serverUrl) this.client = new AwClient(settings.serverUrl, obsidianHttp);
    this.settings = settings;
    this.excluded = compilePatterns(settings.excludePatterns);
    this.projectRules = compileProjectRules(settings.projectRules);
  }
  watchDocument(doc) {
    this.docs.add(doc);
    const touch = () => {
      this.lastInputAt = Date.now();
    };
    for (const type of ["keydown", "mousedown", "wheel", "mousemove", "touchstart"]) {
      this.registerDomEvent(doc, type, touch, { capture: true, passive: true });
    }
  }
  restartHeartbeat() {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = window.setInterval(() => this.beat(), this.settings.heartbeatSeconds * 1e3);
    this.registerInterval(this.heartbeatTimer);
  }
  connect() {
    if (this.unloaded) return;
    this.clearRetry();
    this.connection = "connecting";
    this.renderStatus();
    const client = this.client;
    this.enqueue(async () => {
      try {
        await client.ensureBucket(activityBucketId(this.host), ACTIVITY_BUCKET_TYPE, WATCHER_NAME, this.host);
        await client.ensureBucket(fileEventBucketId(this.host), FILE_EVENT_BUCKET_TYPE, WATCHER_NAME, this.host);
        if (client !== this.client) return;
        this.connection = "online";
        this.retryAttempt = 0;
        this.lastError = "";
        this.renderStatus();
        await this.flushFileEvents();
        this.beat();
      } catch (e) {
        if (client === this.client) this.goOffline(e);
      }
    });
  }
  goOffline(e) {
    this.connection = "offline";
    this.lastError = e instanceof Error ? e.message : String(e);
    this.renderStatus();
    this.clearRetry();
    if (this.unloaded) return;
    const delay = backoffMs(this.retryAttempt++);
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }
  clearRetry() {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
  enqueue(task) {
    this.queue = this.queue.then(task, task);
  }
  env() {
    const adapter = this.app.vault.adapter;
    const vaultPath = this.settings.sendVaultPath && adapter instanceof import_obsidian2.FileSystemAdapter ? adapter.getBasePath() : null;
    return { vault: this.app.vault.getName(), vaultPath, editorVersion: import_obsidian2.apiVersion, projectRules: this.projectRules };
  }
  trackableFile(file) {
    if (!(file instanceof import_obsidian2.TFile)) return null;
    if (isExcluded(file.path, this.excluded)) return null;
    return { path: file.path, extension: file.extension };
  }
  beat() {
    this.renderStatus();
    if (this.connection !== "online" || this.currentState() !== "active") return;
    const file = this.trackableFile(this.app.workspace.getActiveFile());
    if (!file) return;
    const event = activityEvent(file, this.env(), /* @__PURE__ */ new Date());
    const pulsetime = pulsetimeFor(this.settings.heartbeatSeconds);
    const client = this.client;
    this.enqueue(async () => {
      if (this.connection !== "online" || client !== this.client) return;
      try {
        await client.heartbeat(activityBucketId(this.host), pulsetime, event);
      } catch (e) {
        this.onSendError(e);
      }
    });
  }
  onFileEvent(kind, file, oldPath) {
    if (!this.settings.trackFileEvents || this.settings.paused) return;
    const info = this.trackableFile(file);
    if (!info) return;
    if (oldPath !== void 0 && isExcluded(oldPath, this.excluded)) return;
    this.pendingFileEvents.push(fileEvent(kind, info, this.env(), /* @__PURE__ */ new Date(), oldPath));
    if (this.pendingFileEvents.length > MAX_PENDING_FILE_EVENTS) this.pendingFileEvents.shift();
    if (this.connection === "online") this.enqueue(() => this.flushFileEvents());
  }
  async flushFileEvents() {
    if (this.connection !== "online" || this.pendingFileEvents.length === 0) return;
    const batch = this.pendingFileEvents;
    this.pendingFileEvents = [];
    try {
      await this.client.insert(fileEventBucketId(this.host), batch);
    } catch (e) {
      this.pendingFileEvents = [...batch, ...this.pendingFileEvents].slice(-MAX_PENDING_FILE_EVENTS);
      this.onSendError(e);
    }
  }
  onSendError(e) {
    if (e instanceof AwError && (e.status === null || e.status === 404)) {
      if (this.connection === "online") this.goOffline(e);
      return;
    }
    this.lastError = e instanceof Error ? e.message : String(e);
    this.renderStatus();
  }
  renderStatus() {
    const el = this.statusEl;
    if (!el) return;
    let text;
    let tip;
    if (this.settings.paused) {
      text = "AW: paused";
      tip = "ActivityWatch tracking is paused. Click to resume.";
    } else if (this.connection === "connecting") {
      text = "AW: connecting";
      tip = `Connecting to ${this.settings.serverUrl}`;
    } else if (this.connection === "offline") {
      text = "AW: offline";
      tip = `${this.lastError || "ActivityWatch is not reachable"}
Click to retry now.`;
    } else {
      const state = this.currentState();
      const file = this.app.workspace.getActiveFile();
      const excluded = file instanceof import_obsidian2.TFile && isExcluded(file.path, this.excluded);
      text = excluded ? "AW: excluded" : state === "active" ? "AW: tracking" : `AW: ${state}`;
      tip = excluded ? "This note matches an exclusion pattern and is not reported." : `Reporting to ${this.settings.serverUrl} as ${activityBucketId(this.host)}. Click to pause.`;
      if (this.lastError) tip += `
Last error: ${this.lastError}`;
    }
    el.setText(text);
    el.setAttr("aria-label", tip);
    el.setAttr("data-tooltip-position", "top");
    el.toggleClass("is-offline", this.connection === "offline" && !this.settings.paused);
  }
};
