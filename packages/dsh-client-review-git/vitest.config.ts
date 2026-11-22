import { paneCss } from "@lukstei/util-review-ui/pane-css";
import { defineConfig } from "vitest/config";
import { definePackageTestConfig } from "../../vitest.base.ts";

export default defineConfig(
	definePackageTestConfig({
		plugins: [{ ...paneCss, enforce: "pre" }],
		test: {
			testTimeout: 15000,
			exclude: ["node_modules/**"],
		},
	}),
);
