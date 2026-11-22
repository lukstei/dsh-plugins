import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transform } from "lightningcss";

const file = fileURLToPath(
	new URL("../src/client/GitDiffPane.module.css", import.meta.url),
);
const moduleId = "\0git-diff-pane-css";

// edge case: DSH loads one plugin script, so scoped CSS must travel inside that script.
export const paneCss = {
	name: "git-diff-pane-css",
	resolveId(source: string) {
		if (source.endsWith("/GitDiffPane.module.css")) return moduleId;
	},
	load(this: { addWatchFile(path: string): void }, id: string) {
		if (id !== moduleId) return;
		this.addWatchFile(file);
		const result = transform({
			filename: "GitDiffPane.module.css",
			code: readFileSync(file),
			cssModules: true,
		});
		assert(result.exports, "CSS Modules must export scoped class names");
		const classes = Object.fromEntries(
			Object.entries(result.exports).map(([key, value]) => [key, value.name]),
		);
		return `export const cssText = ${JSON.stringify(result.code.toString())}; export default ${JSON.stringify(classes)};`;
	},
};
