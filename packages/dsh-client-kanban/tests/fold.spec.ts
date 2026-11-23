import assert from "node:assert/strict";
import type { SessionHeader, SessionId } from "@deepseek-ai/dsh-session/types";
import { describe, expect, it } from "vitest";
import {
	classifyKanbanSession,
	isSessionVisibleInKanban,
} from "../src/client/store.ts";
import {
	foldKanbanEvent,
	foldKanbanState,
	initialKanbanState,
	toKanbanRecord,
} from "../src/fold.ts";
import { type KanbanPayload, ONE_WEEK_MS } from "../src/types.ts";

function mockHeader(id: string, createdAt = 1000): SessionHeader {
	return {
		id: id as SessionId,
		createdAt,
		cwd: "/test",
	} as SessionHeader;
}

function kanbanCmd(payload: KanbanPayload) {
	return {
		type: "command/run",
		data: { name: "kanban", args: JSON.stringify(payload) },
	};
}

describe("Kanban Event Folding", () => {
	const header = mockHeader("s1", 1000);

	it("creates initial uninitialized state", () => {
		const state = initialKanbanState(header);
		expect(state).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 1000,
			initialized: false,
			deleted: false,
		});
		expect(toKanbanRecord(state)).toBeNull();
	});

	it("ignores unrelated events returning identical state reference", () => {
		const state = initialKanbanState(header);
		const nextState = foldKanbanEvent(state, {
			type: "other/event",
			data: { content: "hello" },
		});
		expect(nextState).toBe(state);
	});

	it("ignores command/run for non-kanban commands or invalid JSON", () => {
		const state = initialKanbanState(header);
		const otherCmd = foldKanbanEvent(state, {
			type: "command/run",
			data: { name: "help", args: "init" },
		});
		expect(otherCmd).toBe(state);

		const invalidJson = foldKanbanEvent(state, {
			type: "command/run",
			data: { name: "kanban", args: "not-json" },
		});
		expect(invalidJson).toBe(state);
	});

	it("folds empty kanban command to mark session initialized", () => {
		const state = initialKanbanState(header);
		const initialized = foldKanbanEvent(state, {
			type: "command/run",
			data: { name: "kanban", args: "" },
		});

		expect(initialized).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 1000,
			initialized: true,
			deleted: false,
		});
		expect(toKanbanRecord(initialized)).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 1000,
		});
	});

	it("folds whitespace and undefined args kanban command to mark session initialized", () => {
		const state = initialKanbanState(header);
		const whitespace = foldKanbanEvent(state, {
			type: "command/run",
			data: { name: "kanban", args: "   " },
		});
		expect(whitespace.initialized).toBe(true);

		const noArgs = foldKanbanEvent(state, {
			type: "command/run",
			data: { name: "kanban" },
		});
		expect(noArgs.initialized).toBe(true);
	});

	it("ignores empty kanban command if already initialized", () => {
		const state = initialKanbanState(header);
		const initialized = foldKanbanEvent(state, {
			type: "command/run",
			data: { name: "kanban", args: "" },
		});
		const second = foldKanbanEvent(initialized, {
			type: "command/run",
			data: { name: "kanban", args: "" },
		});
		expect(second).toBe(initialized);
	});

	it("ignores empty kanban command if deleted", () => {
		const state = initialKanbanState(header);
		const initialized = foldKanbanEvent(
			state,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const deleted = foldKanbanEvent(
			initialized,
			kanbanCmd({ action: "delete", deletedAt: 3000 }),
		);
		const next = foldKanbanEvent(deleted, {
			type: "command/run",
			data: { name: "kanban", args: "" },
		});
		expect(next).toBe(deleted);
	});

	it("folds kanban init to mark session initialized", () => {
		const state = initialKanbanState(header);
		const initialized = foldKanbanEvent(
			state,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);

		expect(initialized).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 2000,
			initialized: true,
			deleted: false,
		});

		expect(toKanbanRecord(initialized)).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 2000,
		});
	});

	it("folds kanban init with initial prompt", () => {
		const state = initialKanbanState(header);
		const initialized = foldKanbanEvent(
			state,
			kanbanCmd({
				action: "init",
				createdAt: 2000,
				prompt: "Write unit tests for authentication flow",
			}),
		);

		expect(initialized).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 2000,
			prompt: "Write unit tests for authentication flow",
			initialized: true,
			deleted: false,
		});

		expect(toKanbanRecord(initialized)).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 2000,
			prompt: "Write unit tests for authentication flow",
		});
	});

	it("ignores subsequent kanban init when already initialized", () => {
		const state = initialKanbanState(header);
		const first = foldKanbanEvent(
			state,
			kanbanCmd({ action: "init", createdAt: 2000, prompt: "First prompt" }),
		);
		const second = foldKanbanEvent(
			first,
			kanbanCmd({ action: "init", createdAt: 3000, prompt: "Ignored prompt" }),
		);

		expect(second).toBe(first);
		expect(second.createdAt).toBe(2000);
		expect(second.prompt).toBe("First prompt");
	});

	it("ignores kanban done when session is not initialized", () => {
		const state = initialKanbanState(header);
		const result = foldKanbanEvent(
			state,
			kanbanCmd({ action: "done", doneAt: 5000 }),
		);
		expect(result).toBe(state);
	});

	it("folds kanban done to record completion timestamp", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const done = foldKanbanEvent(
			active,
			kanbanCmd({ action: "done", doneAt: 5000 }),
		);

		expect(done).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 2000,
			doneAt: 5000,
			initialized: true,
			deleted: false,
		});

		expect(toKanbanRecord(done)).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 2000,
			doneAt: 5000,
		});
	});

	it("ignores subsequent kanban done when already done", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const done = foldKanbanEvent(
			active,
			kanbanCmd({ action: "done", doneAt: 5000 }),
		);
		const doneAgain = foldKanbanEvent(
			done,
			kanbanCmd({ action: "done", doneAt: 8000 }),
		);

		expect(doneAgain).toBe(done);
		expect(doneAgain.doneAt).toBe(5000);
	});

	it("folds kanban reopen to clear done status", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({
				action: "init",
				createdAt: 2000,
				prompt: "Follow-up task",
			}),
		);
		const done = foldKanbanEvent(
			active,
			kanbanCmd({ action: "done", doneAt: 5000 }),
		);
		const reopened = foldKanbanEvent(
			done,
			kanbanCmd({ action: "reopen", reopenedAt: 7000 }),
		);

		expect(reopened).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 2000,
			prompt: "Follow-up task",
			reviewAt: 7000,
			initialized: true,
			deleted: false,
		});
		expect(reopened.doneAt).toBeUndefined();
	});

	it("folds user/message to automatically reopen a done session", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const done = foldKanbanEvent(
			active,
			kanbanCmd({ action: "done", doneAt: 5000 }),
		);
		const followUp = foldKanbanEvent(done, {
			type: "user/message",
			data: {
				id: "m1",
				role: "user",
				source: { kind: "user" },
				content: [{ type: "text", text: "Can you fix one more thing?" }],
			},
		});

		expect(followUp.doneAt).toBeUndefined();
		expect(followUp.initialized).toBe(true);
	});

	it("ignores kanban reopen when session is not done", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const reopened = foldKanbanEvent(
			active,
			kanbanCmd({ action: "reopen", reopenedAt: 3000 }),
		);

		expect(reopened).toBe(active);
	});

	it("folds complete event sequences with foldKanbanState", () => {
		const events = [
			kanbanCmd({ action: "init", createdAt: 2000 }),
			kanbanCmd({ action: "done", doneAt: 5000 }),
			kanbanCmd({ action: "reopen", reopenedAt: 7000 }),
			kanbanCmd({ action: "done", doneAt: 9000 }),
		];

		const finalState = foldKanbanState(header, events);
		expect(finalState).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 2000,
			doneAt: 9000,
			initialized: true,
			deleted: false,
		});
	});

	it("folds kanban hold to record held timestamp", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const held = foldKanbanEvent(
			active,
			kanbanCmd({ action: "hold", heldAt: 6000 }),
		);

		expect(held).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 2000,
			heldAt: 6000,
			initialized: true,
			deleted: false,
		});
		expect(toKanbanRecord(held)).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 2000,
			heldAt: 6000,
		});
	});

	it.each([false, true])(
		"moves done to hold and preserves pin metadata (pinned: %s)",
		(pinned) => {
			const done = foldKanbanState(header, [
				kanbanCmd({
					action: "init",
					createdAt: 2000,
					prompt: "Follow-up task",
				}),
				kanbanCmd({ action: "done", doneAt: 5000 }),
				...(pinned ? [kanbanCmd({ action: "pin", pinnedAt: 5500 })] : []),
			]);
			const held = foldKanbanEvent(
				done,
				kanbanCmd({ action: "hold", heldAt: 6000 }),
			);
			const record = toKanbanRecord(held);
			assert.deepEqual(record, {
				links: [],
				sessionId: "s1",
				createdAt: 2000,
				prompt: "Follow-up task",
				heldAt: 6000,
				...(pinned ? { pinnedAt: 5500 } : {}),
			});
			assert.equal(done.doneAt, 5000);
			assert(record);
			assert.equal(
				classifyKanbanSession({ running: false, blank: false }, record),
				"todo",
			);
			assert.equal(
				isSessionVisibleInKanban(record, { blank: false }, 6000 + ONE_WEEK_MS),
				true,
			);
			assert.deepEqual(
				toKanbanRecord(
					foldKanbanEvent(held, kanbanCmd({ action: "done", doneAt: 7000 })),
				),
				{
					links: [],
					sessionId: "s1",
					createdAt: 2000,
					prompt: "Follow-up task",
					doneAt: 7000,
					...(pinned ? { pinnedAt: 5500 } : {}),
				},
			);
		},
	);

	it("ignores hold on uninitialized or deleted sessions", () => {
		const initial = initialKanbanState(header);
		const deleted = foldKanbanState(header, [
			kanbanCmd({ action: "init", createdAt: 2000 }),
			kanbanCmd({ action: "done", doneAt: 5000 }),
			kanbanCmd({ action: "delete", deletedAt: 6000 }),
		]);
		for (const state of [initial, deleted]) {
			assert.equal(
				foldKanbanEvent(state, kanbanCmd({ action: "hold", heldAt: 7000 })),
				state,
			);
		}
	});

	it("folds kanban unhold to clear held status", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const held = foldKanbanEvent(
			active,
			kanbanCmd({ action: "hold", heldAt: 6000 }),
		);
		const unheld = foldKanbanEvent(
			held,
			kanbanCmd({ action: "unhold", unheldAt: 7000 }),
		);

		expect(unheld.heldAt).toBeUndefined();
		expect(unheld.initialized).toBe(true);
	});

	it.each([false, true])(
		"replays every stopped-state move without losing metadata (blank: %s)",
		(blank) => {
			const events = [
				kanbanCmd({ action: "init", createdAt: 2000 }),
				kanbanCmd({
					action: "add-link",
					label: "Issue",
					url: "https://example.com/1",
					priority: 0,
				}),
				kanbanCmd({ action: "done", doneAt: 3000 }),
				kanbanCmd({ action: "pin", pinnedAt: 3500 }),
			];
			for (const [payload, lane] of [
				[{ action: "reopen", reopenedAt: 4000 }, "review"],
				[{ action: "hold", heldAt: 5000 }, "todo"],
				[{ action: "done", doneAt: 6000 }, "done"],
				[{ action: "hold", heldAt: 7000 }, "todo"],
				[{ action: "unhold", unheldAt: 8000 }, "review"],
				[{ action: "done", doneAt: 9000 }, "done"],
			] satisfies [KanbanPayload, string][]) {
				events.push(kanbanCmd(payload));
				const record = toKanbanRecord(foldKanbanState(header, events));
				assert(record);
				expect({
					lane: classifyKanbanSession({ running: false, blank }, record),
					visible: isSessionVisibleInKanban(record, { blank }, 9000),
					links: record.links,
					pinnedAt: record.pinnedAt,
					hasReviewPlacement: record.reviewAt !== undefined,
				}).toEqual({
					lane,
					visible: true,
					links: [
						{ label: "Issue", url: "https://example.com/1", priority: 0 },
					],
					pinnedAt: 3500,
					hasReviewPlacement: lane === "review",
				});
			}
		},
	);

	it("hides a subagent session that inherited its parent's kanban init", () => {
		const record = toKanbanRecord(
			foldKanbanState(header, [kanbanCmd({ action: "init", createdAt: 2000 })]),
		);
		assert(record);
		expect({
			subagent: isSessionVisibleInKanban(
				record,
				{ blank: false, origin: "subagent" },
				3000,
			),
			root: isSessionVisibleInKanban(record, { blank: false }, 3000),
		}).toEqual({ subagent: false, root: true });
	});

	it("moves an unheld blank draft to review and clears that placement on a user message", () => {
		const draft = foldKanbanState(header, [
			kanbanCmd({ action: "init", createdAt: 2000 }),
		]);
		const review = foldKanbanEvent(
			draft,
			kanbanCmd({ action: "unhold", unheldAt: 3000 }),
		);
		const record = toKanbanRecord(review);
		assert(record);
		expect({
			lane: classifyKanbanSession({ running: false, blank: true }, record),
			visible: isSessionVisibleInKanban(record, { blank: true }, 3000),
		}).toEqual({ lane: "review", visible: true });
		expect(
			foldKanbanEvent(review, kanbanCmd({ action: "unhold", unheldAt: 4000 })),
		).toBe(review);
		expect(foldKanbanEvent(review, { type: "user/message", data: {} })).toEqual(
			draft,
		);
	});

	it("ignores unhold on uninitialized, deleted, or completed sessions", () => {
		const initial = initialKanbanState(header);
		const done = foldKanbanState(header, [
			kanbanCmd({ action: "init", createdAt: 2000 }),
			kanbanCmd({ action: "done", doneAt: 3000 }),
		]);
		const deleted = foldKanbanEvent(
			done,
			kanbanCmd({ action: "delete", deletedAt: 4000 }),
		);
		for (const state of [initial, done, deleted]) {
			expect(
				foldKanbanEvent(state, kanbanCmd({ action: "unhold", unheldAt: 5000 })),
			).toBe(state);
		}
	});

	it("folds user/message to automatically unhold a held session", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const held = foldKanbanEvent(
			active,
			kanbanCmd({ action: "hold", heldAt: 6000 }),
		);
		const resumed = foldKanbanEvent(held, {
			type: "user/message",
			data: {
				id: "m1",
				role: "user",
				source: { kind: "user" },
				content: [{ type: "text", text: "Resuming this task" }],
			},
		});

		expect(resumed.heldAt).toBeUndefined();
		expect(resumed.initialized).toBe(true);
	});

	it("folds kanban delete and hides record from projection", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const deleted = foldKanbanEvent(
			active,
			kanbanCmd({ action: "delete", deletedAt: 3000 }),
		);

		expect(deleted).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 2000,
			initialized: true,
			deleted: true,
		});
		expect(toKanbanRecord(deleted)).toBeNull();
	});

	it("ignores kanban delete if uninitialized or already deleted", () => {
		const initial = initialKanbanState(header);
		const uninitDelete = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "delete", deletedAt: 2000 }),
		);
		expect(uninitDelete).toBe(initial);

		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const deleted = foldKanbanEvent(
			active,
			kanbanCmd({ action: "delete", deletedAt: 3000 }),
		);
		const deletedAgain = foldKanbanEvent(
			deleted,
			kanbanCmd({ action: "delete", deletedAt: 4000 }),
		);
		expect(deletedAgain).toBe(deleted);
	});

	it("prevents recovery after kanban delete", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const deleted = foldKanbanEvent(
			active,
			kanbanCmd({ action: "delete", deletedAt: 3000 }),
		);

		expect(
			foldKanbanEvent(deleted, kanbanCmd({ action: "init", createdAt: 4000 })),
		).toBe(deleted);
		expect(
			foldKanbanEvent(
				deleted,
				kanbanCmd({ action: "reopen", reopenedAt: 4000 }),
			),
		).toBe(deleted);
		expect(
			foldKanbanEvent(deleted, {
				type: "user/message",
				data: {
					id: "m1",
					role: "user",
					source: { kind: "user" },
					content: [{ type: "text", text: "hello" }],
				},
			}),
		).toBe(deleted);
		expect(
			foldKanbanEvent(deleted, kanbanCmd({ action: "done", doneAt: 4000 })),
		).toBe(deleted);
	});

	it("folds kanban pin on done session to record pinnedAt timestamp", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const done = foldKanbanEvent(
			active,
			kanbanCmd({ action: "done", doneAt: 5000 }),
		);
		const pinned = foldKanbanEvent(
			done,
			kanbanCmd({ action: "pin", pinnedAt: 6000 }),
		);

		expect(pinned).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 2000,
			doneAt: 5000,
			pinnedAt: 6000,
			initialized: true,
			deleted: false,
		});
		expect(toKanbanRecord(pinned)).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 2000,
			doneAt: 5000,
			pinnedAt: 6000,
		});
	});

	it("ignores kanban pin if session is not in done status", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const pinned = foldKanbanEvent(
			active,
			kanbanCmd({ action: "pin", pinnedAt: 3000 }),
		);
		expect(pinned).toBe(active);
		expect(pinned.pinnedAt).toBeUndefined();
	});

	it("ignores kanban pin if already pinned", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const done = foldKanbanEvent(
			active,
			kanbanCmd({ action: "done", doneAt: 5000 }),
		);
		const pinned = foldKanbanEvent(
			done,
			kanbanCmd({ action: "pin", pinnedAt: 6000 }),
		);
		const pinnedAgain = foldKanbanEvent(
			pinned,
			kanbanCmd({ action: "pin", pinnedAt: 8000 }),
		);
		expect(pinnedAgain).toBe(pinned);
		expect(pinnedAgain.pinnedAt).toBe(6000);
	});

	it("folds kanban unpin to clear pinned status", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const done = foldKanbanEvent(
			active,
			kanbanCmd({ action: "done", doneAt: 5000 }),
		);
		const pinned = foldKanbanEvent(
			done,
			kanbanCmd({ action: "pin", pinnedAt: 6000 }),
		);
		const unpinned = foldKanbanEvent(
			pinned,
			kanbanCmd({ action: "unpin", unpinnedAt: 7000 }),
		);

		expect(unpinned.pinnedAt).toBeUndefined();
		expect(unpinned.doneAt).toBe(5000);
		expect(unpinned.initialized).toBe(true);
	});

	it("ignores kanban unpin if not pinned", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const done = foldKanbanEvent(
			active,
			kanbanCmd({ action: "done", doneAt: 5000 }),
		);
		const unpinned = foldKanbanEvent(
			done,
			kanbanCmd({ action: "unpin", unpinnedAt: 7000 }),
		);
		expect(unpinned).toBe(done);
	});

	it("retains pinnedAt when session is reopened", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const done = foldKanbanEvent(
			active,
			kanbanCmd({ action: "done", doneAt: 5000 }),
		);
		const pinned = foldKanbanEvent(
			done,
			kanbanCmd({ action: "pin", pinnedAt: 6000 }),
		);
		const reopened = foldKanbanEvent(
			pinned,
			kanbanCmd({ action: "reopen", reopenedAt: 7000 }),
		);

		expect(reopened.doneAt).toBeUndefined();
		expect(reopened.pinnedAt).toBe(6000);
	});

	it("retains pinnedAt when user message reopens session", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const done = foldKanbanEvent(
			active,
			kanbanCmd({ action: "done", doneAt: 5000 }),
		);
		const pinned = foldKanbanEvent(
			done,
			kanbanCmd({ action: "pin", pinnedAt: 6000 }),
		);
		const resumed = foldKanbanEvent(pinned, {
			type: "user/message",
			data: {
				id: "m1",
				role: "user",
				source: { kind: "user" },
				content: [{ type: "text", text: "reopening" }],
			},
		});

		expect(resumed.doneAt).toBeUndefined();
		expect(resumed.pinnedAt).toBe(6000);
	});

	it("retains pinnedAt when a reopened session is completed again", () => {
		const initial = initialKanbanState(header);
		const active = foldKanbanEvent(
			initial,
			kanbanCmd({ action: "init", createdAt: 2000 }),
		);
		const done = foldKanbanEvent(
			active,
			kanbanCmd({ action: "done", doneAt: 5000 }),
		);
		const pinned = foldKanbanEvent(
			done,
			kanbanCmd({ action: "pin", pinnedAt: 6000 }),
		);
		const reopened = foldKanbanEvent(
			pinned,
			kanbanCmd({ action: "reopen", reopenedAt: 7000 }),
		);
		const redone = foldKanbanEvent(
			reopened,
			kanbanCmd({ action: "done", doneAt: 9000 }),
		);

		expect(redone.doneAt).toBe(9000);
		expect(redone.pinnedAt).toBe(6000);
		expect(toKanbanRecord(redone)).toEqual({
			links: [],
			sessionId: "s1",
			createdAt: 2000,
			doneAt: 9000,
			pinnedAt: 6000,
		});
	});

	it("updates lastActivityAt on assistant/message and user/message events", () => {
		const state = initialKanbanState(header);
		const afterPrompt = foldKanbanEvent(state, {
			type: "user/message",
			time: 1500,
			data: {},
		});
		expect(afterPrompt.lastActivityAt).toBe(1500);

		const afterAssistant = foldKanbanEvent(afterPrompt, {
			type: "assistant/message",
			time: 2500,
			data: {},
		});
		expect(afterAssistant.lastActivityAt).toBe(2500);

		// Ignores older events
		const olderEvent = foldKanbanEvent(afterAssistant, {
			type: "assistant/message",
			time: 2000,
			data: {},
		});
		expect(olderEvent).toBe(afterAssistant);

		// Ignores events if session is deleted
		const deletedState = { ...afterAssistant, deleted: true };
		const afterDeleted = foldKanbanEvent(deletedState, {
			type: "assistant/message",
			time: 3000,
			data: {},
		});
		expect(afterDeleted).toBe(deletedState);
	});
});
