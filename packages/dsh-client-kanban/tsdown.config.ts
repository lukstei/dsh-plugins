import { defineConfig } from "tsdown";
import { defineClientBundleConfig } from "../../scripts/tsdown-client.ts";

export default defineConfig(
	defineClientBundleConfig({
		pluginId: "@lukstei/dsh-client-kanban",
		clientEntry: "src/client/index.tsx",
	}),
);
