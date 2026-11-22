import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-session/types";
import { defineTool, type ToolExecution } from "@deepseek-ai/dsh-tools";
import { workspaceTitleOf } from "@deepseek-ai/dsh-util-workspace-path";
import {
	branchLabel,
	GIT_REVIEW_TOOL,
	reviewTargetSchema,
	shortSha,
} from "@lukstei/util-review-ui/review";
import type { ReviewTarget } from "@lukstei/util-review-ui/types";

/** Callback options for presentation tool lifecycle. */
export interface GitReviewToolOptions {
	onPresented?: (exec: ToolExecution, target: ReviewTarget) => void;
}

/**
 * Build the presentation tool for Git reviews.
 * @param options - optional presentation lifecycle callbacks.
 * @returns the registered tool definition.
 */
export function createGitReviewTool(options?: GitReviewToolOptions) {
	return defineTool({
		name: GIT_REVIEW_TOOL,
		description:
			"Present a Git review card in the transcript. Always use it instead of writing the branch and commit into the reply when the user should inspect them.",
		parameters: {
			repository: {
				type: "string",
				description:
					"Absolute path, or a path relative to the session working directory (a file or directory inside the repository). Defaults to the session working directory.",
			},
			branch: {
				type: "string",
				required: true,
				description:
					"Local branch name or full ref, e.g. `feature/x` or `refs/heads/feature/x`.",
			},
			commit: {
				type: "string",
				description:
					"Commit SHA or ref on `branch`. Reviews that commit alone instead of every commit on the branch.",
			},
		},
		output: {
			schema: {
				type: "object",
				properties: {
					repository: { type: "string", required: true },
					branch: { type: "string", required: true },
					commit: { type: "string" },
				},
				additionalProperties: false,
			},
			render: (_args, value) => {
				const commit =
					value.commit === undefined ? "" : ` @ ${shortSha(value.commit)}`;
				const repo =
					value.repository === ""
						? ""
						: ` (${workspaceTitleOf(value.repository)})`;
				return [
					{
						type: "text",
						text: `Git review ready: ${branchLabel(value.branch)}${commit}${repo}`,
					},
				];
			},
			presentationMeta: (_args, value) => value,
		},
		async execute(args, exec) {
			if (exec.agent === undefined)
				throw new Error("git_review_present requires an agent Session");
			exec.signal.throwIfAborted();
			const target = reviewTargetSchema.parse(args);
			options?.onPresented?.(exec, target);
			return {
				repository: target.repository,
				branch: target.branch,
				...(target.commit !== undefined ? { commit: target.commit } : {}),
			};
		},
	});
}
