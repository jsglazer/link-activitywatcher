"use strict";
(() => {
  // src/core/events.ts
  var WATCHER_NAME = "aw-watcher-obsidian";
  var ACTIVITY_BUCKET_TYPE = "app.editor.activity";

  // src/core/report.ts
  var DAY_MS = 864e5;
  var MAX_DAILY_PERIODS = 62;
  function selectBuckets(buckets, hostname) {
    const ours = Object.values(buckets).filter((b) => b.type === ACTIVITY_BUCKET_TYPE && (b.client === WATCHER_NAME || b.id.startsWith(`${WATCHER_NAME}_`)));
    const forHost = ours.filter((b) => b.hostname === hostname || b.id === `${WATCHER_NAME}_${hostname}`);
    return (forHost.length > 0 ? forHost : ours).map((b) => b.id).sort();
  }
  function dayPeriods(start, end) {
    const s = Date.parse(start);
    const e = Date.parse(end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return [];
    if ((e - s) / DAY_MS > MAX_DAILY_PERIODS + 1) return [{ start: new Date(s).toISOString(), end: new Date(e).toISOString() }];
    const out = [];
    const t = new Date(s);
    while (t.getTime() < e) {
      const from = t.getTime();
      t.setDate(t.getDate() + 1);
      if (Math.min(t.getTime(), e) - from < 36e5 && out.length > 0) {
        out[out.length - 1].end = new Date(e).toISOString();
        break;
      }
      out.push({ start: new Date(from).toISOString(), end: new Date(Math.min(t.getTime(), e)).toISOString() });
    }
    return out;
  }
  function buildQuery(bucketId) {
    return [`events = query_bucket(${JSON.stringify(bucketId)});`, `RETURN = merge_events_by_keys(events, ["project", "file"]);`];
  }
  function str(v) {
    return typeof v === "string" ? v : "";
  }
  function vaultOf(data) {
    const vault = str(data.vault);
    if (vault) return vault;
    const path = str(data.projectPath).replace(/[\\/]+$/, "");
    if (path) return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
    return str(data.project);
  }
  function splitFile(file) {
    const slash = file.lastIndexOf("/");
    const base = file.slice(slash + 1);
    return { name: base.replace(/\.md$/i, ""), folder: slash > 0 ? file.slice(0, slash) : "" };
  }
  function buildTree(perPeriod) {
    const projects = /* @__PURE__ */ new Map();
    for (const events of perPeriod) {
      for (const ev of events) {
        const project = str(ev.data.project) || "(no project)";
        const file = str(ev.data.file).replace(/^\/+/, "");
        if (!file) continue;
        let files = projects.get(project);
        if (!files) projects.set(project, files = /* @__PURE__ */ new Map());
        const node = files.get(file);
        if (node) node.seconds += ev.duration;
        else files.set(file, { file, ...splitFile(file), vault: vaultOf(ev.data), seconds: ev.duration });
      }
    }
    const out = [];
    for (const [project, files] of projects) {
      const list = [...files.values()].filter((f) => f.seconds >= 1).sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));
      const seconds = list.reduce((sum, f) => sum + f.seconds, 0);
      if (list.length > 0) out.push({ project, seconds, files: list });
    }
    return out.sort((a, b) => b.seconds - a.seconds || a.project.localeCompare(b.project));
  }
  function daySlices(periods, perPeriod) {
    return periods.map((p, i) => {
      var _a, _b;
      const byProject = {};
      for (const ev of (_a = perPeriod[i]) != null ? _a : []) {
        const project = str(ev.data.project) || "(no project)";
        byProject[project] = ((_b = byProject[project]) != null ? _b : 0) + ev.duration;
      }
      return { start: p.start, byProject };
    });
  }
  function combineBuckets(results) {
    const out = [];
    for (const perPeriod of results) perPeriod.forEach((events, i) => {
      var _a;
      return out[i] = ((_a = out[i]) != null ? _a : []).concat(events);
    });
    return out;
  }
  function formatDuration(seconds) {
    const s = Math.round(seconds);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  }
  function obsidianUri(vault, file) {
    return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`;
  }

  // src/vis/main.ts
  var SLOTS = 8;
  var STORE_COLORS = "link-aw.colors";
  var STORE_OPEN = "link-aw.open";
  var API = `${location.origin}/api/0`;
  function readStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
    }
  }
  async function api(path, init) {
    const res = await fetch(`${API}/${path}`, init);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return await res.json();
  }
  function assignColors(projects) {
    const saved = readStore(STORE_COLORS, {});
    const used = new Set(projects.map((p) => saved[p]).filter((s) => s !== void 0));
    for (const p of projects) {
      if (saved[p] !== void 0) continue;
      let slot = -1;
      for (let i = 0; i < SLOTS; i++) if (!used.has(i)) {
        slot = i;
        break;
      }
      if (slot >= 0) {
        for (const k of Object.keys(saved)) if (saved[k] === slot) delete saved[k];
        saved[p] = slot;
        used.add(slot);
      }
    }
    writeStore(STORE_COLORS, saved);
    return new Map(projects.map((p) => {
      var _a;
      return [p, (_a = saved[p]) != null ? _a : SLOTS];
    }));
  }
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== void 0) node.textContent = text;
    return node;
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  }
  var tooltip = null;
  function showTip(target, html) {
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
  function hideTip() {
    if (tooltip) tooltip.style.display = "none";
  }
  function dayLabel(iso, count) {
    const d = new Date(iso);
    if (count <= 7) return d.toLocaleDateString(void 0, { weekday: "short" });
    return String(d.getDate());
  }
  function renderChart(width, slices, order, colors) {
    const max = Math.max(...slices.map((s) => Object.values(s.byProject).reduce((a, b) => a + b, 0)), 1);
    const W = Math.max(160, Math.floor(width));
    const H = 96;
    const gutter = 46;
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
      const stack = order.filter((p) => {
        var _a;
        return ((_a = slice.byProject[p]) != null ? _a : 0) > 0;
      });
      let y = base;
      const g = svg("g", {});
      stack.forEach((p, j) => {
        var _a, _b;
        const h = ((_a = slice.byProject[p]) != null ? _a : 0) / max * (base - top);
        const isTop = j === stack.length - 1;
        const gap = j > 0 ? 2 : 0;
        const segH = Math.max(0, h - gap);
        y -= h;
        if (segH < 0.5) return;
        const r = Math.min(4, barW / 2, segH);
        const d = isTop ? `M${x},${y + segH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + segH} Z` : `M${x},${y + segH} V${y} H${x + barW} V${y + segH} Z`;
        g.append(svg("path", { d, class: `fill s${(_b = colors.get(p)) != null ? _b : SLOTS}` }));
      });
      const hit = svg("rect", { x: gutter + i * step, y: 0, width: step, height: base, class: "hit" });
      const date = new Date(slice.start).toLocaleDateString(void 0, { weekday: "short", month: "short", day: "numeric" });
      const lines = [`${date} \xB7 ${formatDuration(total)}`, ...stack.slice().reverse().map((p) => {
        var _a;
        return `${p}: ${formatDuration((_a = slice.byProject[p]) != null ? _a : 0)}`;
      })];
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
  function commonFolder(project) {
    var _a;
    const parts = project.files.map((f) => f.folder ? f.folder.split("/") : []);
    const first = (_a = parts[0]) != null ? _a : [];
    let n = first.length;
    for (const p of parts) {
      let i = 0;
      while (i < n && p[i] === first[i]) i++;
      n = i;
    }
    return first.slice(0, n).join("/");
  }
  function renderTree(tree, colors, total) {
    var _a, _b;
    const open = new Set(readStore(STORE_OPEN, []));
    const list = el("div", "tree");
    for (const project of tree) {
      const details = el("details", "project");
      details.open = open.has(project.project);
      const summary = el("summary", "row");
      const sw = el("span", `swatch s${(_a = colors.get(project.project)) != null ? _a : SLOTS}`);
      const name = el("span", "name", project.project);
      const meta = el("span", "meta", `${project.files.length} note${project.files.length === 1 ? "" : "s"}`);
      const share = el("span", "share");
      const shareFill = el("span", `share-fill s${(_b = colors.get(project.project)) != null ? _b : SLOTS}`);
      shareFill.style.width = `${project.seconds / Math.max(total, 1) * 100}%`;
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
        li.append(a, el("span", "folder", sub), el("span", "time", formatDuration(f.seconds)));
        files.append(li);
      }
      details.append(files);
      list.append(details);
    }
    return list;
  }
  function fitFrame() {
    const frame = window.frameElement;
    if (!frame) return;
    try {
      frame.style.width = "100%";
      frame.style.border = "0";
      const col = frame.closest("[class*='col-']");
      col == null ? void 0 : col.classList.add("col-md-12", "col-lg-12");
      const resize = () => frame.style.height = `${document.documentElement.scrollHeight}px`;
      new ResizeObserver(resize).observe(document.body);
      resize();
    } catch (e) {
    }
  }
  async function applyTheme() {
    try {
      const settings = await api("settings");
      if (settings.theme === "dark" || settings.theme === "light") document.documentElement.dataset.theme = settings.theme;
    } catch (e) {
    }
  }
  async function main() {
    var _a, _b, _c;
    const app = document.getElementById("app");
    if (!app) return;
    fitFrame();
    const params = new URLSearchParams(location.search);
    const hostname = (_a = params.get("hostname")) != null ? _a : "";
    const start = (_b = params.get("start")) != null ? _b : "";
    const end = (_c = params.get("end")) != null ? _c : "";
    await applyTheme();
    const periods = dayPeriods(start, end);
    if (periods.length === 0) {
      app.replaceChildren(el("p", "empty", "Open this from an ActivityWatch Activity view (it needs a host and time range)."));
      return;
    }
    try {
      const buckets = await api("buckets/");
      const ids = selectBuckets(buckets, hostname);
      if (ids.length === 0) {
        app.replaceChildren(el("p", "empty", "No Obsidian bucket found. Is the Link ActivityWatcher plugin enabled and connected?"));
        return;
      }
      const timeperiods = periods.map((p) => `${p.start}/${p.end}`);
      const results = await Promise.all(
        ids.map(
          (id) => api("query/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ timeperiods, query: buildQuery(id) })
          })
        )
      );
      const perPeriod = combineBuckets(results);
      const tree = buildTree(perPeriod);
      const total = tree.reduce((s, p) => s + p.seconds, 0);
      const head = el("div", "head");
      head.append(el("span", "total", formatDuration(total)), el("span", "sub", ` in Obsidian \xB7 ${tree.length} project${tree.length === 1 ? "" : "s"}`));
      const nodes = [head];
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
})();
