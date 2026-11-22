import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/e2e/**/*.spec.ts"],
		coverage: {
			provider: "v8",
			include: ["src/runner.ts", "src/fold.ts", "src/requests.ts"],
			thresholds: {
				lines: 90,
				functions: 85,
				branches: 85,
				statements: 90,
			},
		},
	},
});
