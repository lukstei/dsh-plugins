import { paneCss } from "@lukstei/util-review-ui/pane-css";
import { defineConfig } from "vitest/config";
import { definePackageTestConfig } from "../../vitest.base.ts";

/**
 * Integration scope: the specs that spawn real `git` against temp repositories
 * (~1.1k process spawns, ~12.6 s). Excluded from the default run and from root
 * `verify`; run manually with `pnpm -C packages/dsh-client-review-git
 * test:integration`, or via the package-level `verify`, which includes both scopes.
 */
export default defineConfig(
	definePackageTestConfig({
		plugins: [{ ...paneCss, enforce: "pre" }],
		test: {
			testTimeout: 15000,
			include: ["src/integration/**/*.spec.ts"],
			exclude: [
				"**/node_modules/**",
				"**/dist/**",
				"**/external/**",
				"**/config/**",
				"**/.agents/**",
			],
		},
	}),
);
