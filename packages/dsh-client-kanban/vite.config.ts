import { fileURLToPath } from "node:url";

export default {
	resolve: {
		alias: {
			react: fileURLToPath(new URL("./node_modules/react", import.meta.url)),
			"react-dom": fileURLToPath(
				new URL("./node_modules/react-dom", import.meta.url),
			),
		},
		dedupe: ["react", "react-dom"],
	},
};
