export type HandoffLevel = "none" | "soft" | "strong";

/** Anthropic prompt-cache TTL: past this idle gap the next turn re-writes the whole context. */
export const CACHE_TTL_MS = 5 * 60_000;

// Absolute prompt sizes, tuned by cost: a fresh session starts near 18k tokens, so a handoff
// pays back sooner the more context a turn re-sends. A cold cache lowers both bars.
const WARM = { soft: 100_000, strong: 150_000 };
const COLD = { soft: 70_000, strong: 100_000 };
// The window still caps the bars, so small-window models warn before compaction does.
const SOFT_WINDOW_SHARE = 0.6;
const STRONG_WINDOW_SHARE = 0.8;

export function handoffLevel(
	pressureTokens: number | undefined,
	contextWindow: number | undefined,
	cold: boolean,
): HandoffLevel {
	if (pressureTokens === undefined) return "none";
	const bar = cold ? COLD : WARM;
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
