import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { definePackageTestConfig } from "../../vitest.base.ts";

const mockPrimitivesPath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"test/mocks/primitives.ts",
);

export default defineConfig(
	definePackageTestConfig({
		resolve: {
			alias: {
				"@deepseek-ai/dsh-client-ui-primitives": mockPrimitivesPath,
			},
		},
	}),
);
