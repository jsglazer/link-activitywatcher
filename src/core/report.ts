// Pure data shaping for the ActivityWatch custom visualization
// (aw-visualization/). No DOM, no fetch: the page passes in what aw-server returned.

import { ACTIVITY_BUCKET_TYPE, WATCHER_NAME } from "./events";

export interface MergedEvent {
	duration: number; // seconds
	data: Record<string, unknown>;
}

export interface Period {
	start: string; // ISO
	end: string; // ISO
}

export interface FileNode {
	file: string; // vault-relative, no leading slash
	name: string; // file name without .md
	folder: string; // parent folder, "" at vault root
	vault: string;
	seconds: number;
}

export interface ProjectNode {
	project: string;
	seconds: number;
	files: FileNode[];
}

export interface DaySlice {
	start: string;
	byProject: Record<string, number>;
}

export interface BucketInfo {
	id: string;
	type?: string;
	client?: string;
	hostname?: string;
}

const DAY_MS = 86_400_000;
export const MAX_DAILY_PERIODS = 62;

// Activity buckets written by this plugin (or the original aw-watcher-obsidian) for `hostname`.
// Falls back to every such bucket when none carries that hostname.
export function selectBuckets(buckets: Record<string, BucketInfo>, hostname: string): string[] {
	const ours = Object.values(buckets).filter((b) => b.type === ACTIVITY_BUCKET_TYPE && (b.client === WATCHER_NAME || b.id.startsWith(`${WATCHER_NAME}_`)));
	const forHost = ours.filter((b) => b.hostname === hostname || b.id === `${WATCHER_NAME}_${hostname}`);
	return (forHost.length > 0 ? forHost : ours).map((b) => b.id).sort();
}

// One period per local calendar day from `start` (which already carries AW's
// start-of-day offset). Stepping by calendar day rather than 24 h keeps the
// day boundary at the same local time across DST changes. Ranges longer than
// MAX_DAILY_PERIODS days come back as one period.
export function dayPeriods(start: string, end: string): Period[] {
	const s = Date.parse(start);
	const e = Date.parse(end);
	if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return [];
	if ((e - s) / DAY_MS > MAX_DAILY_PERIODS + 1) return [{ start: new Date(s).toISOString(), end: new Date(e).toISOString() }];
	const out: Period[] = [];
	const t = new Date(s);
	while (t.getTime() < e) {
		const from = t.getTime();
		t.setDate(t.getDate() + 1);
		// A trailing sliver under an hour is DST slack between AW's UTC end and local midnight, not a day.
		if (Math.min(t.getTime(), e) - from < 3_600_000 && out.length > 0) {
			out[out.length - 1].end = new Date(e).toISOString();
			break;
		}
		out.push({ start: new Date(from).toISOString(), end: new Date(Math.min(t.getTime(), e)).toISOString() });
	}
	return out;
}

// Query merging by project + file. Merging on a key an event lacks drops the
// event, so `vault` (added in 1.0.1) is not a merge key; it is read from data.
export function buildQuery(bucketId: string): string[] {
	return [`events = query_bucket(${JSON.stringify(bucketId)});`, `RETURN = merge_events_by_keys(events, ["project", "file"]);`];
}

function str(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function vaultOf(data: Record<string, unknown>): string {
	const vault = str(data.vault);
	if (vault) return vault;
	const path = str(data.projectPath).replace(/[\\/]+$/, "");
	if (path) return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
	return str(data.project);
}

function splitFile(file: string): { name: string; folder: string } {
	const slash = file.lastIndexOf("/");
	const base = file.slice(slash + 1);
	return { name: base.replace(/\.md$/i, ""), folder: slash > 0 ? file.slice(0, slash) : "" };
}

// Project → file tree, both sorted by time descending. `perPeriod` is the
// query result (one event list per period, possibly from several buckets).
export function buildTree(perPeriod: MergedEvent[][]): ProjectNode[] {
	const projects = new Map<string, Map<string, FileNode>>();
	for (const events of perPeriod) {
		for (const ev of events) {
			const project = str(ev.data.project) || "(no project)";
			const file = str(ev.data.file).replace(/^\/+/, "");
			if (!file) continue;
			let files = projects.get(project);
			if (!files) projects.set(project, (files = new Map()));
			const node = files.get(file);
			if (node) node.seconds += ev.duration;
			else files.set(file, { file, ...splitFile(file), vault: vaultOf(ev.data), seconds: ev.duration });
		}
	}
	const out: ProjectNode[] = [];
	for (const [project, files] of projects) {
		const list = [...files.values()].filter((f) => f.seconds >= 1).sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));
		const seconds = list.reduce((sum, f) => sum + f.seconds, 0);
		if (list.length > 0) out.push({ project, seconds, files: list });
	}
	return out.sort((a, b) => b.seconds - a.seconds || a.project.localeCompare(b.project));
}

export function daySlices(periods: Period[], perPeriod: MergedEvent[][]): DaySlice[] {
	return periods.map((p, i) => {
		const byProject: Record<string, number> = {};
		for (const ev of perPeriod[i] ?? []) {
			const project = str(ev.data.project) || "(no project)";
			byProject[project] = (byProject[project] ?? 0) + ev.duration;
		}
		return { start: p.start, byProject };
	});
}

// Combines per-bucket query results (each one list per period) into one list per period.
export function combineBuckets(results: MergedEvent[][][]): MergedEvent[][] {
	const out: MergedEvent[][] = [];
	for (const perPeriod of results) perPeriod.forEach((events, i) => (out[i] = (out[i] ?? []).concat(events)));
	return out;
}

export function formatDuration(seconds: number): string {
	const s = Math.round(seconds);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

export function obsidianUri(vault: string, file: string): string {
	return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`;
}
