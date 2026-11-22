import { defineConfig } from "vitest/config";
import {
	definePackageTestConfig,
	dshJsxRuntimePlugin,
} from "../../vitest.base.ts";

export default defineConfig(
	definePackageTestConfig({
		plugins: [dshJsxRuntimePlugin],
	}),
);
