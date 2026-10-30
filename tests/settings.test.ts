import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, HEARTBEAT_MAX, normalizeServerUrl, normalizeSettings, parsePatterns } from "../src/core/settings";

describe("normalizeSettings", () => {
	it("returns defaults for null / garbage", () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings("x")).toEqual(DEFAULT_SETTINGS);
	});

	it("clamps numbers and rejects wrong types", () => {
		const s = normalizeSettings({ heartbeatSeconds: 9999, idleMinutes: -3, focusOnly: "yes", paused: true });
		expect(s.heartbeatSeconds).toBe(HEARTBEAT_MAX);
		expect(s.idleMinutes).toBe(0);
		expect(s.focusOnly).toBe(DEFAULT_SETTINGS.focusOnly);
		expect(s.paused).toBe(true);
	});

	it("accepts numeric strings", () => {
		expect(normalizeSettings({ heartbeatSeconds: "15" }).heartbeatSeconds).toBe(15);
	});
});

describe("normalizeServerUrl", () => {
	it("adds scheme and strips trailing slash and /api/0", () => {
		expect(normalizeServerUrl("localhost:5666")).toBe("http://localhost:5666");
		expect(normalizeServerUrl("http://127.0.0.1:5600/api/0/")).toBe("http://127.0.0.1:5600");
		expect(normalizeServerUrl("  ")).toBe(DEFAULT_SETTINGS.serverUrl);
		expect(normalizeServerUrl(42)).toBe(DEFAULT_SETTINGS.serverUrl);
	});
});

describe("parsePatterns", () => {
	it("drops blanks and comments from text or arrays", () => {
		expect(parsePatterns("Private/\n\n# note\n  *.secret.md ")).toEqual(["Private/", "*.secret.md"]);
		expect(parsePatterns(["a", 3, ""])).toEqual(["a"]);
	});
});
