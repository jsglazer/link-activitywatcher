import { describe, expect, it } from "vitest";
import { MAX_DAILY_PERIODS, buildQuery, buildTree, combineBuckets, dayPeriods, daySlices, formatDuration, obsidianUri, selectBuckets, type MergedEvent } from "../src/core/report";

const ev = (project: string, file: string, duration: number, extra: Record<string, string> = {}): MergedEvent => ({ duration, data: { project, file, ...extra } });

describe("selectBuckets", () => {
	const buckets = {
		"aw-watcher-obsidian_MBA": { id: "aw-watcher-obsidian_MBA", type: "app.editor.activity", client: "aw-watcher-obsidian", hostname: "MBA" },
		"aw-watcher-obsidian_Other": { id: "aw-watcher-obsidian_Other", type: "app.editor.activity", client: "aw-watcher-obsidian", hostname: "Other" },
		"aw-watcher-obsidian-fileevents_MBA": { id: "aw-watcher-obsidian-fileevents_MBA", type: "app.editor.fileevent", client: "aw-watcher-obsidian", hostname: "MBA" },
		"aw-watcher-vscode_MBA": { id: "aw-watcher-vscode_MBA", type: "app.editor.activity", client: "aw-watcher-vscode", hostname: "MBA" },
	};

	it("picks only this host's activity bucket", () => {
		expect(selectBuckets(buckets, "MBA")).toEqual(["aw-watcher-obsidian_MBA"]);
	});

	it("falls back to all Obsidian activity buckets for an unknown host", () => {
		expect(selectBuckets(buckets, "nope")).toEqual(["aw-watcher-obsidian_MBA", "aw-watcher-obsidian_Other"]);
	});
});

describe("dayPeriods", () => {
	it("splits a week into 7 days starting at the given offset", () => {
		const p = dayPeriods("2026-10-26T04:00:00.000Z", "2026-11-02T04:00:00.000Z");
		expect(p).toHaveLength(7);
		expect(p[0]).toEqual({ start: "2026-10-26T04:00:00.000Z", end: "2026-10-27T04:00:00.000Z" });
		expect(p[6].end).toBe("2026-11-02T04:00:00.000Z");
	});

	it("clips the last day and handles a single day", () => {
		expect(dayPeriods("2026-10-30T04:00:00Z", "2026-10-31T04:00:00Z")).toHaveLength(1);
		const p = dayPeriods("2026-10-30T00:00:00Z", "2026-10-31T12:00:00Z");
		expect(p[1].end).toBe("2026-10-31T12:00:00.000Z");
	});

	it("keeps local day boundaries across the DST change (Nov 1 2026, New York)", () => {
		// Mon Oct 26 04:00 EDT → Mon Nov 2 04:00 EST is 7 days but 169 hours.
		const p = dayPeriods("2026-10-26T08:00:00.000Z", "2026-11-02T09:00:00.000Z");
		expect(p).toHaveLength(7);
		expect(p[6]).toEqual({ start: "2026-11-01T09:00:00.000Z", end: "2026-11-02T09:00:00.000Z" });
		expect(p.map((x) => new Date(x.start).getHours())).toEqual([4, 4, 4, 4, 4, 4, 4]);
	});

	it("folds a sub-hour trailing sliver into the last day", () => {
		// End given at 04:00 EDT offset though the zone is already on EST: 1 h short of a day.
		const p = dayPeriods("2026-10-31T08:00:00.000Z", "2026-11-02T08:00:00.000Z");
		expect(p).toHaveLength(2);
		expect(p[1].end).toBe("2026-11-02T08:00:00.000Z");
	});

	it("returns one period for long ranges and none for bad input", () => {
		expect(dayPeriods("2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z")).toHaveLength(1);
		expect(MAX_DAILY_PERIODS).toBeGreaterThanOrEqual(31);
		expect(dayPeriods("", "x")).toEqual([]);
		expect(dayPeriods("2026-10-31T00:00:00Z", "2026-10-30T00:00:00Z")).toEqual([]);
	});
});

describe("buildQuery", () => {
	it("merges by project and file only (vault would drop pre-1.0.1 events)", () => {
		expect(buildQuery("b_1")).toEqual(['events = query_bucket("b_1");', 'RETURN = merge_events_by_keys(events, ["project", "file"]);']);
	});
});

describe("buildTree", () => {
	const day1 = [ev("Econ", "/Classes/Econ/a.md", 600, { vault: "VaultSchar" }), ev("RD", "/Classes/RD/x/b.md", 120, { vault: "VaultSchar" }), ev("Econ", "/Classes/Econ/z.md", 0.4)];
	const day2 = [ev("Econ", "/Classes/Econ/a.md", 60, { vault: "VaultSchar" }), ev("RD", "/Classes/RD/c.canvas", 900, { projectPath: "/Users/j/VaultSchar/" })];
	const tree = buildTree([day1, day2]);

	it("sums across periods and sorts projects and files by time", () => {
		expect(tree.map((p) => [p.project, p.seconds])).toEqual([
			["RD", 1020],
			["Econ", 660],
		]);
		expect(tree[0].files.map((f) => f.file)).toEqual(["Classes/RD/c.canvas", "Classes/RD/x/b.md"]);
	});

	it("drops sub-second files and splits name / folder", () => {
		expect(tree[1].files).toHaveLength(1);
		expect(tree[1].files[0]).toMatchObject({ name: "a", folder: "Classes/Econ", vault: "VaultSchar", seconds: 660 });
		expect(tree[0].files[0].name).toBe("c.canvas");
	});

	it("derives the vault from projectPath, then project, for older events", () => {
		expect(tree[0].files[0].vault).toBe("VaultSchar");
		expect(buildTree([[ev("VaultX", "/n.md", 5)]])[0].files[0]).toMatchObject({ vault: "VaultX", folder: "" });
	});
});

describe("daySlices / combineBuckets", () => {
	it("totals per project per period", () => {
		const periods = [{ start: "a", end: "b" }, { start: "b", end: "c" }];
		const merged = combineBuckets([[[ev("A", "/1.md", 10)], []], [[ev("A", "/2.md", 5), ev("B", "/3.md", 7)], [ev("B", "/3.md", 1)]]]);
		expect(daySlices(periods, merged)).toEqual([
			{ start: "a", byProject: { A: 15, B: 7 } },
			{ start: "b", byProject: { B: 1 } },
		]);
	});
});

describe("formatting", () => {
	it("formats durations compactly", () => {
		expect([5, 59.6, 61, 3599, 3600, 3725, 36000].map(formatDuration)).toEqual(["5s", "1m", "1m", "59m", "1h 00m", "1h 02m", "10h 00m"]);
	});

	it("builds an obsidian:// open link", () => {
		expect(obsidianUri("VaultSchar", "Classes/2026-B/Econ - PUBP 720/a&b.md")).toBe("obsidian://open?vault=VaultSchar&file=Classes%2F2026-B%2FEcon%20-%20PUBP%20720%2Fa%26b.md");
	});
});
