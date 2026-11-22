import type React from "react";
import { WORKFLOW_CARD_CSS } from "./styles.ts";

export function WorkflowStyles(): React.JSX.Element {
	return (
		<style href="dsh-workflow-runner" precedence="default">
			{WORKFLOW_CARD_CSS}
		</style>
	);
}
