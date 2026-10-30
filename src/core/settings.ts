export interface WatcherSettings {
	// Base URL of the aw-server REST API (5600 = production, 5666 = testing).
	serverUrl: string;
	// Seconds between heartbeats for the open note while you are active.
	heartbeatSeconds: number;
	// Only report activity while an Obsidian window has OS focus.
	focusOnly: boolean;
	// Stop reporting after this many minutes without keyboard/mouse input in Obsidian. 0 = never.
	idleMinutes: number;
	// Record create / rename / delete events in a separate bucket.
	trackFileEvents: boolean;
	// Vault-relative glob patterns that are never reported.
	excludePatterns: string[];
	// Include the vault's absolute folder path in event data.
	sendVaultPath: boolean;
	// Tracking switched off by the user (persisted, so it survives restarts).
	paused: boolean;
}

export const DEFAULT_SETTINGS: WatcherSettings = {
	serverUrl: "http://127.0.0.1:5600",
	heartbeatSeconds: 10,
	focusOnly: true,
	idleMinutes: 5,
	trackFileEvents: true,
	excludePatterns: [],
	sendVaultPath: true,
	paused: false,
};

export const HEARTBEAT_MIN = 2;
export const HEARTBEAT_MAX = 60;
export const IDLE_MAX = 240;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

// Accepts "host:port", "http://host:port/", "http://host:port/api/0" and returns "http://host:port".
export function normalizeServerUrl(raw: unknown): string {
	if (typeof raw !== "string") return DEFAULT_SETTINGS.serverUrl;
	let url = raw.trim();
	if (url === "") return DEFAULT_SETTINGS.serverUrl;
	if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
	url = url.replace(/\/+$/, "").replace(/\/api\/0$/i, "");
	return url;
}

export function parsePatterns(raw: unknown): string[] {
	const lines = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\r?\n/) : [];
	return lines
		.filter((l): l is string => typeof l === "string")
		.map((l) => l.trim())
		.filter((l) => l !== "" && !l.startsWith("#"));
}

// Turns whatever loadData() returned (null, an older shape, hand edits) into valid settings.
export function normalizeSettings(raw: unknown): WatcherSettings {
	const src = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const d = DEFAULT_SETTINGS;
	return {
		serverUrl: normalizeServerUrl(src.serverUrl),
		heartbeatSeconds: clampInt(src.heartbeatSeconds, HEARTBEAT_MIN, HEARTBEAT_MAX, d.heartbeatSeconds),
		focusOnly: bool(src.focusOnly, d.focusOnly),
		idleMinutes: clampInt(src.idleMinutes, 0, IDLE_MAX, d.idleMinutes),
		trackFileEvents: bool(src.trackFileEvents, d.trackFileEvents),
		excludePatterns: parsePatterns(src.excludePatterns),
		sendVaultPath: bool(src.sendVaultPath, d.sendVaultPath),
		paused: bool(src.paused, d.paused),
	};
}
