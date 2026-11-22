import type { TypertRemoteNamespace } from "@deepseek-ai/dsh-typert-protocol";
import type {
	GitDiffView,
	GitRepository,
	GitReviewComment,
	ReviewCatalog,
} from "@lukstei/util-review-ui/types";

export function createMockRepository(
	cwd = "/repo/project-alpha",
	branches = [
		{
			ref: "refs/heads/feature/oauth",
			label: "feature/oauth",
			modifiedAt: Date.now() - 3600_000,
			base: "refs/remotes/origin/main",
			kind: "git" as const,
		},
		{
			ref: "refs/heads/fix/memory-leak",
			label: "fix/memory-leak",
			modifiedAt: Date.now() - 86400_000,
			base: "refs/remotes/origin/main",
			kind: "git" as const,
		},
	],
): GitRepository {
	return {
		cwd,
		target: "refs/remotes/origin/main",
		baselines: [{ ref: "refs/remotes/origin/main", label: "origin/main" }],
		gitbutlerError: null,
		branches,
	};
}

export function createMockCatalog(
	repo = createMockRepository(),
): Extract<ReviewCatalog, { kind: "git" }> {
	return {
		kind: "git",
		repository: repo,
		repositories: [repo],
	};
}

export function createMockComment(
	id: string,
	text: string,
	path = "src/auth.ts",
	start = 10,
	end = 12,
): GitReviewComment {
	return {
		id,
		path,
		text,
		side: "after",
		line: start,
		snapshot: {
			kind: "revision",
			repository: "/repo/project-alpha",
			before: "1111111111111111111111111111111111111111",
			after: "2222222222222222222222222222222222222222",
		},
		range: {
			start,
			end,
			side: "additions",
			endSide: "additions",
		},
	};
}

export function createMockDiffView(path = "src/auth.ts"): GitDiffView {
	return {
		target: "refs/remotes/origin/main",
		snapshot: {
			kind: "revision",
			repository: "/repo/project-alpha",
			before: "1111111111111111111111111111111111111111",
			after: "2222222222222222222222222222222222222222",
		},
		summary: { files: 2, added: 24, deleted: 6 },
		diffs: [
			{
				path,
				status: "modified",
				addedLines: 18,
				deletedLines: 6,
			},
			{
				path: "src/auth.spec.ts",
				status: "added",
				addedLines: 6,
				deletedLines: 0,
			},
		],
	};
}

export function createMockApi(): TypertRemoteNamespace<"workspaceReview"> {
	const catalog = createMockCatalog();
	const diffView = createMockDiffView();

	return {
		catalog: async () => ({ ok: true, value: catalog }),
		commits: async () => ({
			ok: true,
			value: {
				commits: [
					{
						sha: "a1b2c3d4",
						subject: "feat: Implement PKCE code challenge verification",
						author: "Jane Doe",
						date: "2026-11-03",
					},
				],
				hasMore: false,
			},
		}),
		view: async () => ({
			ok: true,
			value: { kind: "diff", view: diffView },
		}),
		resolve: async (_sessionId, target) => ({
			ok: true,
			value: {
				kind: "branch",
				repository: "/repo/project-alpha",
				ref: target.branch.startsWith("refs/heads/")
					? target.branch
					: `refs/heads/${target.branch}`,
				base: { kind: "manual", ref: "refs/remotes/origin/main" },
				revision: { kind: "all-commits" },
			},
		}),
		file: async () => ({
			ok: true,
			value: {
				kind: "text",
				before: "export function auth() {\n  return false;\n}\n",
				after:
					"export function auth(pkce?: string) {\n  if (!pkce) throw new Error('PKCE required');\n  return true;\n}\n",
			},
		}),
	};
}
