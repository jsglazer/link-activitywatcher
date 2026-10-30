import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
		...builtinModules.map((m) => `node:${m}`),
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
});

// The ActivityWatch custom visualization: a standalone browser bundle served by aw-server.
const visContext = await esbuild.context({
	entryPoints: ["src/vis/main.ts"],
	bundle: true,
	format: "iife",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	outfile: "aw-visualization/vis.js",
});

if (prod) {
	await context.rebuild();
	await visContext.rebuild();
	process.exit(0);
} else {
	await Promise.all([context.watch(), visContext.watch()]);
}
