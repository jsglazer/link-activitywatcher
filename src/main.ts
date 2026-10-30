import { FileSystemAdapter, Notice, Plugin, TAbstractFile, TFile, apiVersion, requestUrl } from "obsidian";
import { hostname } from "os";
import { activityState, backoffMs, type ActivityState } from "./core/activity";
import { AwClient, AwError, type HttpFn } from "./core/aw-client";
import {
	ACTIVITY_BUCKET_TYPE,
	FILE_EVENT_BUCKET_TYPE,
	WATCHER_NAME,
	activityBucketId,
	activityEvent,
	compilePatterns,
	compileProjectRules,
	fileEvent,
	fileEventBucketId,
	isExcluded,
	pulsetimeFor,
	type AwEvent,
	type EnvInfo,
	type FileEventKind,
	type FileInfo,
} from "./core/events";
import { normalizeSettings, type WatcherSettings } from "./core/settings";
import { LinkActivityWatcherSettingTab } from "./settings-tab";

type Connection = "connecting" | "online" | "offline";

// File events that happen while the server is down are kept (up to this many)
// and inserted once it is back. Heartbeats are not kept: they describe "now".
const MAX_PENDING_FILE_EVENTS = 200;

// requestUrl runs in the main process, so localhost calls are not subject to CORS.
const obsidianHttp: HttpFn = async (req) => {
	const res = await requestUrl({
		url: req.url,
		method: req.method,
		body: req.body,
		contentType: "application/json",
		throw: false,
	});
	return { status: res.status, text: res.text };
};

// Obsidian requires the plugin class to be the module's default export.
export default class LinkActivityWatcherPlugin extends Plugin {
	settings: WatcherSettings = normalizeSettings(null);
	connection: Connection = "connecting";
	lastError = "";

	private client = new AwClient(this.settings.serverUrl, obsidianHttp);
	private readonly host = hostname();
	private excluded: RegExp[] = [];
	private projectRules: RegExp[] = [];
	private lastInputAt = Date.now();
	private readonly docs = new Set<Document>();
	private heartbeatTimer: number | null = null;
	private retryTimer: number | null = null;
	private retryAttempt = 0;
	private pendingFileEvents: AwEvent[] = [];
	// Requests are chained so heartbeats reach the server in timestamp order.
	private queue: Promise<void> = Promise.resolve();
	private statusEl: HTMLElement | null = null;
	private unloaded = false;

