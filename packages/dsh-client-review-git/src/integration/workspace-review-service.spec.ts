import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { MessageId, ToolCallId } from "@deepseek-ai/dsh-llm/brand";
import { Session } from "@deepseek-ai/dsh-session";
import {
	type SessionEvent,
	type SessionHeader,
	SessionId,
	SessionLogOffset,
	SessionSeq,
} from "@deepseek-ai/dsh-session/types";
import type {} from "@deepseek-ai/dsh-working-directory";
import { test, vi } from "vitest";
import { WorkspaceReviewService } from "../workspace-review-service.ts";

function mockSessionStorage(
	ctx: Context,
	inspection: (
		id?: SessionId,
		signal?: AbortSignal,
	) =>
		| {
				meta: SessionHeader;
				events: readonly SessionEvent[];
		  }
		| Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }>,
) {
	ctx.provide("sessions", { get: () => undefined });
	ctx.provide("sessionPersistence", {
		open: async (
			id: SessionId,
			_access: string,
			options?: { signal?: AbortSignal },
		) => {
			const current = await inspection(id, options?.signal);
			return {
				id,
				header: current.meta,
				inheritedEventCount: SessionLogOffset(0),
				access: "read" as const,
				read: async () => ({
					eventState: "frozen" as const,
					events: current.events,
				}),
				close: async () => {},
				[Symbol.asyncDispose]: async () => {},
			};
		},
	});
}

