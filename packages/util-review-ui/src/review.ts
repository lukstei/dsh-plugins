import { z } from "zod";
import type { BranchReviewScope, GitReviewComment } from "./types.ts";

const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const commitRecord = z.object({
	sha: commit,
	subject: z.string(),
	author: z.string(),
	date: z.string(),
});
export const reviewTargetSchema = z.object({
	repository: z.string().default(""),
	branch: z.string().min(1),
	commit: z.string().min(1).optional(),
});

/** Wire name of the presentation tool whose calls publish a review card. */
export const GIT_REVIEW_TOOL = "git_review_present";

/** Durable shape the presentation tool publishes on its successful result. */
export const branchReviewScopeSchema = z.object({
	kind: z.literal("branch"),
	repository: z.string().min(1),
	ref: z.string().min(1),
	base: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("automatic") }),
		z.object({ kind: z.literal("manual"), ref: z.string().min(1) }),
	]),
	revision: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("all-commits") }),
		z.object({ kind: z.literal("commit"), commit: commitRecord }),
	]),
}) satisfies z.ZodType<BranchReviewScope>;

export function branchLabel(ref: string): string {
	return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

export function shortSha(sha: string): string {
	return sha.slice(0, 7);
}

export const snapshotSchema = z.object({
	kind: z.enum(["revision", "staged", "unstaged"]),
	repository: z.string().min(1),
	before: commit.nullable(),
	after: commit,
});
export function commentLines(comment: GitReviewComment): string {
	const { range } = comment;
	const side = range.side === "deletions" ? "before" : "after";
	const endSide = range.endSide === "deletions" ? "before" : "after";
	if (side !== endSide)
		return `${side}:${range.start} → ${endSide}:${range.end}`;
	return range.start === range.end
		? String(range.start)
		: `${Math.min(range.start, range.end)}–${Math.max(range.start, range.end)}`;
}
