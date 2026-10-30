import { defineConfig } from "vitest/config";

// report.ts splits ranges by local calendar day; pin a zone with a DST change so tests are deterministic.
process.env.TZ = "America/New_York";

// Every test imports only from `src/core/*`, which has no `obsidian` import and
// no DOM dependency, so the whole suite runs fully headless with no stubbing.
export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		environment: "node",
	},
});