test.each([
	"first",
	"fifth",
	"sixth",
	"duplicates",
	"failed",
	"cwd",
	"changed-directory",
	"worktree",
	"missing-fifth",
	"missing-sixth",
	"ptc-write",
	"ptc-edit",
	"ptc-failed",
	"mixed-fifth",
	"mixed-sixth",
	"mixed-duplicates",
])(
	"nested repository discovery: %s",
	async (scenario) => {
		const workspace = realpathSync(
			mkdtempSync(join(tmpdir(), "dsh-nested-review-")),
		);
		const project = join(workspace, "project");
		mkdirSync(project);
		const git = (...args: string[]) =>
			execFileSync("git", args, {
				cwd: project,
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
			}).trim();
		git("init", "--initial-branch=main");
		git(
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"--allow-empty",
			"-m",
			"Initial",
		);
		let repository = project;
		if (scenario === "worktree") {
			repository = join(workspace, "linked");
			git("worktree", "add", "-b", "linked", repository);
		}
		const events: SessionEvent[] = [];
		const edit = (path: string, failed = false) => {
			const callId = ToolCallId(`edit-${events.length}`);
			events.push({
				type: "tool/call",
				seq: SessionSeq(events.length),
				time: 0,
				data: { turn: 1, step: 1, callId, name: "edit", arguments: "{}" },
			});
			events.push({
				type: "tool/result",
				surfaceOp: "append",
				seq: SessionSeq(events.length),
				time: 0,
				data: {
					turn: 1,
					step: 1,
					message: {
						id: MessageId(`result-${events.length}`),
						source: { kind: "tool", callId },
						role: "tool",
						toolCallId: callId,
						content: [],
						isError: failed,
					},
					meta: { path },
				},
			});
		};
		const dispatch = (path: string, name: string, isError: boolean) => {
			events.push({
				type: "tool/ptc-dispatch",
				seq: SessionSeq(events.length),
				time: 0,
				data: {
					rootCallId: ToolCallId("run"),
					parentCallId: ToolCallId("run"),
					subCallId: ToolCallId(`sub-${events.length}`),
					name,
					arguments: {},
					content: [],
					isError,
					meta: { path },
				},
			});
		};
		if (scenario === "fifth" || scenario === "sixth")
			for (let i = 0; i < (scenario === "fifth" ? 4 : 5); i++)
				edit(join(workspace, `scratch-${i}.txt`));
		if (scenario === "duplicates")
			for (let i = 0; i < 6; i++) edit(join(workspace, "scratch.txt"));
		if (scenario === "missing-fifth" || scenario === "missing-sixth")
			for (let i = 0; i < (scenario === "missing-fifth" ? 4 : 5); i++)
				edit(join(workspace, `removed-${i}`, "file.txt"));
		if (scenario === "mixed-fifth" || scenario === "mixed-sixth")
			for (let i = 0; i < (scenario === "mixed-fifth" ? 4 : 5); i++) {
				const path = join(workspace, `scratch-${i}.txt`);
				if (i % 2 === 0) edit(path);
				else dispatch(path, "write", false);
			}
		if (scenario === "mixed-duplicates") {
			for (let i = 0; i < 6; i++) {
				edit(join(workspace, "scratch.txt"));
				dispatch(join(workspace, "scratch.txt"), "edit", false);
				dispatch(join(repository, "ignored.txt"), "edit", true);
			}
		}
		if (
			scenario === "ptc-write" ||
			scenario === "ptc-edit" ||
			scenario === "ptc-failed"
		)
			dispatch(
				join(repository, "new.txt"),
				scenario === "ptc-write" ? "write" : "edit",
				scenario === "ptc-failed",
			);
		else edit(join(repository, "new.txt"), scenario === "failed");
		if (scenario === "first") {
			const second = join(workspace, "second");
			mkdirSync(second);
			execFileSync("git", ["init", "--initial-branch=other"], { cwd: second });
			edit(join(second, "other.txt"));
		}
		if (scenario === "changed-directory")
			events.push({
				type: "working-directory/change",
				seq: SessionSeq(events.length),
				time: 0,
				data: { cwd: workspace },
			});
		writeFileSync(join(repository, "new.txt"), "new contents\n");
		const ctx = new Context();
		const resolveAgent = vi.fn();
		ctx.provide("sessionController", { resolveAgent });
		mockSessionStorage(ctx, () => ({
			meta: {
				version: 4,
				id: SessionId("owner"),
				createdAt: 0,
				isSeeded: false,
				cwd: scenario === "cwd" ? project : workspace,
			},
			events,
		}));
		const service = new WorkspaceReviewService(ctx);
		const signal = new AbortController().signal;
		try {
			const catalog = await service.catalog("owner", signal);
			if (
				scenario === "failed" ||
				scenario === "changed-directory" ||
				scenario === "ptc-failed"
			) {
				assert.equal(catalog.kind, "unavailable");
			} else {
				assert.equal(catalog.kind, "git");
				assert.equal(catalog.repository.cwd, repository);
				if (scenario === "first") {
					assert.equal(catalog.repositories.length, 2);
					assert.equal(catalog.repositories[0].cwd, repository);
					assert.equal(catalog.repositories[1].cwd, join(workspace, "second"));
				} else {
					assert.equal(catalog.repositories.length, 1);
				}
				const view = await service.view(
					"owner",
					{ kind: "uncommitted", repository, stage: "unstaged" },
					signal,
				);
				assert.equal(view.kind, "diff");
				assert.equal(view.view.snapshot.repository, repository);
				assert.deepEqual(
					await service.file("owner", view.view.snapshot, "new.txt", signal),
					{ kind: "text", before: null, after: "new contents\n" },
				);
				const page = await service.commits(
					"owner",
					repository,
					scenario === "worktree" ? "linked" : "main",
					"main",
					0,
					signal,
				);
				assert.deepEqual(page.commits, []);
			}
			assert.equal(resolveAgent.mock.calls.length, 0);
		} finally {
			rmSync(workspace, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 50,
			});
		}
	},
	15000,
);

