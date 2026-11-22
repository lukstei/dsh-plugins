import assert from "node:assert/strict";
import type { SessionEventWindow } from "@deepseek-ai/dsh-api-session-controller/client";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import type { InputState } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { CommandId } from "@deepseek-ai/dsh-commands";
import { SessionSeq } from "@deepseek-ai/dsh-session";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import * as context from "./context.ts";
import * as store from "./store.ts";
import { WorkflowResumeButton } from "./WorkflowResumeButton.tsx";

vi.mock("./WorkflowStyles.tsx", () => ({ WorkflowStyles: () => null }));
afterEach(() => vi.restoreAllMocks());

test.each(["admitted", "rejected", "edited", "acknowledged"])(
	"Resume consumes only the admitted, unchanged draft: %s",
	async (scenario) => {
		const events = createSnapshotStore<SessionEventWindow>({
			entries: [],
			hasMore: false,
			revision: 0,
			change: { kind: "replace", entries: [] },
		});
		const pending = Promise.withResolvers<{
			ok: true;
			value: { matched: boolean };
		}>();
		const command = vi.fn(() => pending.promise);
		// smell: only the session binding is exercised by this interaction test.
		const ctx = {
			sessions: {
				binding: () => ({ session: { command }, eventSource: events }),
			},
		} as unknown as context.WorkflowClientContext;
		vi.spyOn(context, "useWorkflowClientContext").mockReturnValue(ctx);
		vi.spyOn(store, "useWorkflowState").mockReturnValue({
			workflow: {
				args: {},
				steps: [{ kind: "prompt", name: "Work", prompt: "work" }],
			},
			invocation: { runId: "resume", targetPath: "wf.yml", resolvedArgs: {} },
			state: { status: "paused", stepIndex: 0, pauseReason: "interrupted" },
		});
		let draft = "retry with tests";
		let revision = 0;
		const setDraft = vi.fn((text: string) => {
			draft = text;
			revision++;
		});
		const props = {
			sessionId: SessionId("resume-click"),
			useInput: <T>(selector: (state: InputState) => T) =>
				selector({
					draft,
					draftRev: revision,
					phase: "plain",
					attachmentIds: [],
					occurrences: [],
					queue: [],
				}),
			inputActions: {
				setDraft,
				captureInsertion: () => ({ start: 0, end: 0, draftRev: revision }),
				insertQuote: vi.fn(),
				insertText: vi.fn(),
				persistDraft: vi.fn(),
				addAttachments: vi.fn(),
				removeAttachment: vi.fn(),
				pruneAttachments: vi.fn(),
				submit: vi.fn(),
			},
		};
		const element = WorkflowResumeButton(props);
		assert(isValidElement<{ children: ReactNode }>(element));
		const toolbar = Children.toArray(element.props.children)[1];
		assert(isValidElement<{ children: ReactNode }>(toolbar));
		const button = Children.toArray(toolbar.props.children)[0];
		assert(isValidElement<{ onClick: () => Promise<void> }>(button));
		const click = button.props.onClick();
		expect(command).toHaveBeenCalledWith("/wf-resume retry with tests");
		expect(draft).toBe("retry with tests");
		if (scenario === "edited") {
			draft = "new instructions";
			revision++;
		}
		if (scenario === "admitted" || scenario === "edited") {
			events.set({
				entries: [],
				hasMore: false,
				revision: 1,
				change: {
					kind: "append",
					entries: [
						{
							type: "event",
							event: {
								type: "command/run",
								seq: SessionSeq(1),
								time: 0,
								data: {
									commandId: CommandId("resume-command"),
									name: "wf-resume",
									args: " retry with tests",
									source: { kind: "user" },
								},
							},
						},
					],
				},
			});
		}
		expect(draft).toBe(
			scenario === "admitted"
				? ""
				: scenario === "edited"
					? "new instructions"
					: "retry with tests",
		);
		if (scenario === "admitted") {
			draft = "typed while running";
			revision++;
		}
		vi.spyOn(console, "error").mockImplementation(() => {});
		pending.resolve({ ok: true, value: { matched: scenario !== "rejected" } });
		await click;
		expect(setDraft).toHaveBeenCalledTimes(
			scenario === "admitted" || scenario === "acknowledged" ? 1 : 0,
		);
		if (scenario === "acknowledged") expect(draft).toBe("");
		if (scenario === "admitted") expect(draft).toBe("typed while running");
	},
);
