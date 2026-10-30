import { defineConfig } from "vitest/config";

// Every test imports only from `src/core/*`, which has no `obsidian` import and
// no DOM dependency, so the whole suite runs fully headless with no stubbing.
export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		environment: "node",
	},
});
