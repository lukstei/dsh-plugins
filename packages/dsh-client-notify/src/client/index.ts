import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type {} from "@deepseek-ai/dsh-api-session-controller/remote";
import type { SessionPendingInteraction } from "@deepseek-ai/dsh-client-ui-session/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { syncAppBadge } from "./badge.ts";
import type {} from "./contract.ts";
import {
	requestNotificationPermission,
	showBrowserNotification,
} from "./notify.ts";

export const inject = [
	"remote",
	"remote.session",
	"sessions",
	"uiSession",
] as const;

export const STOP_NOTIFICATION_DEBOUNCE_MS = 3000;
const RECENT_MESSAGE_WINDOW_MS = 60_000;

/**
 * Reports whether the session appended a user or assistant message inside the
 * recent-message window.
 *
 * edge case: command-driven work (workflow steps, scheduled scripts) appends no
 * chat message to the parent, so a run that produced no message stays silent by
 * design.
 */
export async function hasRecentMessage(
	ctx: ClientContext,
	sessionId: SessionId,
): Promise<boolean> {
	const now = Date.now();
	// A failed read must not swallow a real stop notification: fail open and warn.
	try {
		const result = await ctx.remote.session.events({
			address: { kind: "session", sessionId },
			maxMessages: 1,
		});
		if (!result.ok) {
			console.warn(
				"dsh-client-notify: session events read failed",
				result.error,
			);
			return true;
		}
		const records = result.value.records;
		for (let i = records.length - 1; i >= 0; i--) {
			const event = records[i].event;
			if (event.type === "user/message" || event.type === "assistant/message") {
				return event.time >= now - RECENT_MESSAGE_WINDOW_MS;
			}
		}
	} catch (error) {
		console.warn("dsh-client-notify: session events read threw", error);
		return true;
	}

	return false;
}

type SessionAlertKind = "permission" | "question" | "error";

/** @internal */
export function getSessionAlert(
	interaction: SessionPendingInteraction,
): SessionAlertKind | undefined {
	const hasApprovalQuestion =
		"questions" in interaction &&
		Array.isArray(interaction.questions) &&
		interaction.questions.some((q: unknown) => {
			if (typeof q !== "object" || q === null) return false;
			if (
				"id" in q &&
				typeof q.id === "string" &&
				q.id.startsWith("acp-permission:")
			) {
				return true;
			}
			if ("intent" in q && typeof q.intent === "object" && q.intent !== null) {
				const intent = q.intent;
				return "kind" in intent && intent.kind === "approval";
			}
			return false;
		});

	if (
		interaction.kind === "approval" ||
		interaction.key.startsWith("acp-permission:") ||
		hasApprovalQuestion
	) {
		return "permission";
	}
	if (interaction.kind === "question") {
		return "question";
	}
	if (interaction.kind !== "plan-review") {
		return "error";
	}
	return undefined;
}

