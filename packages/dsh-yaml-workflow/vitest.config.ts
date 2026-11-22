import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import { definePackageTestConfig } from "../../vitest.base.ts";

const require = createRequire(import.meta.url);

export default defineConfig(
	definePackageTestConfig({
		resolve: {
			alias: {
				"@deepseek-ai/cordis": require.resolve("@deepseek-ai/cordis"),
				"@deepseek-ai/dsh-client-store": require.resolve(
					"@deepseek-ai/dsh-client-store",
				),
				"zustand/vanilla": require.resolve("zustand/vanilla"),
				immer: require.resolve("immer"),
			},
		},
		test: {
			exclude: ["src/e2e/**", "node_modules/**"],
		},
	}),
);
