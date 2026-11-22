import assert from "node:assert/strict";
import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import type {} from "@deepseek-ai/dsh-session";
import {
	type SessionEvent,
	type SessionHeader,
	SessionId,
} from "@deepseek-ai/dsh-session/types";
import type {} from "@deepseek-ai/dsh-session-persistence";
import type {} from "@deepseek-ai/dsh-tool-executor-ptc/types";
import type {} from "@deepseek-ai/dsh-tools";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type {} from "@deepseek-ai/dsh-working-directory";
import type {
	GitCommitPage,
	GitFileContents,
	GitRepository,
	GitSnapshot,
	ResolvedReviewScope,
	ReviewCatalog,
	ReviewSelection,
	ReviewTarget,
	ReviewView,
} from "@lukstei/util-review-ui/types";
import { z } from "zod";
import {
	compare,
	listCommits,
	readFileContents,
	readRepository,
	repositoryRoot,
	resolveReviewScope,
} from "./git-service.ts";

const editedPathSchema = z.object({ path: z.string().refine(isAbsolute) });

export class WorkspaceReviewService extends TypertRemoteService {
	static inject = [
		"sessionController",
		"workingDirectory",
		"sessions",
		"sessionPersistence",
	] as const;

	private locationsCache = new Map<
		string,
		| { kind: "git"; cwd: string; repositories: string[] }
		| { kind: "unavailable"; cwd: string; error: unknown }
	>();

	constructor(ctx: Context) {
		super(ctx, "workspaceReview");
	}

