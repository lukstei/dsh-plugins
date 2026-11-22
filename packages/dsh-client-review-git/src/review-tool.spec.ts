import assert from "node:assert/strict";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { reviewTargetSchema } from "@lukstei/util-review-ui/review";
import { test, vi } from "vitest";
import { createGitReviewTool } from "./review-tool.ts";

function agentFixture() {
	return { session: { id: "session-1" } };
}

// smell: the tool reads only `agent` and `signal`; the rest of the execution identity is irrelevant here.
function execution(agent: unknown | undefined): ToolRunContext {
	return { agent, signal: new AbortController().signal } as never;
}

test("publishes a branch review and projects its target", async () => {
	const tool = createGitReviewTool();
	assert.equal(tool.name, "git_review_present");
	const value = await tool.execute(
		{ repository: "", branch: "feature" },
		execution(agentFixture()),
	);
	assert.deepEqual(value, {
		repository: "",
		branch: "feature",
	});
	const project = tool.output.presentationMeta;
	assert(project, "the tool must project its presentation meta");
	assert.deepEqual(project({ repository: "", branch: "feature" }, value), {
		repository: "",
		branch: "feature",
	});
});

test("notifies onPresented callback with execution and target", async () => {
	const onPresented = vi.fn();
	const tool = createGitReviewTool({ onPresented });
	const exec = execution(agentFixture());
	await tool.execute({ repository: "/repo", branch: "feature/notified" }, exec);
	assert.equal(onPresented.mock.calls.length, 1);
	assert.equal(onPresented.mock.calls[0][0], exec);
	assert.deepEqual(onPresented.mock.calls[0][1], {
		repository: "/repo",
		branch: "feature/notified",
	});
});

test("publishes a commit review", async () => {
	const tool = createGitReviewTool();
	const value = await tool.execute(
		{ repository: "/repo", branch: "feature", commit: "a".repeat(40) },
		execution(agentFixture()),
	);
	assert.deepEqual(value, {
		repository: "/repo",
		branch: "feature",
		commit: "a".repeat(40),
	});
	const project = tool.output.presentationMeta;
	assert(project, "the tool must project its presentation meta");
	assert.deepEqual(project({}, value), {
		repository: "/repo",
		branch: "feature",
		commit: "a".repeat(40),
	});
	assert(reviewTargetSchema.safeParse(project({}, value)).success);
});

test("refuses a call without an agent session", async () => {
	const tool = createGitReviewTool();
	await assert.rejects(
		tool.execute({ repository: "", branch: "feature" }, execution(undefined)),
		/requires an agent Session/,
	);
});

test("rejects a missing branch argument", async () => {
	const tool = createGitReviewTool();
	await assert.rejects(
		tool.execute({ repository: "" }, execution(agentFixture())),
		/branch/,
	);
});
