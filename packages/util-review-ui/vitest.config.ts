import { defineConfig } from "vitest/config";
import { definePackageTestConfig } from "../../vitest.base.ts";
import { paneCss } from "./scripts/pane-css.ts";

export default defineConfig(
	definePackageTestConfig({
		plugins: [{ ...paneCss, enforce: "pre" }],
		test: {
			testTimeout: 15000,
			exclude: ["node_modules/**"],
		},
	}),
);
