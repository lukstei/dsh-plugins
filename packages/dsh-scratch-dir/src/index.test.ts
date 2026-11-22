import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createScope } from "@deepseek-ai/dsh-scope";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import { renderPrompt, SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import { apply, scratchDirectory } from "./index.ts";

function createScopedAgent(ctx: Context, key: object, id: string) {
	const session = Session.create(SessionId(id));
	const scope = createScope(ctx, key);
	const agent = { id: session.id, session, ctx: scope.ctx } as unknown as Agent;
	return { agent, scope };
}

async function createContext(cwd: string): Promise<Context> {
	const ctx = new Context();
	new SystemPrompt(ctx, { includeHarnessIdentity: false });
	ctx.provide("workingDirectory", { get: () => cwd });
	apply(ctx);
	return ctx;
}

test("scratchDirectory accepts one safe path segment and rejects escapes", () => {
	const cwd = path.join(tmpdir(), "scratch-dir-guard");
	const root = path.join(cwd, ".agents", "scratch");
	assert.equal(
		scratchDirectory(cwd, "session-a"),
		path.join(root, "session-a"),
	);
	for (const id of ["", ".", "..", "foo/bar", "/absolute"]) {
		assert.equal(scratchDirectory(cwd, id), undefined);
	}
});

test("scratchDirectory resolves a relative cwd against the process directory", () => {
	assert.equal(
		scratchDirectory(".", "session-a"),
		path.join(process.cwd(), ".agents", "scratch", "session-a"),
	);
});

test("agent/created creates the scratch directory and injects the path", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "scratch-dir-test-"));
	t.after(async () => {
		await rm(cwd, { recursive: true, force: true });
	});
	const ctx = await createContext(cwd);
	const key = {};
	const { agent, scope } = createScopedAgent(ctx, key, "session-a");
	t.after(async () => {
		await scope.dispose();
	});

	await ctx.serial("agent/created", { agent, source: "startup" });

	const dir = path.join(cwd, ".agents", "scratch", "session-a");
	assert.equal(
		await readFile(path.join(cwd, ".agents", "scratch", ".gitignore"), "utf8"),
		"*\n",
	);
	assert.equal(
		renderPrompt(await ctx.systemPrompt.assemble({ scope: key })),
		`The scratch directory is located at ${dir}.`,
	);
});

test("each agent gets its own scoped instruction without leaking paths", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "scratch-dir-test-"));
	t.after(async () => {
		await rm(cwd, { recursive: true, force: true });
	});
	const ctx = await createContext(cwd);
	const firstKey = {};
	const secondKey = {};
	const first = createScopedAgent(ctx, firstKey, "session-first");
	const second = createScopedAgent(ctx, secondKey, "session-second");
	t.after(async () => {
		await first.scope.dispose();
	});
	t.after(async () => {
		await second.scope.dispose();
	});

	await ctx.serial("agent/created", { agent: first.agent, source: "startup" });
	await ctx.serial("agent/created", { agent: second.agent, source: "startup" });

	const firstPrompt = renderPrompt(
		await ctx.systemPrompt.assemble({ scope: firstKey }),
	);
	const secondPrompt = renderPrompt(
		await ctx.systemPrompt.assemble({ scope: secondKey }),
	);
	assert.equal(
		firstPrompt.includes(path.join(cwd, ".agents", "scratch", "session-first")),
		true,
	);
	assert.equal(
		secondPrompt.includes(
			path.join(cwd, ".agents", "scratch", "session-second"),
		),
		true,
	);
	assert.equal(
		secondPrompt.includes(
			path.join(cwd, ".agents", "scratch", "session-first"),
		),
		false,
	);
});

test("repeat creation is idempotent and leaves the gitignore intact", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "scratch-dir-test-"));
	t.after(async () => {
		await rm(cwd, { recursive: true, force: true });
	});
	const ctx = await createContext(cwd);
	const firstKey = {};
	const secondKey = {};
	const first = createScopedAgent(ctx, firstKey, "session-same");
	const second = createScopedAgent(ctx, secondKey, "session-same");
	t.after(async () => {
		await first.scope.dispose();
	});
	t.after(async () => {
		await second.scope.dispose();
	});

	await ctx.serial("agent/created", { agent: first.agent, source: "startup" });
	await ctx.serial("agent/created", { agent: second.agent, source: "resume" });

	assert.equal(
		await readFile(path.join(cwd, ".agents", "scratch", ".gitignore"), "utf8"),
		"*\n",
	);
	assert.equal(
		renderPrompt(await ctx.systemPrompt.assemble({ scope: firstKey })).includes(
			"session-same",
		),
		true,
	);
	assert.equal(
		renderPrompt(
			await ctx.systemPrompt.assemble({ scope: secondKey }),
		).includes("session-same"),
		true,
	);
});

test("agent/created does not veto creation when the directory cannot be created", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "scratch-dir-test-"));
	const blocked = path.join(root, "blocked");
	await writeFile(blocked, "not a directory");
	t.after(async () => {
		await rm(root, { recursive: true, force: true });
	});
	const ctx = await createContext(blocked);
	const key = {};
	const { agent, scope } = createScopedAgent(ctx, key, "session-blocked");
	t.after(async () => {
		await scope.dispose();
	});

	await ctx.serial("agent/created", { agent, source: "startup" });

	assert.equal(
		renderPrompt(await ctx.systemPrompt.assemble({ scope: key })),
		"",
	);
});
