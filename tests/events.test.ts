import { describe, expect, it } from "vitest";
import {
	activityBucketId,
	activityEvent,
	closingEvent,
	compilePatterns,
	compileProjectRules,
	fileEvent,
	fileEventBucketId,
	globToRegExp,
	isExcluded,
	languageFor,
	projectFor,
	pulsetimeFor,
	type EnvInfo,
} from "../src/core/events";

const env: EnvInfo = { vault: "VaultDEV", vaultPath: "/Users/j/VaultDEV", editorVersion: "1.14.4", projectRules: [] };
const now = new Date("2026-10-30T12:00:00.000Z");

describe("bucket ids", () => {
	it("follow the aw-watcher-<name>_<host> convention", () => {
		expect(activityBucketId("MBA")).toBe("aw-watcher-obsidian_MBA");
		expect(fileEventBucketId("MBA")).toBe("aw-watcher-obsidian-fileevents_MBA");
	});
});

describe("languageFor", () => {
	it("maps known extensions and falls back to upper case", () => {
		expect(languageFor("md")).toBe("Markdown");
		expect(languageFor(".PNG")).toBe("Image");
		expect(languageFor("canvas")).toBe("Canvas");
		expect(languageFor("csv")).toBe("CSV");
		expect(languageFor("")).toBe("Unknown");
	});
});

describe("activityEvent", () => {
	it("uses the editor-activity keys the aw-webui Editor view reads", () => {
		const e = activityEvent({ path: "Notes/A.md", extension: "md" }, env, now);
		expect(e).toEqual({
			timestamp: "2026-10-30T12:00:00.000Z",
			duration: 0,
			data: { file: "/Notes/A.md", project: "VaultDEV", vault: "VaultDEV", language: "Markdown", editor: "Obsidian", editorVersion: "1.14.4", projectPath: "/Users/j/VaultDEV" },
		});
	});

	it("omits projectPath when disabled", () => {
		const e = activityEvent({ path: "A.md", extension: "md" }, { ...env, vaultPath: null }, now);
		expect(e.data).not.toHaveProperty("projectPath");
	});
});

describe("fileEvent", () => {
	it("records the kind and the old path on rename", () => {
		const e = fileEvent("rename", { path: "B.md", extension: "md" }, env, now, "A.md");
		expect(e.data.eventType).toBe("rename");
		expect(e.data.oldFile).toBe("/A.md");
		expect(e.data.file).toBe("/B.md");
		expect(fileEvent("delete", { path: "B.md", extension: "md" }, env, now).data).not.toHaveProperty("oldFile");
	});
});

describe("pulsetimeFor", () => {
	it("always exceeds the interval by at least 5 s", () => {
		expect(pulsetimeFor(2)).toBe(7);
		expect(pulsetimeFor(10)).toBe(15);
		expect(pulsetimeFor(60)).toBe(90);
	});
});

describe("exclusion globs", () => {
	const ex = compilePatterns(["Private/", "*.secret.md", "Journal/**/draft-*", "Daily/2026-??-01.md"]);

	it("excludes whole folders", () => {
		expect(isExcluded("Private/a.md", ex)).toBe(true);
		expect(isExcluded("Private/deep/b.md", ex)).toBe(true);
		expect(isExcluded("NotPrivate/a.md", ex)).toBe(false);
	});

	it("matches slash-less patterns by file name in any folder", () => {
		expect(isExcluded("x.secret.md", ex)).toBe(true);
		expect(isExcluded("a/b/x.secret.md", ex)).toBe(true);
		expect(isExcluded("a/x.secret.md.bak", ex)).toBe(false);
	});

	it("supports ** across folders and ? within a segment", () => {
		expect(isExcluded("Journal/draft-1.md", ex)).toBe(true);
		expect(isExcluded("Journal/2026/10/draft-1.md", ex)).toBe(true);
		expect(isExcluded("Daily/2026-10-01.md", ex)).toBe(true);
		expect(isExcluded("Daily/2026-1-01.md", ex)).toBe(false);
	});

	it("is case-insensitive and escapes regex characters", () => {
		expect(globToRegExp("a+b (1).md").test("A+B (1).md")).toBe(true);
		expect(globToRegExp("a.md").test("aXmd")).toBe(false);
	});
});

describe("project rules", () => {
	const rules = compileProjectRules(["Classes/2026-B/*", "/Projects/", "Archive/**"]);

	it("uses the folder matched by * as the project", () => {
		expect(projectFor("Classes/2026-B/Econ - PUBP 720/Inventory/6.3.1 Isoquants.md", rules)).toBe("Econ - PUBP 720");
		expect(projectFor("Classes/2026-B/RD - POGO 801/x.md", rules)).toBe("RD - POGO 801");
	});

	it("needs the note to be inside the folder, not just share a prefix", () => {
		expect(projectFor("Classes/2026-B/loose-note.md", rules)).toBeNull();
		expect(projectFor("Classes/2026-A/Old/x.md", rules)).toBeNull();
	});

	it("accepts a plain folder (leading/trailing slashes ignored) and is case-insensitive", () => {
		expect(projectFor("projects/a/b.md", rules)).toBe("projects");
	});

	it("a trailing /** means the folder itself; ** mid-rule spans folders", () => {
		expect(projectFor("Archive/2025/Fall/x.md", rules)).toBe("Archive");
		const r = compileProjectRules(["Terms/**/Week*"]);
		expect(projectFor("Terms/2026/B/Week 3/x.md", r)).toBe("Week 3");
		expect(projectFor("Terms/Week 1/x.md", r)).toBe("Week 1");
	});

	it("first matching rule wins", () => {
		const r = compileProjectRules(["Classes/*", "Classes/2026-B/*"]);
		expect(projectFor("Classes/2026-B/Data - POGO 511/x.md", r)).toBe("2026-B");
	});

	it("feeds the event's project and keeps the vault name in `vault`", () => {
		const e = activityEvent({ path: "Classes/2026-B/Data - POGO 511/w1.md", extension: "md" }, { ...env, projectRules: rules }, now);
		expect(e.data.project).toBe("Data - POGO 511");
		expect(e.data.vault).toBe("VaultDEV");
		expect(activityEvent({ path: "Other/x.md", extension: "md" }, { ...env, projectRules: rules }, now).data.project).toBe("VaultDEV");
	});
});

describe("closingEvent", () => {
	const note = (path: string, at: Date) => activityEvent({ path, extension: "md" }, env, at);
	const later = (s: number) => new Date(now.getTime() + s * 1000);

	it("re-sends the note being left, stamped just before the new note's first beat", () => {
		const closing = closingEvent(note("A.md", now), note("B.md", later(7)), 15);
		expect(closing?.data.file).toBe("/A.md");
		expect(closing?.timestamp).toBe(new Date(later(7).getTime() - 1).toISOString());
	});

	it("does nothing for the same note, a first beat, or a beat too old to merge", () => {
		expect(closingEvent(note("A.md", now), note("A.md", later(7)), 15)).toBeNull();
		expect(closingEvent(null, note("A.md", now), 15)).toBeNull();
		expect(closingEvent(note("A.md", now), note("B.md", later(16)), 15)).toBeNull();
	});
});
