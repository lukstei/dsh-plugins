import { defineConfig } from "tsdown";
import { defineClientBundleConfig } from "../../scripts/tsdown-client.ts";

export default defineConfig(
	defineClientBundleConfig({
		pluginId: "@lukstei/dsh-session-handoff",
		clientEntry: "src/client/index.ts",
		// the Host half stays source-run, so only the browser bundle is built
		serverEntry: false,
	}),
);