	private async inspectSession(
		sessionId: string,
		signal?: AbortSignal,
	): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }> {
		const sid = SessionId(sessionId);
		const attached = this.ctx.sessions.get(sid);
		if (attached !== undefined) {
			return {
				meta: attached.header,
				events: attached.snapshotEvents(),
			};
		}
		const handle = await this.ctx.sessionPersistence.open(
			sid,
			"read",
			signal ? { signal } : undefined,
		);
		try {
			const result = await handle.read(
				undefined,
				undefined,
				signal ? { signal } : undefined,
			);
			return {
				meta: handle.header,
				events: result.events,
			};
		} finally {
			await handle.close();
		}
	}

	private async sessionLocations(sessionId: string, signal: AbortSignal) {
		const cached = this.locationsCache.get(sessionId);
		const locations =
			cached !== undefined ? cached : await this.locations(sessionId, signal);
		if (locations.kind === "unavailable") throw locations.error;
		return locations;
	}

	private assertSessionRepository(
		locations: { repositories: string[] },
		repository: string,
	): void {
		assert(
			locations.repositories.includes(repository),
			"Repository is not part of this session",
		);
	}

	private async directory(
		sessionId: string,
		signal: AbortSignal,
		target: string,
	): Promise<string> {
		const locations = await this.sessionLocations(sessionId, signal);
		this.assertSessionRepository(locations, target);
		return target;
	}

	private async repositoryFor(
		sessionId: string,
		signal: AbortSignal,
		repository: string,
	): Promise<string> {
		const locations = await this.sessionLocations(sessionId, signal);
		let cwd =
			repository.trim() === ""
				? locations.cwd
				: resolve(locations.cwd, repository);
		const info = await stat(cwd);
		if (info.isFile()) cwd = dirname(cwd);
		const root = await repositoryRoot(cwd, signal);
		if (root === null) throw new Error(`No Git repository at ${cwd}`);
		this.assertSessionRepository(locations, root);
		return root;
	}

	private async locations(
		sessionId: string,
		signal: AbortSignal,
	): Promise<
		| { kind: "git"; cwd: string; repositories: string[] }
		| { kind: "unavailable"; cwd: string; error: unknown }
	> {
		const cached = this.locationsCache.get(sessionId);
		if (cached !== undefined) return cached;
		const inspection = await this.inspectSession(sessionId, signal);
		assert(inspection.meta.cwd, "Review requires a Session workspace");
		const changeIndex = inspection.events.findLastIndex(
			(event: SessionEvent) => event.type === "working-directory/change",
		);
		const change = inspection.events[changeIndex];
		let cwd =
			change === undefined || change.type !== "working-directory/change"
				? inspection.meta.cwd
				: change.data.cwd;
		try {
			signal.throwIfAborted();
			try {
				await stat(cwd);
			} catch (error) {
				signal.throwIfAborted();
				if (
					error instanceof Error &&
					"code" in error &&
					error.code === "ENOENT"
				) {
					const result = await this.ctx.sessionController.resolveAgent(
						SessionId(sessionId),
					);
					if ("error" in result) throw result.error;
					cwd = await this.ctx.workingDirectory.ensure(result.agent, signal);
				} else throw error;
			}
			signal.throwIfAborted();
			const repositories: string[] = [];
			const root = await repositoryRoot(cwd, signal);
			if (root !== null) repositories.push(root);

			const calls = new Set<string>();
			const files = new Set<string>();
			const dirCache = new Map<string, string | null>();
			if (root !== null) dirCache.set(root, root);

			for (const event of inspection.events.slice(changeIndex + 1)) {
				if (
					event.type === "tool/call" &&
					(event.data.name === "write" || event.data.name === "edit")
				)
					calls.add(event.data.callId);
				let meta: SessionEvent<"tool/result">["data"]["meta"];
				if (event.type === "tool/ptc-dispatch") {
					if (
						event.data.isError ||
						(event.data.name !== "write" && event.data.name !== "edit")
					)
						continue;
					meta = event.data.meta;
				} else if (
					event.type === "tool/result" &&
					!event.data.message.isError &&
					calls.has(event.data.message.toolCallId)
				) {
					meta = event.data.meta;
				} else continue;
				const parsed = editedPathSchema.safeParse(meta);
				if (!parsed.success || files.has(parsed.data.path)) continue;
				files.add(parsed.data.path);
				const directory = dirname(parsed.data.path);

				let repository: string | null;
				const cached = dirCache.get(directory);
				if (cached !== undefined) {
					repository = cached;
				} else {
					let canonicalDir = directory;
					try {
						await stat(directory);
						canonicalDir = await realpath(directory);
					} catch (error) {
						signal.throwIfAborted();
						if (
							error instanceof Error &&
							"code" in error &&
							error.code === "ENOENT"
						) {
							dirCache.set(directory, null);
							continue;
						}
						throw error;
					}
					repository = await repositoryRoot(directory, signal);
					dirCache.set(directory, repository);
					if (canonicalDir !== directory) {
						dirCache.set(canonicalDir, repository);
					}
					if (repository !== null) {
						let current = canonicalDir;
						while (
							current !== repository &&
							current.startsWith(repository) &&
							current !== dirname(current)
						) {
							current = dirname(current);
							dirCache.set(current, repository);
						}
					}
				}
				if (repository !== null && !repositories.includes(repository)) {
					repositories.push(repository);
				}
			}

			let result:
				| { kind: "git"; cwd: string; repositories: string[] }
				| { kind: "unavailable"; cwd: string; error: unknown };
			if (repositories.length > 0) {
				result = { kind: "git", cwd, repositories };
			} else {
				result = {
					kind: "unavailable",
					cwd,
					error: new Error(
						"No Git repository found in the working directory or edited files",
					),
				};
			}
			this.locationsCache.set(sessionId, result);
			return result;
		} catch (error) {
			signal.throwIfAborted();
			const failure = { kind: "unavailable" as const, cwd, error };
			this.locationsCache.set(sessionId, failure);
			return failure;
		}
	}

	@Remote({ resources: { session: (sessionId) => SessionId(sessionId) } })
	async catalog(
		sessionId: string,
		signal: AbortSignal,
	): Promise<ReviewCatalog> {
		this.locationsCache.delete(sessionId);
		const locations = await this.locations(sessionId, signal);
		if (locations.kind === "unavailable")
			return {
				kind: "unavailable",
				cwd: locations.cwd,
				message: String(locations.error),
			};
		try {
			const settled = await Promise.allSettled(
				locations.repositories.map((cwd) => readRepository(cwd, signal)),
			);
			const repositories: GitRepository[] = [];
			for (const result of settled) {
				if (result.status === "fulfilled") {
					repositories.push(result.value);
				}
			}
			if (repositories.length === 0) {
				return {
					kind: "unavailable",
					cwd: locations.cwd,
					message: "No repositories could be read",
				};
			}
			return {
				kind: "git",
				repository: repositories[0],
				repositories,
			};
		} catch (error) {
			signal.throwIfAborted();
			return {
				kind: "unavailable",
				cwd: locations.cwd,
				message: String(error),
			};
		}
	}

	@Remote({ resources: { session: (sessionId) => SessionId(sessionId) } })
	async resolve(
		sessionId: string,
		target: ReviewTarget,
		signal: AbortSignal,
	): Promise<ResolvedReviewScope> {
		return resolveReviewScope(
			await this.repositoryFor(sessionId, signal, target.repository),
			target,
			signal,
		);
	}

	@Remote({ resources: { session: (sessionId) => SessionId(sessionId) } })
	async commits(
		sessionId: string,
		repository: string,
		branch: string,
		base: string,
		offset: number,
		signal: AbortSignal,
	): Promise<GitCommitPage> {
		const cwd = await this.directory(sessionId, signal, repository);
		return listCommits(cwd, branch, base, offset, signal);
	}

	@Remote({ resources: { session: (sessionId) => SessionId(sessionId) } })
	async view(
		sessionId: string,
		selection: ReviewSelection,
		signal: AbortSignal,
	): Promise<ReviewView> {
		switch (selection.kind) {
			case "branch":
				return {
					kind: "diff",
					view: await compare(
						await this.directory(sessionId, signal, selection.repository),
						selection.revision.kind === "all-commits"
							? { kind: "branch", branch: selection.ref, base: selection.base }
							: {
									kind: "commit",
									branch: selection.ref,
									commit: selection.revision.commit.sha,
								},
						signal,
					),
				};
			case "uncommitted":
				return {
					kind: "diff",
					view: await compare(
						await this.directory(sessionId, signal, selection.repository),
						{ kind: selection.stage },
						signal,
					),
				};
			default:
				selection satisfies never;
				throw new Error("Unknown review scope");
		}
	}

	@Remote({ resources: { session: (sessionId) => SessionId(sessionId) } })
	async file(
		sessionId: string,
		snapshot: GitSnapshot,
		path: string,
		signal: AbortSignal,
	): Promise<GitFileContents> {
		const cwd = await this.directory(sessionId, signal, snapshot.repository);
		return readFileContents(cwd, snapshot, path, signal);
	}
}

declare module "@deepseek-ai/cordis" {
	interface Context {
		workspaceReview: WorkspaceReviewService;
	}
}