test.each(["resolve", "ensure"])(
	"Git endpoints preserve original %s recovery failures",
	async (source) => {
		const workspace = mkdtempSync(join(tmpdir(), "dsh-review-errors-"));
		const failure = Object.assign(
			new Error("Recovery denied", { cause: new Error("Permission denied") }),
			{ code: "EACCES" },
		);
		const ctx = new Context();
		ctx.provide("sessionController", {
			resolveAgent: async () =>
				source === "resolve" ? { error: failure } : { agent: Symbol("owner") },
		});
		mockSessionStorage(ctx, () => ({
			meta: {
				version: 4,
				id: SessionId("owner"),
				createdAt: 0,
				isSeeded: false,
				cwd: join(workspace, "missing"),
			},
			events: [],
		}));
		ctx.provide("workingDirectory", {
			ensure: async () => {
				throw failure;
			},
		});
		const service = new WorkspaceReviewService(ctx);
		const signal = new AbortController().signal;
		try {
			const catalog = await service.catalog("owner", signal);
			assert.equal(catalog.kind, "unavailable");
			assert.equal(catalog.message, String(failure));
			const reads = [
				() => service.commits("owner", workspace, "main", "main", 0, signal),
				() =>
					service.view(
						"owner",
						{ kind: "uncommitted", repository: workspace, stage: "unstaged" },
						signal,
					),
				() =>
					service.view(
						"owner",
						{
							kind: "branch",
							repository: workspace,
							ref: "main",
							base: "main",
							revision: { kind: "all-commits" },
						},
						signal,
					),
				() =>
					service.file(
						"owner",
						{
							kind: "revision",
							repository: workspace,
							before: null,
							after: "head",
						},
						"file.txt",
						signal,
					),
			];
			for (const read of reads)
				await assert.rejects(read, (error: unknown) => error === failure);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	},
);

test("catalog uses the Session's effective directory and reports unavailable Git without activating it", async () => {
	const ctx = new Context();
	const resolveAgent = vi.fn();
	const event: SessionEvent<"working-directory/change"> = {
		type: "working-directory/change",
		seq: SessionSeq(0),
		time: 0,
		data: { cwd: tmpdir() },
	};
	ctx.provide("sessionController", { resolveAgent });
	mockSessionStorage(ctx, () => ({
		meta: {
			version: 4,
			id: SessionId("owner"),
			createdAt: 0,
			isSeeded: false,
			cwd: "/original",
		},
		events: [event],
	}));
	const service = new WorkspaceReviewService(ctx);
	const result = await service.catalog("owner", new AbortController().signal);
	assert.equal(result.kind, "unavailable");
	assert.equal(result.cwd, tmpdir());
	assert.equal(resolveAgent.mock.calls.length, 0);
});

test.each(["recovered", "failed", "cancelled"])(
	"catalog missing-directory recovery: %s",
	async (outcome) => {
		const project = mkdtempSync(join(tmpdir(), "dsh-catalog-recovery-"));
		const missing = join(project, "removed-worktree");
		execFileSync("git", ["init", "--initial-branch=main"], { cwd: project });
		const ctx = new Context();
		const controller = new AbortController();
		const agent = Symbol("owner-agent");
		const resolveAgent = vi.fn(async () => ({ agent }));
		const ensure = vi.fn<Context["workingDirectory"]["ensure"]>(async () => {
			if (outcome === "failed") throw new Error("Original project unavailable");
			if (outcome === "cancelled") {
				controller.abort();
				controller.signal.throwIfAborted();
			}
			return project;
		});
		const event: SessionEvent<"working-directory/change"> = {
			type: "working-directory/change",
			seq: SessionSeq(0),
			time: 0,
			data: { cwd: missing },
		};
		ctx.provide("sessionController", { resolveAgent });
		mockSessionStorage(ctx, () => ({
			meta: {
				version: 4,
				id: SessionId("owner"),
				createdAt: 0,
				isSeeded: false,
				cwd: project,
			},
			events: [event],
		}));
		ctx.provide("workingDirectory", { ensure });
		const service = new WorkspaceReviewService(ctx);
		try {
			if (outcome === "cancelled")
				await assert.rejects(service.catalog("owner", controller.signal), {
					name: "AbortError",
				});
			else {
				const catalog = await service.catalog("owner", controller.signal);
				if (outcome === "recovered") {
					assert.equal(catalog.kind, "git");
					assert.equal(catalog.repository.cwd, realpathSync(project));
				} else {
					assert.equal(catalog.kind, "unavailable");
					assert.match(catalog.message, /Original project unavailable/);
				}
			}
			assert.deepEqual(resolveAgent.mock.calls, [["owner"]]);
			assert.deepEqual(ensure.mock.calls, [[agent, controller.signal]]);
		} finally {
			rmSync(project, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 50,
			});
		}
	},
);

