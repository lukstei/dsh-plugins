import type { Plugin, ViteUserConfig } from "vitest/config";

export const dshJsxRuntimePlugin: Plugin = {
	name: "dsh-jsx-runtime",
	resolveId(id: string) {
		if (id === "react" || id === "react/jsx-dev-runtime") return id;
	},
};

export const baseTestConfig: ViteUserConfig = {
	test: {
		reporters: ["minimal"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/external/**",
			"**/config/**",
			"**/.agents/**",
		],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts", "src/**/*.tsx"],
			exclude: [
				"src/**/types.ts",
				"src/**/*.spec.ts",
				"src/**/*.spec.tsx",
				"src/**/*.test.ts",
			],
		},
	},
};

export function definePackageTestConfig(
	overrides: ViteUserConfig = {},
): ViteUserConfig {
	return {
		...baseTestConfig,
		...overrides,
		test: {
			...baseTestConfig.test,
			...overrides.test,
			coverage: {
				...baseTestConfig.test?.coverage,
				...overrides.test?.coverage,
			},
		},
		plugins: [
			...((baseTestConfig.plugins as unknown[]) ?? []),
			...((overrides.plugins as unknown[]) ?? []),
		] as Plugin[],
	};
}
