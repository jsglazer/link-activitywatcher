import { describe, expect, it } from "vitest";
import { activityState, backoffMs } from "../src/core/activity";

const base = { now: 1_000_000, focused: true, lastInputAt: 1_000_000, paused: false, focusOnly: true, idleMinutes: 5 };

describe("activityState", () => {
	it("is active when focused and recently used", () => {
		expect(activityState(base)).toBe("active");
	});

	it("pause wins over everything", () => {
		expect(activityState({ ...base, paused: true, focused: false })).toBe("paused");
	});

	it("respects focusOnly", () => {
		expect(activityState({ ...base, focused: false })).toBe("unfocused");
		expect(activityState({ ...base, focused: false, focusOnly: false })).toBe("active");
	});

	it("goes idle after the timeout, never when timeout is 0", () => {
		const later = base.now + 5 * 60_000 + 1;
		expect(activityState({ ...base, now: later })).toBe("idle");
		expect(activityState({ ...base, now: base.now + 5 * 60_000 })).toBe("active");
		expect(activityState({ ...base, now: later, idleMinutes: 0 })).toBe("active");
	});
});

describe("backoffMs", () => {
	it("doubles from 5 s and caps at 5 min", () => {
		expect([0, 1, 2, 3].map(backoffMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
		expect(backoffMs(50)).toBe(300_000);
		expect(backoffMs(-1)).toBe(5_000);
	});
});
