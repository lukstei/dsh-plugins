import { paneCss } from "@lukstei/util-review-ui/pane-css";

export default {
	plugins: [{ ...paneCss, enforce: "pre" as const }],
};
