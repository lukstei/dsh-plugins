import type { SessionHeader, SessionId } from "@deepseek-ai/dsh-session/types";
import { expect, test } from "vitest";
import {
	foldKanbanEvent,
	foldKanbanState,
	initialKanbanState,
	toKanbanRecord,
} from "../src/fold.ts";

const header: SessionHeader = {
	// edge case: fixture IDs use DSH's branded session identity
	id: "links-session" as SessionId,
	version: 4,
	isSeeded: false,
	createdAt: 1000,
};
const issue = {
	label: "Issue",
	url: "https://jira.example/browse/ABC-1",
	priority: 0,
};
const review = {
	label: "Review",
	url: "https://github.example/pull/42",
	priority: 0,
};
function command(payload: unknown) {
	return {
		type: "command/run",
		data: { name: "kanban", args: JSON.stringify(payload) },
	};
}

test("projects lower priorities first with stable ties and immutable collection order", () => {
	const entries = [
		{ ...issue, priority: 5 },
		{ ...review, priority: -2 },
		{ label: "Context", url: "https://example.com/context" },
		{ label: "Task ticket", url: "https://example.com/task", priority: -2 },
	];
	const state = foldKanbanState(header, [
		command({ action: "init", createdAt: 1000 }),
		...entries.map((entry) => command({ action: "add-link", ...entry })),
	]);
	expect(toKanbanRecord(state)).toEqual({
		sessionId: header.id,
		createdAt: 1000,
		links: [entries[1], entries[3], { ...entries[2], priority: 0 }, entries[0]],
	});
	expect(state.links).toEqual(
		entries.map((entry) => ({ priority: 0, ...entry })),
	);
	const updated = foldKanbanEvent(
		state,
		command({ action: "add-link", ...issue, priority: -10 }),
	);
	const record = toKanbanRecord(updated);
	expect(record).not.toBeNull();
	if (record === null) throw new Error("Expected initialized Kanban record");
	expect(record.links.map((entry) => entry.url)).toEqual([
		issue.url,
		review.url,
		entries[3].url,
		entries[2].url,
	]);
	expect(updated.links[0]).toEqual({ ...issue, priority: -10 });
	expect(
		foldKanbanEvent(
			updated,
			command({ action: "add-link", ...issue, priority: -10 }),
		),
	).toBe(updated);
});

test("replays previously recorded links with omitted priority as zero", () => {
	const state = foldKanbanState(header, [
		command({ action: "add-link", label: issue.label, url: issue.url }),
	]);
	expect(state.links).toEqual([issue]);
});

test("collects links before initialization without enrolling the session", () => {
	const initial = initialKanbanState(header);
	const collected = foldKanbanEvent(
		initial,
		command({ action: "add-link", ...issue }),
	);
	expect(collected).toEqual({ ...initial, links: [issue] });
	expect(toKanbanRecord(collected)).toBeNull();
	expect(
		toKanbanRecord(
			foldKanbanEvent(collected, command({ action: "init", createdAt: 1000 })),
		),
	).toEqual({
		sessionId: header.id,
		createdAt: 1000,
		links: [issue],
	});
	expect(initial).toEqual({
		sessionId: header.id,
		createdAt: 1000,
		initialized: false,
		deleted: false,
		links: [],
	});
});

test("appends URLs, updates labels in place, and preserves idempotent state", () => {
	const initial = foldKanbanState(header, [
		command({ action: "init", createdAt: 1000 }),
	]);
	const first = foldKanbanEvent(
		initial,
		command({ action: "add-link", ...issue }),
	);
	const second = foldKanbanEvent(
		first,
		command({ action: "add-link", ...review }),
	);
	const updated = foldKanbanEvent(
		second,
		command({ action: "add-link", ...issue, label: "  Fixed issue  " }),
	);
	expect(updated.links).toEqual([{ ...issue, label: "Fixed issue" }, review]);
	expect(second.links).toEqual([issue, review]);
	expect(
		foldKanbanEvent(
			updated,
			command({ action: "add-link", ...issue, label: "Fixed issue" }),
		),
	).toBe(updated);
});

test.each([
	{ label: "", url: issue.url },
	{ label: "  ", url: issue.url },
	{ label: "Bad", url: "javascript:alert(1)" },
	{ label: "Bad", url: "data:text/html,hi" },
	{ label: "Bad", url: "/relative" },
	{ label: "Bad", url: "not a URL" },
	{ label: 42, url: issue.url },
	{ label: "Missing URL" },
])("rejects malformed persisted link payloads: %j", (link) => {
	const initial = initialKanbanState(header);
	expect(
		foldKanbanEvent(initial, command({ action: "add-link", ...link })),
	).toBe(initial);
});

test("link writes preserve lifecycle metadata and deleted sessions reject them", () => {
	const state = foldKanbanState(header, [
		command({ action: "init", createdAt: 1000 }),
		command({ action: "done", doneAt: 2000 }),
		command({ action: "pin", pinnedAt: 2500 }),
	]);
	const next = foldKanbanEvent(
		state,
		command({ action: "add-link", ...issue }),
	);
	expect(next).toEqual({ ...state, links: [issue] });
	const held = foldKanbanEvent(next, command({ action: "hold", heldAt: 3000 }));
	expect(held.links).toEqual([issue]);
	const reopened = foldKanbanEvent(held, { type: "user/message" });
	expect(reopened).toEqual({ ...state, doneAt: undefined, links: [issue] });
	const deleted = foldKanbanEvent(
		next,
		command({ action: "delete", deletedAt: 3000 }),
	);
	expect(
		foldKanbanEvent(deleted, command({ action: "add-link", ...review })),
	).toBe(deleted);
});
