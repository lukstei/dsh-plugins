import type { CommandRowProps } from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { WorkflowRun } from "../types.ts";
import type { WorkflowErrorChatData } from "./WorkflowErrorCard.tsx";
import type { WorkflowPrintChatData } from "./WorkflowPrintStep.tsx";
import type { WorkflowStepChatData } from "./WorkflowStepRow.tsx";

declare module "@deepseek-ai/dsh-client-ui-chat/client" {
	interface ChatNodeDataMap {
		"wf-state": WorkflowRun;
		"wf-step": WorkflowStepChatData;
		"wf-print": WorkflowPrintChatData;
		"wf-error": WorkflowErrorChatData;
		"wf-list": Pick<CommandRowProps["node"], "name" | "args" | "outcome">;
	}
}

export type { WorkflowCommandCardProps } from "./WorkflowCommandCard.tsx";
export type {
	WorkflowErrorCardProps,
	WorkflowErrorChatData,
} from "./WorkflowErrorCard.tsx";
export type { WorkflowMarkdownProps } from "./WorkflowMarkdown.tsx";
export type {
	WorkflowPrintChatData,
	WorkflowPrintStepProps,
} from "./WorkflowPrintStep.tsx";
export type { WorkflowResumeButtonProps } from "./WorkflowResumeButton.tsx";
export type {
	WorkflowStepChatData,
	WorkflowStepRowProps,
} from "./WorkflowStepRow.tsx";
