import { describe, expect, it } from "vitest";
import { AwClient, type HttpFn } from "../src/core/aw-client";
import { activityEvent, pulsetimeFor } from "../src/core/events";

// Runs only when AW_LIVE_URL is set, e.g. AW_LIVE_URL=http://127.0.0.1:5600 npm test.
// Uses a throwaway bucket and deletes it afterwards.
const url = process.env.AW_LIVE_URL;

const http: HttpFn = async (req) => {
	const res = await fetch(req.url, { method: req.method, body: req.body, headers: { "Content-Type": "application/json" } });
	return { status: res.status, text: await res.text() };
};

describe.skipIf(!url)("live aw-server", () => {
	it("creates a bucket and merges consecutive heartbeats into one event", async () => {
		const base = url ?? "";
		const client = new AwClient(base, http);
		const bucket = `aw-watcher-obsidian-test_${Date.now()}`;
		await client.info();
		await client.ensureBucket(bucket, "app.editor.activity", "aw-watcher-obsidian", "test");
		await client.ensureBucket(bucket, "app.editor.activity", "aw-watcher-obsidian", "test"); // 304 path
		try {
			const env = { vault: "V", vaultPath: null, editorVersion: "1", projectRules: [] };
			const t0 = Date.now() - 30_000;
			for (const dt of [0, 10_000, 20_000]) {
				await client.heartbeat(bucket, pulsetimeFor(10), activityEvent({ path: "A.md", extension: "md" }, env, new Date(t0 + dt)));
			}
			await client.heartbeat(bucket, pulsetimeFor(10), activityEvent({ path: "B.md", extension: "md" }, env, new Date(t0 + 25_000)));
			const events = (await (await fetch(`${base}/api/0/buckets/${bucket}/events`)).json()) as { duration: number; data: { file: string } }[];
			expect(events.map((e) => e.data.file).sort()).toEqual(["/A.md", "/B.md"]);
			expect(events.find((e) => e.data.file === "/A.md")?.duration).toBeCloseTo(20, 0);
		} finally {
			await fetch(`${base}/api/0/buckets/${bucket}?force=1`, { method: "DELETE" });
		}
	});
});
