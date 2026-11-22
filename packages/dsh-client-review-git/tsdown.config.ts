import { fileURLToPath } from "node:url";
import { paneCss } from "@lukstei/util-review-ui/pane-css";
import { defineConfig } from "tsdown";
import ts from "typescript-transpile";
import { defineClientBundleConfig } from "../../scripts/tsdown-client.ts";

const pluginId = "@lukstei/dsh-client-review-git";

export default defineConfig(
	defineClientBundleConfig({
		pluginId,
		clientEntry: "src/client/index.tsx",
		codeSplitting: false,
		clientPlugins: [paneCss],
		serverEntry: {
			entry: { host: "src/index.ts" },
			outDir: "dist",
			format: "esm",
			platform: "node",
			target: "es2022",
			dts: false,
			clean: false,
			deps: { neverBundle: true },
			outputOptions: { entryFileNames: "host.js" },
			plugins: [
				{
					name: "git-diff-host-decorators",
					transform: {
						order: "pre",
						handler(code, id) {
							if (
								id !==
								fileURLToPath(
									new URL("./src/workspace-review-service.ts", import.meta.url),
								)
							)
								return;
							return ts.transpileModule(code, {
								fileName: id,
								compilerOptions: {
									target: ts.ScriptTarget.ES2022,
									module: ts.ModuleKind.ESNext,
								},
							}).outputText;
						},
					},
				},
			],
		},
	}),
);
