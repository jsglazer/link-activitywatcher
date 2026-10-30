import type { AwEvent } from "./events";

// Minimal ActivityWatch REST client (API v0). HTTP is injected so the shell
// can use Obsidian's requestUrl (no CORS) and tests can use a fake.

export interface HttpRequest {
	url: string;
	method: "GET" | "POST";
	body?: string;
}

export interface HttpResponse {
	status: number;
	text: string;
}

export type HttpFn = (req: HttpRequest) => Promise<HttpResponse>;

export class AwError extends Error {
	constructor(
		message: string,
		readonly status: number | null, // null = server unreachable
	) {
		super(message);
		this.name = "AwError";
	}
}

export interface ServerInfo {
	hostname: string;
	version: string;
	testing: boolean;
}

export class AwClient {
	constructor(
		private readonly baseUrl: string,
		private readonly http: HttpFn,
	) {}

	private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<HttpResponse> {
		const url = `${this.baseUrl}/api/0/${path}`;
		let res: HttpResponse;
		try {
			res = await this.http({ url, method, body: body === undefined ? undefined : JSON.stringify(body) });
		} catch (e) {
			throw new AwError(`Cannot reach ActivityWatch at ${this.baseUrl}: ${e instanceof Error ? e.message : String(e)}`, null);
		}
		// 304 = bucket already exists, which is success for createBucket.
		if (res.status >= 400) throw new AwError(`${method} ${path} failed with HTTP ${res.status}: ${res.text.slice(0, 200)}`, res.status);
		return res;
	}

	async info(): Promise<ServerInfo> {
		const res = await this.call("GET", "info");
		let parsed: unknown;
		try {
			parsed = JSON.parse(res.text);
		} catch {
			throw new AwError(`Unexpected reply from ${this.baseUrl} (not ActivityWatch?)`, res.status);
		}
		const o = (parsed ?? {}) as Record<string, unknown>;
		if (typeof o.version !== "string") throw new AwError(`Unexpected reply from ${this.baseUrl} (not ActivityWatch?)`, res.status);
		return { hostname: String(o.hostname ?? ""), version: o.version, testing: o.testing === true };
	}

	async ensureBucket(id: string, type: string, client: string, hostname: string): Promise<void> {
		await this.call("POST", `buckets/${encodeURIComponent(id)}`, { client, type, hostname });
	}

	async heartbeat(bucketId: string, pulsetime: number, event: AwEvent): Promise<void> {
		await this.call("POST", `buckets/${encodeURIComponent(bucketId)}/heartbeat?pulsetime=${pulsetime}`, event);
	}

	async insert(bucketId: string, events: AwEvent[]): Promise<void> {
		await this.call("POST", `buckets/${encodeURIComponent(bucketId)}/events`, events);
	}
}
