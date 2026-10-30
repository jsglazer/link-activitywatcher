// ActivityWatch custom visualization: project → note tree with a daily
// stacked bar chart. aw-webui loads this page in an iframe at
// /pages/aw-watcher-obsidian/?hostname=&start=&end=&title= (same origin as aw-server).

import {
	buildQuery,
	buildTree,
	combineBuckets,
	dayPeriods,
	daySlices,
	formatDuration,
	obsidianUri,
	selectBuckets,
	type BucketInfo,
	type DaySlice,
	type MergedEvent,
	type ProjectNode,
} from "../core/report";

const SLOTS = 8; // categorical palette size (styles in index.html); later projects share the "other" color
const STORE_COLORS = "link-aw.colors";
const STORE_OPEN = "link-aw.open";

// Served by aw-server itself, so the API is same-origin (no CORS).
const API = `${location.origin}/api/0`;

function readStore<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function writeStore(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// storage unavailable: colors/expansion just won't persist
	}
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${API}/${path}`, init);
	if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
	return (await res.json()) as T;
}

// Color follows the project, not its rank: slots persist across periods.
function assignColors(projects: string[]): Map<string, number> {
	const saved = readStore<Record<string, number>>(STORE_COLORS, {});
	const used = new Set(projects.map((p) => saved[p]).filter((s) => s !== undefined));
	for (const p of projects) {
		if (saved[p] !== undefined) continue;
		let slot = -1;
		for (let i = 0; i < SLOTS; i++) if (!used.has(i)) { slot = i; break; }
		if (slot >= 0) {
			// Free the slot from any project not on screen that held it.
			for (const k of Object.keys(saved)) if (saved[k] === slot) delete saved[k];
			saved[p] = slot;
			used.add(slot);
		}
	}
	writeStore(STORE_COLORS, saved);
	return new Map(projects.map((p) => [p, saved[p] ?? SLOTS]));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text !== undefined) node.textContent = text;
	return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
	const node = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	return node;
}

let tooltip: HTMLElement | null = null;
function showTip(target: Element, html: string[]): void {
	if (!tooltip) {
		tooltip = el("div", "tip");
		document.body.append(tooltip);
	}
	tooltip.replaceChildren(...html.map((line, i) => el("div", i === 0 ? "tip-head" : "", line)));
	const r = target.getBoundingClientRect();
	tooltip.style.display = "block";
	const w = tooltip.offsetWidth;
	tooltip.style.left = `${Math.max(4, Math.min(document.documentElement.clientWidth - w - 4, r.left + r.width / 2 - w / 2))}px`;
	tooltip.style.top = `${Math.max(4, r.top - tooltip.offsetHeight - 6)}px`;
}
function hideTip(): void {
	if (tooltip) tooltip.style.display = "none";
}

function dayLabel(iso: string, count: number): string {
	const d = new Date(iso);
	if (count <= 7) return d.toLocaleDateString(undefined, { weekday: "short" });
	return String(d.getDate());
}

// Drawn at the real pixel width (no viewBox scaling, so text never stretches);
// the caller redraws it when the width changes.
function renderChart(width: number, slices: DaySlice[], order: string[], colors: Map<string, number>): SVGSVGElement {
	const max = Math.max(...slices.map((s) => Object.values(s.byProject).reduce((a, b) => a + b, 0)), 1);
	const W = Math.max(160, Math.floor(width));
	const H = 96;
	const gutter = 46; // left margin for the scale label
	const top = 8;
	const base = H - 16;
	const step = (W - gutter) / slices.length;
	const barW = Math.max(3, Math.min(28, step * 0.62));
	const root = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Time per project per day" });
	root.append(svg("line", { x1: gutter, x2: W, y1: top + 0.5, y2: top + 0.5, class: "grid" }));
	root.append(svg("line", { x1: gutter, x2: W, y1: base + 0.5, y2: base + 0.5, class: "axis" }));
	const labelEvery = Math.ceil(slices.length / Math.max(1, Math.floor((W - gutter) / 34)));

	slices.forEach((slice, i) => {
		const x = gutter + i * step + (step - barW) / 2;
		const total = Object.values(slice.byProject).reduce((a, b) => a + b, 0);
		const stack = order.filter((p) => (slice.byProject[p] ?? 0) > 0);
		let y = base;
		const g = svg("g", {});
		stack.forEach((p, j) => {
			const h = ((slice.byProject[p] ?? 0) / max) * (base - top);
			const isTop = j === stack.length - 1;
			const gap = j > 0 ? 2 : 0; // 2px surface gap between stacked segments
			const segH = Math.max(0, h - gap);
			y -= h;
			if (segH < 0.5) return;
			const r = Math.min(4, barW / 2, segH);
			const d = isTop
				? `M${x},${y + segH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + segH} Z`
				: `M${x},${y + segH} V${y} H${x + barW} V${y + segH} Z`;
			g.append(svg("path", { d, class: `fill s${colors.get(p) ?? SLOTS}` }));
		});
		// Hit target wider and taller than the bar.
		const hit = svg("rect", { x: gutter + i * step, y: 0, width: step, height: base, class: "hit" });
		const date = new Date(slice.start).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
		const lines = [`${date} · ${formatDuration(total)}`, ...stack.slice().reverse().map((p) => `${p}: ${formatDuration(slice.byProject[p] ?? 0)}`)];
		hit.addEventListener("mouseenter", () => showTip(hit, lines));
		hit.addEventListener("mouseleave", hideTip);
		g.append(hit);
		root.append(g);
		if (i % labelEvery === 0) {
			const t = svg("text", { x: gutter + i * step + step / 2, y: H - 3, class: "tick" });
			t.textContent = dayLabel(slice.start, slices.length);
			root.append(t);
		}
	});
	const peak = svg("text", { x: gutter - 6, y: top + 3.5, class: "tick peak" });
	peak.textContent = formatDuration(max);
	const zero = svg("text", { x: gutter - 6, y: base + 3.5, class: "tick peak" });
	zero.textContent = "0";
	root.append(peak, zero);
	return root;
}

// The longest folder prefix shared by every note in a project; shown once on
// the project row instead of on every file row.
function commonFolder(project: ProjectNode): string {
	const parts = project.files.map((f) => (f.folder ? f.folder.split("/") : []));
	const first = parts[0] ?? [];
	let n = first.length;
	for (const p of parts) {
		let i = 0;
		while (i < n && p[i] === first[i]) i++;
		n = i;
	}
	return first.slice(0, n).join("/");
}

function renderTree(tree: ProjectNode[], colors: Map<string, number>, total: number): HTMLElement {
	const open = new Set(readStore<string[]>(STORE_OPEN, []));
	const list = el("div", "tree");
	for (const project of tree) {
		const details = el("details", "project");
		details.open = open.has(project.project);
		const summary = el("summary", "row");
		const sw = el("span", `swatch s${colors.get(project.project) ?? SLOTS}`);
		const name = el("span", "name", project.project);
		const meta = el("span", "meta", `${project.files.length} note${project.files.length === 1 ? "" : "s"}`);
		const share = el("span", "share");
		const shareFill = el("span", `share-fill s${colors.get(project.project) ?? SLOTS}`);
		shareFill.style.width = `${(project.seconds / Math.max(total, 1)) * 100}%`;
		share.append(shareFill);
		const time = el("span", "time", formatDuration(project.seconds));
		summary.append(el("span", "chev"), sw, name, meta, share, time);
		details.append(summary);
		details.addEventListener("toggle", () => {
			if (details.open) open.add(project.project);
			else open.delete(project.project);
			writeStore(STORE_OPEN, [...open]);
		});

		const prefix = commonFolder(project);
		const files = el("ul", "files");
		for (const f of project.files) {
			const li = el("li", "file");
			const a = el("a", "fname", f.name);
			a.href = obsidianUri(f.vault, f.file);
			a.title = `Open ${f.file} in Obsidian (${f.vault})`;
			const sub = prefix && f.folder.startsWith(prefix) ? f.folder.slice(prefix.length).replace(/^\//, "") : f.folder;
			// Folder span is always present (possibly empty) so the time stays in the last grid column.
			li.append(a, el("span", "folder", sub), el("span", "time", formatDuration(f.seconds)));
			files.append(li);
		}
		details.append(files);
		list.append(details);
	}
	return list;
}

// aw-webui gives the iframe the browser default 300×150. The page is same-origin,
// so it sizes its own frame to its content and takes the full row width.
function fitFrame(): void {
	const frame = window.frameElement as HTMLIFrameElement | null;
	if (!frame) return;
	try {
		frame.style.width = "100%";
		frame.style.border = "0";
		const col = frame.closest<HTMLElement>("[class*='col-']");
		col?.classList.add("col-md-12", "col-lg-12");
		const resize = () => (frame.style.height = `${document.documentElement.scrollHeight}px`);
		new ResizeObserver(resize).observe(document.body);
		resize();
	} catch {
		// cross-origin (should not happen under aw-server): keep the default size
	}
}

async function applyTheme(): Promise<void> {
	try {
		const settings = await api<{ theme?: string }>("settings");
		if (settings.theme === "dark" || settings.theme === "light") document.documentElement.dataset.theme = settings.theme;
	} catch {
		// "auto" or no settings endpoint: follow the OS via prefers-color-scheme
	}
}

async function main(): Promise<void> {
	const app = document.getElementById("app");
	if (!app) return;
	fitFrame();
	const params = new URLSearchParams(location.search);
	const hostname = params.get("hostname") ?? "";
	const start = params.get("start") ?? "";
	const end = params.get("end") ?? "";
	await applyTheme();

	const periods = dayPeriods(start, end);
	if (periods.length === 0) {
		app.replaceChildren(el("p", "empty", "Open this from an ActivityWatch Activity view (it needs a host and time range)."));
		return;
	}

	try {
		const buckets = await api<Record<string, BucketInfo>>("buckets/");
		const ids = selectBuckets(buckets, hostname);
		if (ids.length === 0) {
			app.replaceChildren(el("p", "empty", "No Obsidian bucket found. Is the Link ActivityWatcher plugin enabled and connected?"));
			return;
		}
		const timeperiods = periods.map((p) => `${p.start}/${p.end}`);
		const results = await Promise.all(
			ids.map((id) =>
				api<MergedEvent[][]>("query/", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ timeperiods, query: buildQuery(id) }),
				}),
			),
		);
		const perPeriod = combineBuckets(results);
		const tree = buildTree(perPeriod);
		const total = tree.reduce((s, p) => s + p.seconds, 0);

		const head = el("div", "head");
		head.append(el("span", "total", formatDuration(total)), el("span", "sub", ` in Obsidian · ${tree.length} project${tree.length === 1 ? "" : "s"}`));
		const nodes: HTMLElement[] = [head];
		if (tree.length === 0) {
			nodes.push(el("p", "empty", "No Obsidian activity in this period."));
		} else {
			const order = tree.map((p) => p.project);
			const colors = assignColors(order);
			const chart = el("div", "chart");
			if (periods.length > 1) nodes.push(chart);
			nodes.push(renderTree(tree, colors, total));
			app.replaceChildren(...nodes);
			if (periods.length > 1) {
				const slices = daySlices(periods, perPeriod);
				let drawnWidth = -1;
				const draw = () => {
					const w = chart.clientWidth;
					if (w === drawnWidth) return;
					drawnWidth = w;
					chart.replaceChildren(renderChart(w, slices, order, colors));
				};
				new ResizeObserver(draw).observe(chart);
				draw();
			}
			return;
		}
		app.replaceChildren(...nodes);
	} catch (e) {
		app.replaceChildren(el("p", "empty error", `Could not load data: ${e instanceof Error ? e.message : String(e)}`));
	}
}

void main();
