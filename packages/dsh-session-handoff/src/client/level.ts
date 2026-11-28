import type { Limits } from "../limits.ts";

export type HandoffLevel = "none" | "soft" | "strong";

// The window still caps the bars, so small-window models warn before compaction does.
const SOFT_WINDOW_SHARE = 0.6;
const STRONG_WINDOW_SHARE = 0.8;

export function handoffLevel(
	pressureTokens: number | undefined,
	contextWindow: number | undefined,
	cold: boolean,
	limits: Limits,
): HandoffLevel {
	if (pressureTokens === undefined) return "none";
	const bar = cold ? limits.cold : limits.warm;
	const soft =
		contextWindow === undefined
			? bar.soft
			: Math.min(bar.soft, SOFT_WINDOW_SHARE * contextWindow);
	const strong =
		contextWindow === undefined
			? bar.strong
			: Math.min(bar.strong, STRONG_WINDOW_SHARE * contextWindow);
	if (pressureTokens >= strong) return "strong";
	return pressureTokens >= soft ? "soft" : "none";
}
