import { describe, expect, it } from "vitest";
import { AwClient, AwError, type HttpFn, type HttpRequest } from "../src/core/aw-client";
import { activityEvent } from "../src/core/events";

function fake(status: number, text = "{}") {
	const calls: HttpRequest[] = [];
	const http: HttpFn = async (req) => {
		calls.push(req);
		return { status, text };
	};
	return { calls, client: new AwClient("http://h:5600", http) };
}

const event = activityEvent({ path: "A.md", extension: "md" }, { vault: "V", vaultPath: null, editorVersion: "1" }, new Date(0));

describe("AwClient", () => {
	it("creates buckets with client/type/hostname and treats 304 as success", async () => {
		const { calls, client } = fake(304, "");
		await client.ensureBucket("aw-watcher-obsidian_h", "app.editor.activity", "aw-watcher-obsidian", "h");
		expect(calls[0].url).toBe("http://h:5600/api/0/buckets/aw-watcher-obsidian_h");
		expect(calls[0].method).toBe("POST");
		expect(JSON.parse(calls[0].body ?? "")).toEqual({ client: "aw-watcher-obsidian", type: "app.editor.activity", hostname: "h" });
	});

	it("posts heartbeats with pulsetime and events as an array", async () => {
		const { calls, client } = fake(200);
		await client.heartbeat("b", 15, event);
		await client.insert("b", [event]);
		expect(calls[0].url).toBe("http://h:5600/api/0/buckets/b/heartbeat?pulsetime=15");
		expect(JSON.parse(calls[0].body ?? "")).toEqual(event);
		expect(calls[1].url).toBe("http://h:5600/api/0/buckets/b/events");
		expect(JSON.parse(calls[1].body ?? "")).toEqual([event]);
	});

	it("throws AwError with the HTTP status on 4xx/5xx", async () => {
		const { client } = fake(404, "no bucket");
		await expect(client.heartbeat("b", 15, event)).rejects.toMatchObject({ name: "AwError", status: 404 });
	});

	it("throws AwError with null status when unreachable", async () => {
		const client = new AwClient("http://h:1", async () => {
			throw new Error("ECONNREFUSED");
		});
		const err = await client.info().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(AwError);
		expect((err as AwError).status).toBeNull();
	});

	it("rejects non-ActivityWatch replies from info()", async () => {
		await expect(fake(200, "<html>").client.info()).rejects.toThrow(/not ActivityWatch/);
		await expect(fake(200, '{"version":"v0.14.1","hostname":"h"}').client.info()).resolves.toEqual({ version: "v0.14.1", hostname: "h", testing: false });
	});
});
