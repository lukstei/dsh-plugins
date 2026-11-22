/**
 * PURPOSE: Shared data contracts for host Git reads and sidebar rendering.
 */

export interface SelectedLineRange {
	start: number;
	end: number;
	side: "deletions" | "additions";
	endSide: "deletions" | "additions";
}

export const COMMIT_PAGE_SIZE = 50;
export const MAX_BRANCH_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type GitCommit = {
	sha: string;
	subject: string;
	author: string;
	date: string;
};

export type ReviewScope =
	| {
			kind: "branch";
			repository: string;
			ref: string;
			base: { kind: "automatic" } | { kind: "manual"; ref: string };
			revision: { kind: "all-commits" } | { kind: "commit"; commit: GitCommit };
	  }
	| { kind: "uncommitted"; repository: string; stage: "staged" | "unstaged" };

export type BranchReviewScope = Extract<ReviewScope, { kind: "branch" }>;

/** A branch scope whose baseline is already resolved to a concrete ref. */
export type ResolvedReviewScope = Omit<BranchReviewScope, "base"> & {
	base: { kind: "manual"; ref: string };
};

export type ReviewSelection =
	| (Omit<BranchReviewScope, "base"> & {
			base: string;
	  })
	| Extract<ReviewScope, { kind: "uncommitted" }>;

export interface ReviewTarget {
	repository: string;
	branch: string;
	commit?: string;
}

export type ReviewCatalog =
	| { kind: "git"; repository: GitRepository; repositories: GitRepository[] }
	| { kind: "unavailable"; cwd: string; message: string };

export type ReviewView = { kind: "diff"; view: GitDiffView };

export interface GitFileDiff {
	path: string;
	status: "added" | "deleted" | "modified";
	addedLines: number;
	deletedLines: number;
}

export interface GitDiffSummary {
	files: number;
	added: number;
	deleted: number;
}

export interface GitRepository {
	cwd: string;
	target: string | null;
	baselines: { ref: string; label: string }[];
	gitbutlerError: string | null;
	branches: {
		ref: string;
		label: string;
		/** Branch tip committer time, in milliseconds since the Unix epoch. */
		modifiedAt: number;
		base: string | null;
		kind: "git" | "gitbutler";
	}[];
}

export interface GitCommitPage {
	commits: GitCommit[];
	hasMore: boolean;
}

export type GitComparison =
	| { kind: "branch"; branch: string; base: string }
	| { kind: "commit"; branch: string; commit: string }
	| { kind: "staged" }
	| { kind: "unstaged" };

export interface GitDiffView {
	target: string;
	snapshot: GitSnapshot;
	diffs: GitFileDiff[];
	summary: GitDiffSummary;
}

export interface GitSnapshot {
	kind: "revision" | "staged" | "unstaged";
	repository: string;
	before: string | null;
	after: string;
}

export type GitFileContents =
	| { kind: "text"; before: string | null; after: string | null }
	| { kind: "unavailable"; message: string };

export interface GitReviewComment {
	id: string;
	snapshot: GitSnapshot;
	path: string;
	side: "before" | "after";
	line: number;
	// edge case: annotation placement differs from the direction-preserving selected range.
	range: Required<SelectedLineRange>;
	text: string;
}
