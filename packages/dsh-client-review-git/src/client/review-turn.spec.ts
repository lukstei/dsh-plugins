import assert from "node:assert/strict";
import { MessageId, ToolCallId } from "@deepseek-ai/dsh-llm/brand";
import { GIT_REVIEW_TOOL } from "@lukstei/util-review-ui/review";
import type { BranchReviewScope } from "@lukstei/util-review-ui/types";
import { test } from "vitest";
import { gitReviewDefinition } from "./review-turn.ts";

type TestEvent = Parameters<typeof gitReviewDefinition.match>[0];

const scope: BranchReviewScope = {
	kind: "branch",
	repository: "/repo",
	ref: "refs/heads/feature/auth",
	base: { kind: "manual", ref: "refs/remotes/origin/main" },
	revision: { kind: "all-commits" },
};

function event(value: { type: string; data: unknown }): TestEvent {
	return { seq: 1, time: 0, ...value } as never;
}

function turnStart(turn: number): TestEvent {
	return event({ type: "turn/start", data: { turn } });
}

function presented(turn: number, callId: string, target: unknown): TestEvent {
	return event({
		type: "git-review/presented",
		data: { turn, callId, target },
	});
}

function commandPresented(
	turn: number,
	callId: string,
	target: unknown,
): TestEvent {
	return event({
		type: "command/run",
		data: {
			commandId: `git-review-${callId}`,
			name: "git-review",
			args: JSON.stringify({ turn, callId, target }),
			source: { kind: "user" },
		},
	});
}

function call(callId: string, name: string, args = "{}"): TestEvent {
	return event({
		type: "tool/call",
		data: {
			turn: 1,
			step: 1,
			callId: ToolCallId(callId),
			name,
			arguments: args,
		},
	});
}

function result(callId: string, isError: boolean, meta?: unknown): TestEvent {
	return event({
		type: "tool/result",
		data: {
			turn: 1,
			step: 1,
			message: {
				role: "tool",
				id: MessageId(`m-${callId}`),
				toolCallId: ToolCallId(callId),
				isError,
				source: { kind: "tool", callId: ToolCallId(callId) },
				content: [],
			},
			meta,
		},
	});
}

function start(turn: number) {
	return gitReviewDefinition.start(
		{} as never,
		{ event: turnStart(turn), role: "start", id: String(turn) } as never,
		{} as never,
	);
}

function update(state: ReturnType<typeof start>, ev: TestEvent) {
	const match = gitReviewDefinition.match(ev);
	if (match === null) return state;
	return gitReviewDefinition.update(
		{ state } as never,
		{
			event: ev,
			...match,
		} as never,
	);
}

function location(state: ReturnType<typeof start>) {
	return gitReviewDefinition.buildLocationData?.(
		{ state } as never,
		"turn",
		null,
	);
}

test("starts tracking on turn/start", () => {
	const state = start(3);
	assert.deepEqual(location(state), {
		kind: "turn",
		turn: 3,
		key: "git-review",
		value: { reviews: [] },
	});
});

test("collects a review card from a successful git_review_present result", () => {
	const state = update(
		update(start(1), call("c1", GIT_REVIEW_TOOL)),
		result("c1", false, scope),
	);
	assert.deepEqual(location(state), {
		kind: "turn",
		turn: 1,
		key: "git-review",
		value: { reviews: [{ id: "c1", scope }] },
	});
});

test("publishes review from command/run git-review event", () => {
	const target = { repository: "/repo", branch: "feature/presented" };
	const state = update(start(1), commandPresented(1, "c-cmd", target));
	assert.deepEqual(location(state), {
		kind: "turn",
		turn: 1,
		key: "git-review",
		value: { reviews: [{ id: "c-cmd", scope: target }] },
	});
});

test("publishes review from git-review/presented event", () => {
	const target = { repository: "/repo", branch: "feature/presented" };
	const state = update(start(1), presented(1, "c-pres", target));
	assert.deepEqual(location(state), {
		kind: "turn",
		turn: 1,
		key: "git-review",
		value: { reviews: [{ id: "c-pres", scope: target }] },
	});
});

test("deduplicates review if both git-review/presented and tool/result occur", () => {
	const target = { repository: "/repo", branch: "feature/auth" };
	const state1 = update(start(1), presented(1, "c1", target));
	const state2 = update(
		update(state1, call("c1", GIT_REVIEW_TOOL, JSON.stringify(target))),
		result("c1", false, target),
	);
	assert.deepEqual(location(state2), {
		kind: "turn",
		turn: 1,
		key: "git-review",
		value: { reviews: [{ id: "c1", scope: target }] },
	});
});

test("preserves multiple presentations in call order", () => {
	const secondScope: BranchReviewScope = {
		...scope,
		ref: "refs/heads/feature/review",
	};
	const state = update(
		update(
			update(
				update(start(1), call("c1", GIT_REVIEW_TOOL)),
				result("c1", false, scope),
			),
			call("c2", GIT_REVIEW_TOOL),
		),
		result("c2", false, secondScope),
	);
	assert.deepEqual(location(state), {
		kind: "turn",
		turn: 1,
		key: "git-review",
		value: {
			reviews: [
				{ id: "c1", scope },
				{ id: "c2", scope: secondScope },
			],
		},
	});
});

test("ignores calls to other tools", () => {
	const target = { repository: "/repo", branch: "feature/auth" };
	const state = update(
		update(
			update(start(1), call("c1", GIT_REVIEW_TOOL, JSON.stringify(target))),
			result("c1", false),
		),
		call("c2", "write"),
	);
	assert.deepEqual(location(state), {
		kind: "turn",
		turn: 1,
		key: "git-review",
		value: { reviews: [{ id: "c1", scope: target }] },
	});
});

test("keeps a failed call out of the cards", () => {
	const state = update(
		update(start(1), call("c1", GIT_REVIEW_TOOL)),
		result("c1", true, scope),
	);
	assert.deepEqual(location(state), {
		kind: "turn",
		turn: 1,
		key: "git-review",
		value: { reviews: [] },
	});
});

test("ignores a result without a valid scope", () => {
	const state = update(
		update(start(1), call("c1", GIT_REVIEW_TOOL)),
		result("c1", false, { kind: "branch" }),
	);
	assert.deepEqual(location(state), {
		kind: "turn",
		turn: 1,
		key: "git-review",
		value: { reviews: [] },
	});
});

test("publishes target from call arguments when result meta is omitted", () => {
	const target = { repository: "/repo", branch: "feature/auth" };
	const state = update(
		update(start(1), call("c1", GIT_REVIEW_TOOL, JSON.stringify(target))),
		result("c1", false),
	);
	assert.deepEqual(location(state), {
		kind: "turn",
		turn: 1,
		key: "git-review",
		value: { reviews: [{ id: "c1", scope: target }] },
	});
});

test("ignores results for calls it did not track", () => {
	const state = update(start(1), result("other", false, scope));
	assert.deepEqual(location(state), {
		kind: "turn",
		turn: 1,
		key: "git-review",
		value: { reviews: [] },
	});
});
