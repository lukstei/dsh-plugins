export const DSH_PLATFORM_EXTERNALS = [
	"react",
	"react/jsx-runtime",
	"react-dom",
	"react-dom/client",
	"@deepseek-ai/cordis",
	"zod",
	"@tanstack/react-virtual",
	"@deepseek-ai/dsh-client-store",
	"@deepseek-ai/dsh-client-ui-slots",
	"@deepseek-ai/dsh-client-ui-primitives",
	"@deepseek-ai/dsh-client-ui-dockkit",
];

export const DSH_ALLOWED_EXTERNALS_SET = new Set(DSH_PLATFORM_EXTERNALS);

export function verifyClientBundlePlugin(id: string) {
	return {
		name: "dsh-verify-client-bundle",
		writeBundle(
			_options: unknown,
			bundle: Record<string, { type: string; code?: string; fileName: string }>,
		) {
			for (const file of Object.values(bundle)) {
				if (file.type === "chunk" && typeof file.code === "string") {
					for (const match of file.code.matchAll(
						/(?<![\w$])require\(\s*(['"])((?:(?!\1).)*)\1\s*\)/g,
					)) {
						const specifier = match[2];
						if (!DSH_ALLOWED_EXTERNALS_SET.has(specifier)) {
							throw new Error(
								`[${id}] Build failed: disallowed external require("${specifier}") in ${file.fileName}. Only DSH platform modules may be required in client bundles.`,
							);
						}
					}
				}
			}
		},
	};
}

export interface ClientBundleOptions {
	pluginId: string;
	clientEntry?: string | false;
	serverEntry?: Record<string, unknown> | false;
	clientPlugins?: unknown[];
	codeSplitting?: boolean;
}

export function defineClientBundleConfig(
	options: ClientBundleOptions,
): Record<string, unknown>[] {
	const {
		pluginId,
		clientEntry = "src/client/index.tsx",
		serverEntry,
		clientPlugins = [],
		codeSplitting,
	} = options;

	const configs: Record<string, unknown>[] = [];

	if (serverEntry !== false) {
		const defaultServerEntry = {
			entry: { index: "src/index.ts" },
			outDir: "dist",
			format: "esm",
			platform: "node",
			target: "es2024",
			dts: false,
			clean: false,
			logLevel: "error",
			tsconfig: "tsconfig.json",
			deps: {
				neverBundle: true,
			},
			outputOptions: { entryFileNames: "index.js" },
		};
		configs.push(
			serverEntry ? { logLevel: "error", ...serverEntry } : defaultServerEntry,
		);
	}

	if (clientEntry === false) return configs;

	configs.push({
		entry: { client: clientEntry },
		outDir: "dist",
		format: "cjs",
		platform: "browser",
		target: "es2024",
		dts: false,
		clean: false,
		logLevel: "error",
		tsconfig: "tsconfig.json",
		outputOptions: {
			...(codeSplitting !== undefined ? { codeSplitting } : {}),
			entryFileNames: "client.js",
			banner: () =>
				`window.__ModuleLoader__.load({ id: ${JSON.stringify(pluginId)}, factory: (require) => {`,
			footer: "return module.exports; } });",
			intro: "var module = { exports: {} }; var exports = module.exports;",
		},
		deps: {
			neverBundle: DSH_PLATFORM_EXTERNALS,
			alwaysBundle: (specifier: string) =>
				!DSH_ALLOWED_EXTERNALS_SET.has(specifier),
		},
		plugins: [...clientPlugins, verifyClientBundlePlugin(pluginId)],
	});

	return configs;
}
