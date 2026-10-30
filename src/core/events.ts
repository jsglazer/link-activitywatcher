// Shapes of the data ActivityWatch stores. The activity bucket uses type
// "app.editor.activity", whose `file` / `project` / `language` keys the
// aw-webui Editor view groups by (same keys as aw-watcher-vscode).

export const WATCHER_NAME = "aw-watcher-obsidian";
export const ACTIVITY_BUCKET_TYPE = "app.editor.activity";
export const FILE_EVENT_BUCKET_TYPE = "app.editor.fileevent";

export interface FileInfo {
	path: string; // vault-relative, no leading slash
	extension: string;
}

export interface EnvInfo {
	vault: string;
	vaultPath: string | null; // null = not sent
	editorVersion: string;
}

export type FileEventKind = "create" | "rename" | "delete";

export interface AwEvent {
	timestamp: string;
	duration: number;
	data: Record<string, string>;
}

export function activityBucketId(hostname: string): string {
	return `${WATCHER_NAME}_${hostname}`;
}

export function fileEventBucketId(hostname: string): string {
	return `${WATCHER_NAME}-fileevents_${hostname}`;
}

const LANGUAGES: Record<string, string> = {
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
	ogv: "Video",
};

export function languageFor(extension: string): string {
	const ext = extension.toLowerCase().replace(/^\./, "");
	if (ext === "") return "Unknown";
	return LANGUAGES[ext] ?? ext.toUpperCase();
}

function baseData(file: FileInfo, env: EnvInfo): Record<string, string> {
	const data: Record<string, string> = {
		file: `/${file.path}`,
		project: env.vault,
		language: languageFor(file.extension),
		editor: "Obsidian",
		editorVersion: env.editorVersion,
	};
	if (env.vaultPath !== null) data.projectPath = env.vaultPath;
	return data;
}

// Heartbeat payload for the note currently open. Identical data across beats
// is what lets aw-server merge consecutive beats into one long event.
export function activityEvent(file: FileInfo, env: EnvInfo, now: Date): AwEvent {
	return { timestamp: now.toISOString(), duration: 0, data: baseData(file, env) };
}

export function fileEvent(kind: FileEventKind, file: FileInfo, env: EnvInfo, now: Date, oldPath?: string): AwEvent {
	const data = baseData(file, env);
	data.eventType = kind;
	if (kind === "rename" && oldPath !== undefined) data.oldFile = `/${oldPath}`;
	return { timestamp: now.toISOString(), duration: 0, data };
}

// aw-server merges a heartbeat into the previous event when the data matches
// and it arrives within `pulsetime` seconds of that event's end. Allow a
// margin over the interval so a slightly late timer does not split the event.
export function pulsetimeFor(heartbeatSeconds: number): number {
	return heartbeatSeconds + Math.max(5, Math.ceil(heartbeatSeconds / 2));
}

function escapeRegExp(s: string): string {
	return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

// Glob → RegExp. `**` spans folders, `*` and `?` stay inside one path segment.
// A pattern ending in "/" matches everything under that folder. A pattern
// without "/" matches the file name in any folder (like .gitignore).
export function globToRegExp(pattern: string): RegExp {
	let p = pattern.trim().replace(/^\/+/, "");
	if (p.endsWith("/")) p += "**";
	const anchored = p.includes("/");
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
	return new RegExp(anchored ? `^${out}$` : `(?:^|/)${out}$`, "i");
}

export function compilePatterns(patterns: string[]): RegExp[] {
	return patterns.map(globToRegExp);
}

export function isExcluded(path: string, compiled: RegExp[]): boolean {
	return compiled.some((re) => re.test(path));
}
