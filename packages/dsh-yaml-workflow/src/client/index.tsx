/**
 * PURPOSE: Cordis client plugin entrypoint registering workflow slots and state sync.
 * ALLOWED: Slot injection, effect registration, client service binding.
 * FORBIDDEN: Inline execution loops, raw DOM queries.
 */

import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { ChatNodeViewProps } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { PropsRenderFactories } from "@deepseek-ai/dsh-client-ui-slots";
import { WORKFLOW_EVENT_NAME } from "../fold.ts";
import {
	WorkflowClientContext,
	type WorkflowClientContext as WorkflowClientContextType,
} from "./context.ts";
import { registerWorkflowChatNodes } from "./store.ts";
import { WorkflowCommandCard } from "./WorkflowCommandCard.tsx";
import { WorkflowErrorCard } from "./WorkflowErrorCard.tsx";
import { WorkflowMarkdownResult } from "./WorkflowMarkdownResult.tsx";
import { WorkflowPrintStep } from "./WorkflowPrintStep.tsx";
import {
	WorkflowResumeButton,
	type WorkflowResumeButtonProps,
} from "./WorkflowResumeButton.tsx";
import { WorkflowStepRow } from "./WorkflowStepRow.tsx";

export const inject = [
	"slots",
	"conversation",
	"uiConversation",
	"sessions",
] as const;

/**
 * Applies workflow runner client plugin to the Cordis client container.
 * CONTRACT:
 * - Input: Cordis ClientContext instance with injected slots, conversation, uiConversation, and sessions services.
 * - Output: void (registers slots and effects).
 */
export function apply(ctx: ClientContext): void {
	// Wire chat node definitions (wf/state, wf/step, and wf/print)
	ctx.effect(
		() => registerWorkflowChatNodes(ctx),
		"workflow-runner: chat-nodes",
	);

	// Register custom chat nodes
	ctx.effect(
		() =>
			ctx.slots.inject("conversation.chat.node", () => {
				const unregisterState = ctx.slots.register(
					{
						name: "conversation.chat.node",
						key: "wf-state",
					},
					WorkflowCommandCard,
				);
				const unregisterStep = ctx.slots.register(
					{
						name: "conversation.chat.node",
						key: "wf-step",
					},
					WorkflowStepRow,
				);
				const unregisterPrint = ctx.slots.register(
					{
						name: "conversation.chat.node",
						key: "wf-print",
					},
					WorkflowPrintStep,
				);
				const unregisterError = ctx.slots.register(
					{
						name: "conversation.chat.node",
						key: "wf-error",
					},
					WorkflowErrorCard,
				);
				const unregisterList = ctx.slots.register(
					{
						name: "conversation.chat.node",
						key: "wf-list",
					},
					(
						props: Pick<ChatNodeViewProps<"wf-list">, "node"> &
							PropsRenderFactories,
					) => (
						<WorkflowMarkdownResult
							node={props.node.data}
							renderFactorySlot={props.renderFactorySlot}
						/>
					),
				);
				return () => {
					unregisterState();
					unregisterStep();
					unregisterPrint();
					unregisterError();
					unregisterList();
				};
			}),
		"workflow-runner: chat.node",
	);

	// Suppress execution command cards and share Markdown output for informational commands.
	ctx.effect(
		() =>
			ctx.slots.inject("conversation.chat.commandview", () => {
				const unregisterWf = ctx.slots.register(
					{
						name: "conversation.chat.commandview",
						key: "wf",
					},
					() => null,
				);
				const unregisterResume = ctx.slots.register(
					{
						name: "conversation.chat.commandview",
						key: "wf-resume",
					},
					() => null,
				);
				const unregisterAbort = ctx.slots.register(
					{
						name: "conversation.chat.commandview",
						key: "wf-abort",
					},
					() => null,
				);
				const unregisterEvent = ctx.slots.register(
					{
						name: "conversation.chat.commandview",
						key: WORKFLOW_EVENT_NAME,
					},
					() => null,
				);
				const unregisterList = ctx.slots.register(
					{
						name: "conversation.chat.commandview",
						key: "wf-list",
					},
					() => null,
				);
				const unregisterValidate = ctx.slots.register(
					{
						name: "conversation.chat.commandview",
						key: "wf-validate",
					},
					WorkflowMarkdownResult,
				);
				return () => {
					unregisterWf();
					unregisterResume();
					unregisterAbort();
					unregisterEvent();
					unregisterList();
					unregisterValidate();
				};
			}),
		"workflow-runner: commandview-custom",
	);

	// Register composer resume button in trailing input toolbar
	ctx.effect(
		() =>
			ctx.slots.inject("conversation.input.right", () => {
				const unregisterResume = ctx.slots.register(
					{
						name: "conversation.input.right",
						id: "wf-resume",
						order: 50,
					},
					(props: WorkflowResumeButtonProps) => (
						<WorkflowClientContext.Provider
							value={ctx as unknown as WorkflowClientContextType}
						>
							<WorkflowResumeButton {...props} />
						</WorkflowClientContext.Provider>
					),
				);
				return () => {
					unregisterResume();
				};
			}),
		"workflow-runner: input.right",
	);
}
