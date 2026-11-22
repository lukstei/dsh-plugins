import type { Context } from "@deepseek-ai/cordis";
import type { CommandId } from "@deepseek-ai/dsh-commands";
import type { Session } from "@deepseek-ai/dsh-session";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import type { ReviewTarget } from "@lukstei/util-review-ui/types";
import { createGitReviewTool } from "./review-tool.ts";
import { WorkspaceReviewService } from "./workspace-review-service.ts";

export type { GitReviewToolOptions } from "./review-tool.ts";
export { createGitReviewTool } from "./review-tool.ts";
export { WorkspaceReviewService } from "./workspace-review-service.ts";

export const name = "dsh-client-git-diff";
export const inject = [
	"sessionController",
	"workingDirectory",
	"sessions",
	"sessionPersistence",
] as const;

export function apply(ctx: Context): void {
	ctx.plugin(WorkspaceReviewService);
	ctx.plugin({
		inject: ["tools", "agents"],
		apply: (toolCtx) => {
			const pending = new WeakMap<
				ToolExecution,
				{ session: Session; turn: number; target: ReviewTarget }
			>();
			toolCtx.tools.register(
				createGitReviewTool({
					onPresented: (exec, target) => {
						if (exec.agent === undefined) return;
						const boundary = toolCtx.agents.turnBoundaryOf(exec.agent.session);
						const turn =
							boundary.openTurnStartSeq !== null
								? boundary.lastTurn
								: boundary.lastTurn || 1;
						pending.set(exec, {
							session: exec.agent.session,
							turn,
							target,
						});
					},
				}),
			);
			toolCtx.on("tools/result", (exec, result) => {
				const delivery = pending.get(exec);
				pending.delete(exec);
				if (delivery === undefined || result.isError) return;
				const { session, turn, target } = delivery;
				const commandId = `git-review-${exec.callId}` as CommandId;
				session.append("command/run", {
					commandId,
					name: "git-review",
					args: JSON.stringify({ turn, callId: exec.callId, target }),
					source: { kind: "user" },
				});
				session.append("command/done", {
					commandId,
					kind: "success",
					text: `Git review presented: ${target.branch}`,
				});
			});
		},
	});
}