test("discovers multiple modified repositories in session history with path memoization", async () => {
	const workspace = realpathSync(
		mkdtempSync(join(tmpdir(), "dsh-multi-repo-review-")),
	);
	try {
		const repoA = join(workspace, "repo-a");
		const repoB = join(workspace, "repo-b");
		mkdirSync(join(repoA, "src", "client"), { recursive: true });
		mkdirSync(join(repoB, "pkg", "sub"), { recursive: true });
		execFileSync("git", ["init", "--initial-branch=main"], { cwd: repoA });
		execFileSync("git", ["init", "--initial-branch=feature"], { cwd: repoB });
		execFileSync(
			"git",
			[
				"-c",
				"user.name=T",
				"-c",
				"user.email=t@e.com",
				"commit",
				"--allow-empty",
				"-m",
				"init",
			],
			{ cwd: repoA },
		);
		execFileSync(
			"git",
			[
				"-c",
				"user.name=T",
				"-c",
				"user.email=t@e.com",
				"commit",
				"--allow-empty",
				"-m",
				"init",
			],
			{ cwd: repoB },
		);

		const events: SessionEvent[] = [];
		const edit = (path: string) => {
			const callId = ToolCallId(`call-${events.length}`);
			events.push({
				type: "tool/call",
				seq: SessionSeq(events.length),
				time: 0,
				data: { turn: 1, step: 1, callId, name: "write", arguments: "{}" },
			});
			events.push({
				type: "tool/result",
				surfaceOp: "append",
				seq: SessionSeq(events.length),
				time: 0,
				data: {
					turn: 1,
					step: 1,
					message: {
						id: MessageId(`res-${events.length}`),
						source: { kind: "tool", callId },
						role: "tool",
						toolCallId: callId,
						content: [],
						isError: false,
					},
					meta: { path },
				},
			});
		};

		edit(join(repoA, "src", "client", "app.tsx"));
		edit(join(repoA, "src", "client", "button.tsx"));
		edit(join(repoA, "src", "utils.ts"));
		edit(join(repoA, "package.json"));
		edit(join(repoB, "pkg", "sub", "main.go"));
		edit(join(repoB, "go.mod"));

		const ctx = new Context();
		mockSessionStorage(ctx, () => ({
			meta: {
				version: 4,
				id: SessionId("s1"),
				createdAt: 0,
				isSeeded: false,
				cwd: workspace,
			},
			events,
		}));
		const service = new WorkspaceReviewService(ctx);
		const signal = new AbortController().signal;
		const catalog = await service.catalog("s1", signal);
		assert.equal(catalog.kind, "git");
		assert.equal(catalog.repositories.length, 2);
		assert.equal(catalog.repositories[0].cwd, repoA);
		assert.equal(catalog.repositories[1].cwd, repoB);
	} finally {
		rmSync(workspace, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
	}
});

test("catalog remains available when a secondary repository fails to read", async () => {
	const workspace = realpathSync(
		mkdtempSync(join(tmpdir(), "dsh-resilient-review-")),
	);
	try {
		const repoA = join(workspace, "repo-a");
		const repoB = join(workspace, "repo-b");
		mkdirSync(repoA);
		mkdirSync(repoB);
		const gitA = (...args: string[]) =>
			execFileSync("git", args, {
				cwd: repoA,
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
			}).trim();
		gitA("init", "--initial-branch=main");
		gitA(
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"--allow-empty",
			"-m",
			"Initial A",
		);

		const events: SessionEvent[] = [];
		const edit = (path: string) => {
			const callId = ToolCallId(`call-${events.length}`);
			events.push({
				type: "tool/call",
				seq: SessionSeq(events.length),
				time: 0,
				data: { turn: 1, step: 1, callId, name: "write", arguments: "{}" },
			});
			events.push({
				type: "tool/result",
				surfaceOp: "append",
				seq: SessionSeq(events.length),
				time: 0,
				data: {
					turn: 1,
					step: 1,
					message: {
						id: MessageId(`res-${events.length}`),
						source: { kind: "tool", callId },
						role: "tool",
						toolCallId: callId,
						content: [],
						isError: false,
					},
					meta: { path },
				},
			});
		};
		edit(join(repoA, "file.txt"));
		edit(join(repoB, "file.txt"));

		const ctx = new Context();
		mockSessionStorage(ctx, () => ({
			meta: {
				version: 4,
				id: SessionId("s1"),
				createdAt: 0,
				isSeeded: false,
				cwd: workspace,
			},
			events,
		}));
		const service = new WorkspaceReviewService(ctx);
		const signal = new AbortController().signal;
		const catalog = await service.catalog("s1", signal);
		assert.equal(catalog.kind, "git");
		assert.equal(catalog.repositories.length, 1);
		assert.equal(catalog.repositories[0].cwd, repoA);
	} finally {
		rmSync(workspace, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
	}
});

test("inspectSession reads from attached in-memory session when available without opening persistence", async () => {
	const ctx = new Context();
	const id = SessionId("attached-session");
	const header: SessionHeader = {
		version: 4,
		id,
		createdAt: 0,
		isSeeded: false,
		cwd: tmpdir(),
	};
	const session = Session.create(id, [], header);
	ctx.provide("sessions", {
		get: (targetId: SessionId) =>
			targetId === session.id ? session : undefined,
	});
	const open = vi.fn();
	ctx.provide("sessionPersistence", { open });
	const service = new WorkspaceReviewService(ctx);
	const result = await service.catalog(
		session.id,
		new AbortController().signal,
	);
	assert.equal(result.kind, "unavailable");
	assert.equal(
		open.mock.calls.length,
		0,
		"Attached session must not call sessionPersistence.open",
	);
});

test("WorkspaceReviewService resolves injected services through Cordis plugin fiber without inject error", async () => {
	const root = new Context();
	const id = SessionId("test-session");
	const header: SessionHeader = {
		version: 4,
		id,
		createdAt: 0,
		isSeeded: false,
		cwd: tmpdir(),
	};
	const session = Session.create(id, [], header);

	const app = root.plugin(function ProviderFiber(ctx) {
		ctx.provide("sessions", {
			get: (targetId: SessionId) =>
				targetId === session.id ? session : undefined,
		});
		ctx.provide("sessionPersistence", { open: vi.fn() });
		ctx.provide("sessionController", {});
		ctx.provide("workingDirectory", {});
	});
	await app.await();

	const pluginFiber = root.plugin(function HostFiber(ctx) {
		ctx.plugin(WorkspaceReviewService);
	});
	await pluginFiber.await();

	const signal = new AbortController().signal;
	const view = await root.workspaceReview.catalog(session.id, signal);
	assert.equal(view.kind, "unavailable");
});

test("resolve accepts a file inside the Session repository and rejects a foreign one", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "dsh-resolve-"));
	const repository = join(workspace, "repo");
	mkdirSync(repository);
	const git = (...args: string[]): string =>
		execFileSync("git", args, {
			cwd: repository,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});
	git("init", "--initial-branch=main");
	git("config", "user.name", "Diff Test");
	git("config", "user.email", "diff@example.test");
	writeFileSync(join(repository, "initial.txt"), "initial\n");
	git("add", ".");
	git("commit", "-m", "Initial");
	git("branch", "feature");
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
	const foreign = join(workspace, "foreign");
	mkdirSync(foreign);
	execFileSync("git", ["init", "--initial-branch=main"], { cwd: foreign });
	const ctx = new Context();
	ctx.provide("sessionController", { resolveAgent: vi.fn() });
	mockSessionStorage(ctx, () => ({
		meta: {
			version: 4,
			id: SessionId("owner"),
			createdAt: 0,
			isSeeded: false,
			cwd: repository,
		},
		events: [],
	}));
	const service = new WorkspaceReviewService(ctx);
	const signal = new AbortController().signal;
	try {
		const scope = await service.resolve(
			"owner",
			{ repository: "initial.txt", branch: "feature" },
			signal,
		);
		assert.deepEqual(scope, {
			kind: "branch",
			repository: realpathSync(repository),
			ref: "refs/heads/feature",
			base: { kind: "manual", ref: "refs/remotes/origin/main" },
			revision: { kind: "all-commits" },
		});
		await assert.rejects(
			service.resolve(
				"owner",
				{ repository: foreign, branch: "feature" },
				signal,
			),
			/not part of this session/,
		);
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
});