	async onload(): Promise<void> {
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
			callback: () => void this.setPaused(!this.settings.paused),
		});

		this.watchDocument(document);
		this.registerEvent(this.app.workspace.on("window-open", (win) => this.watchDocument(win.doc)));
		this.registerEvent(this.app.workspace.on("window-close", (win) => this.docs.delete(win.doc)));
		this.registerDomEvent(window, "focus", () => this.beat());

		this.registerEvent(this.app.workspace.on("file-open", () => this.beat()));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.onFileEvent("rename", file, oldPath)));
		this.registerEvent(this.app.vault.on("delete", (file) => this.onFileEvent("delete", file)));
		this.app.workspace.onLayoutReady(() => {
			// The vault fires "create" for every file during startup indexing; only listen afterwards.
			this.registerEvent(this.app.vault.on("create", (file) => this.onFileEvent("create", file)));
			this.connect();
		});

		this.restartHeartbeat();
		this.renderStatus();
	}

	onunload(): void {
		this.unloaded = true;
		this.clearRetry();
		if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
		this.docs.clear();
	}

	async loadSettings(): Promise<void> {
		this.applySettings(normalizeSettings(await this.loadData()));
	}

	async updateSettings(patch: Partial<WatcherSettings>): Promise<void> {
		const prevUrl = this.settings.serverUrl;
		const prevBeat = this.settings.heartbeatSeconds;
		this.applySettings(normalizeSettings({ ...this.settings, ...patch }));
		await this.saveData(this.settings);
		if (this.settings.heartbeatSeconds !== prevBeat) this.restartHeartbeat();
		if (this.settings.serverUrl !== prevUrl) this.reconnect();
		this.renderStatus();
	}

	async setPaused(paused: boolean): Promise<void> {
		await this.updateSettings({ paused });
		new Notice(paused ? "ActivityWatch tracking paused" : "ActivityWatch tracking resumed");
		if (!paused) this.beat();
	}

	reconnect(): void {
		this.retryAttempt = 0;
		this.connect();
	}

	// Used by the settings tab's "Test connection" button; does not change state.
	async testConnection(url: string): Promise<string> {
		const info = await new AwClient(url, obsidianHttp).info();
		return `Connected: ActivityWatch ${info.version} on ${info.hostname}${info.testing ? " (testing server)" : ""}`;
	}

	currentState(): ActivityState {
		return activityState({
			now: Date.now(),
			focused: [...this.docs].some((d) => d.hasFocus()),
			lastInputAt: this.lastInputAt,
			paused: this.settings.paused,
			focusOnly: this.settings.focusOnly,
			idleMinutes: this.settings.idleMinutes,
		});
	}

	private applySettings(settings: WatcherSettings): void {
		this.settings = settings;
		this.excluded = compilePatterns(settings.excludePatterns);
		this.projectRules = compileProjectRules(settings.projectRules);
		this.client = new AwClient(settings.serverUrl, obsidianHttp);
	}

	private watchDocument(doc: Document): void {
		this.docs.add(doc);
		const touch = () => {
			this.lastInputAt = Date.now();
		};
		for (const type of ["keydown", "mousedown", "wheel", "mousemove", "touchstart"] as const) {
			this.registerDomEvent(doc, type, touch, { capture: true, passive: true });
		}
	}

	private restartHeartbeat(): void {
		if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
		this.heartbeatTimer = window.setInterval(() => this.beat(), this.settings.heartbeatSeconds * 1000);
		this.registerInterval(this.heartbeatTimer);
	}

	private connect(): void {
		if (this.unloaded) return;
		this.clearRetry();
		this.connection = "connecting";
		this.renderStatus();
		const client = this.client;
		this.enqueue(async () => {
			try {
				await client.ensureBucket(activityBucketId(this.host), ACTIVITY_BUCKET_TYPE, WATCHER_NAME, this.host);
				await client.ensureBucket(fileEventBucketId(this.host), FILE_EVENT_BUCKET_TYPE, WATCHER_NAME, this.host);
				if (client !== this.client) return; // server URL changed meanwhile; that connect wins
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

	private goOffline(e: unknown): void {
		this.connection = "offline";
		this.lastError = e instanceof Error ? e.message : String(e);
		this.renderStatus();
		this.clearRetry();
		if (this.unloaded) return;
		const delay = backoffMs(this.retryAttempt++);
		this.retryTimer = window.setTimeout(() => this.connect(), delay);
	}

	private clearRetry(): void {
		if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
		this.retryTimer = null;
	}

	private enqueue(task: () => Promise<void>): void {
		this.queue = this.queue.then(task, task);
	}

	private env(): EnvInfo {
		const adapter = this.app.vault.adapter;
		const vaultPath = this.settings.sendVaultPath && adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
		return { vault: this.app.vault.getName(), vaultPath, editorVersion: apiVersion, projectRules: this.projectRules };
	}

	private trackableFile(file: TAbstractFile | null): FileInfo | null {
		if (!(file instanceof TFile)) return null;
		if (isExcluded(file.path, this.excluded)) return null;
		return { path: file.path, extension: file.extension };
	}

	private beat(): void {
		this.renderStatus();
		if (this.connection !== "online" || this.currentState() !== "active") return;
		const file = this.trackableFile(this.app.workspace.getActiveFile());
		if (!file) return;
		const event = activityEvent(file, this.env(), new Date());
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

	private onFileEvent(kind: FileEventKind, file: TAbstractFile, oldPath?: string): void {
		if (!this.settings.trackFileEvents || this.settings.paused) return;
		const info = this.trackableFile(file);
		if (!info) return;
		if (oldPath !== undefined && isExcluded(oldPath, this.excluded)) return;
		this.pendingFileEvents.push(fileEvent(kind, info, this.env(), new Date(), oldPath));
		if (this.pendingFileEvents.length > MAX_PENDING_FILE_EVENTS) this.pendingFileEvents.shift();
		if (this.connection === "online") this.enqueue(() => this.flushFileEvents());
	}

	private async flushFileEvents(): Promise<void> {
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

	private onSendError(e: unknown): void {
		// Unreachable server, or a bucket deleted from the web UI (404): reconnect recreates it.
		if (e instanceof AwError && (e.status === null || e.status === 404)) {
			if (this.connection === "online") this.goOffline(e);
			return;
		}
		this.lastError = e instanceof Error ? e.message : String(e);
		this.renderStatus();
	}

	private renderStatus(): void {
		const el = this.statusEl;
		if (!el) return;
		let text: string;
		let tip: string;
		if (this.settings.paused) {
			text = "AW: paused";
			tip = "ActivityWatch tracking is paused. Click to resume.";
		} else if (this.connection === "connecting") {
			text = "AW: connecting";
			tip = `Connecting to ${this.settings.serverUrl}`;
		} else if (this.connection === "offline") {
			text = "AW: offline";
			tip = `${this.lastError || "ActivityWatch is not reachable"}\nClick to retry now.`;
		} else {
			const state = this.currentState();
			const file = this.app.workspace.getActiveFile();
			const excluded = file instanceof TFile && isExcluded(file.path, this.excluded);
			text = excluded ? "AW: excluded" : state === "active" ? "AW: tracking" : `AW: ${state}`;
			tip = excluded
				? "This note matches an exclusion pattern and is not reported."
				: `Reporting to ${this.settings.serverUrl} as ${activityBucketId(this.host)}. Click to pause.`;
			if (this.lastError) tip += `\nLast error: ${this.lastError}`;
		}
		el.setText(text);
		el.setAttr("aria-label", tip);
		el.setAttr("data-tooltip-position", "top");
		el.toggleClass("is-offline", this.connection === "offline" && !this.settings.paused);
	}
}