export function apply(ctx: ClientContext): void {
	requestNotificationPermission();

	const sessions = ctx.sessions;
	const remote = ctx.remote;
	const sessionStatus = ctx.uiSession.sessionStatus;

	const runningSessions = new Set<string>();
	const stopTimers = new Map<SessionId, ReturnType<typeof setTimeout>>();

	function isSubagent(sessionId: SessionId): boolean {
		if (sessions.subagentAddress(sessionId) !== undefined) return true;
		const summary: SessionSummary | undefined =
			sessions.list.getSnapshot().byId[sessionId];
		if (
			summary !== undefined &&
			(summary.origin === "subagent" || summary.parentId !== undefined)
		) {
			return true;
		}
		return false;
	}

	function hasActiveSubagents(parentId: SessionId): boolean {
		const snapshot = sessions.list.getSnapshot();
		for (const summary of Object.values<SessionSummary>(snapshot.byId)) {
			if (
				summary &&
				summary.origin === "subagent" &&
				summary.parentId === parentId &&
				summary.running
			) {
				return true;
			}
		}
		return false;
	}

	ctx.effect(() => {
		const unregister = remote.$on(
			"api-session/status",
			(sessionId: SessionId, running: boolean) => {
				if (running) {
					const pendingTimer = stopTimers.get(sessionId);
					if (pendingTimer !== undefined) {
						clearTimeout(pendingTimer);
						stopTimers.delete(sessionId);
					}
					runningSessions.add(sessionId);

					if (isSubagent(sessionId)) {
						const parentId =
							sessions.list.getSnapshot().byId[sessionId]?.parentId;
						if (parentId) {
							const parentTimer = stopTimers.get(parentId);
							if (parentTimer !== undefined) {
								clearTimeout(parentTimer);
								stopTimers.delete(parentId);
							}
						}
					}
					return;
				}

				if (runningSessions.delete(sessionId)) {
					if (isSubagent(sessionId)) {
						const parentId =
							sessions.list.getSnapshot().byId[sessionId]?.parentId;
						if (
							parentId &&
							!runningSessions.has(parentId) &&
							!hasActiveSubagents(parentId) &&
							!stopTimers.has(parentId)
						) {
							const timer = setTimeout(async () => {
								stopTimers.delete(parentId);
								if (
									runningSessions.has(parentId) ||
									hasActiveSubagents(parentId)
								) {
									return;
								}
								const shouldNotify = await hasRecentMessage(ctx, parentId);
								if (
									shouldNotify &&
									!runningSessions.has(parentId) &&
									!hasActiveSubagents(parentId)
								) {
									showBrowserNotification(
										"DeepSeek Harness",
										"Agent stopped",
										"stop",
									);
								}
							}, STOP_NOTIFICATION_DEBOUNCE_MS);
							stopTimers.set(parentId, timer);
						}
						return;
					}

					if (hasActiveSubagents(sessionId)) return;

					// Workflows and chained prompt turns briefly settle to idle between steps
					// before immediately dispatching the next turn. Debounce stopping notifications
					// so intermediate workflow steps remain silent and only the true cessation of work alerts.
					const timer = setTimeout(async () => {
						stopTimers.delete(sessionId);
						if (
							runningSessions.has(sessionId) ||
							hasActiveSubagents(sessionId)
						) {
							return;
						}
						const shouldNotify = await hasRecentMessage(ctx, sessionId);
						if (
							shouldNotify &&
							!runningSessions.has(sessionId) &&
							!hasActiveSubagents(sessionId)
						) {
							showBrowserNotification(
								"DeepSeek Harness",
								"Agent stopped",
								"stop",
							);
						}
					}, STOP_NOTIFICATION_DEBOUNCE_MS);
					stopTimers.set(sessionId, timer);
				}
			},
		);

		return () => {
			unregister();
			for (const timer of stopTimers.values()) {
				clearTimeout(timer);
			}
			stopTimers.clear();
		};
	}, "dsh-client-notify: api-session/status listener");

	const seenInteractions = new Set<string>();

	ctx.effect(() => {
		const unsubscribe = sessionStatus.subscribe(() => {
			const snapshot = sessionStatus.getSnapshot();
			const activeKeys = new Set<string>();

			for (const [sessionId, status] of snapshot) {
				const interaction = status.pendingInteraction;
				if (interaction === undefined) continue;

				activeKeys.add(interaction.key);
				if (seenInteractions.has(interaction.key)) continue;
				seenInteractions.add(interaction.key);

				if (isSubagent(sessionId)) continue;

				const alertKind = getSessionAlert(interaction);
				if (alertKind === undefined) continue;

				if (alertKind === "permission") {
					let toolName: string;
					if (
						"toolName" in interaction &&
						typeof interaction.toolName === "string"
					) {
						toolName = interaction.toolName;
					} else if (
						"questions" in interaction &&
						Array.isArray(interaction.questions) &&
						interaction.questions.length > 0 &&
						typeof interaction.questions[0] === "object" &&
						interaction.questions[0] !== null &&
						"question" in interaction.questions[0] &&
						typeof interaction.questions[0].question === "string"
					) {
						toolName = interaction.questions[0].question;
					} else {
						toolName = "tool";
					}
					showBrowserNotification(
						"DeepSeek Harness",
						`Tool approval requested: ${toolName}`,
						"alert",
					);
				} else if (alertKind === "question") {
					const questions =
						"questions" in interaction && Array.isArray(interaction.questions)
							? interaction.questions
							: [];
					const questionText =
						questions.length > 0 &&
						typeof questions[0] === "object" &&
						questions[0] !== null &&
						"question" in questions[0] &&
						typeof questions[0].question === "string"
							? questions[0].question
							: "Question asked";
					showBrowserNotification(
						"DeepSeek Harness",
						`Question: ${questionText}`,
						"alert",
					);
				} else if (alertKind === "error") {
					showBrowserNotification(
						"DeepSeek Harness",
						`Action required: ${interaction.kind}`,
						"alert",
					);
				}
			}

			for (const key of seenInteractions) {
				if (!activeKeys.has(key)) {
					seenInteractions.delete(key);
				}
			}
		});

		return () => {
			unsubscribe();
		};
	}, "dsh-client-notify: uiSession status subscription");

	let recentReview = 0;
	let lastBadge = 0;
	const updateBadge = () => {
		let alerts = 0;
		for (const status of sessionStatus.getSnapshot().values()) {
			if (status.pendingInteraction !== undefined) alerts++;
		}
		const total = alerts + recentReview;
		if (total === lastBadge) return;
		lastBadge = total;
		syncAppBadge(total);
	};
	ctx.provide("appBadge", {
		setRecentReviewCount: (count) => {
			recentReview = count;
			updateBadge();
		},
	});
	ctx.effect(() => {
		updateBadge();
		const unsubscribe = sessionStatus.subscribe(updateBadge);
		return () => {
			unsubscribe();
			recentReview = 0;
			lastBadge = 0;
			syncAppBadge(0);
		};
	}, "dsh-client-notify: app icon badge");
}
