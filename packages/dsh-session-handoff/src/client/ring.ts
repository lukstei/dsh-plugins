import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type { SessionStandardProps } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-token-meter/client";
import {
	createElement,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";
import {
	type AcpUsage,
	currentAcpUsageReader,
	subscribeAcpUsageReader,
} from "./acp-usage.ts";
import { CACHE_TTL_MS, handoffLevel } from "./level.ts";

const COLOR = { soft: "#d9a400", strong: "#d62839" } as const;

/** Small ring beside the send button once the session is big enough that `/handoff` pays off. */
export function HandoffRing({
	sessionId,
	useProjection,
	useSession,
}: Pick<SessionStandardProps, "sessionId" | "useProjection" | "useSession">) {
	const pressure = useProjection("contextPressure");
	const running = useSession((session) => session.running);
	const [acp, setAcp] = useState<AcpUsage | undefined>(undefined);
	const [cold, setCold] = useState(false);

	// ACP agents report occupancy to the adapter, never to DSH's `contextPressure`; read it
	// when a turn settles. The reader is unset (so this is a no-op) without the adapter.
	const readUsage = useSyncExternalStore(
		subscribeAcpUsageReader,
		currentAcpUsageReader,
	);
	useEffect(() => {
		if (running || readUsage === undefined) return;
		let live = true;
		void readUsage(sessionId).then((usage) => {
			if (live) setAcp(usage);
		});
		return () => {
			live = false;
		};
	}, [sessionId, running, readUsage]);

	const tokens =
		pressure !== undefined && pressure.pressureTokens !== undefined
			? pressure.pressureTokens
			: acp?.used;
	const window =
		pressure !== undefined && pressure.contextWindow !== undefined
			? pressure.contextWindow
			: acp?.size;

	// A new usage sample or a running turn means the cache was just touched; once idle for
	// the TTL it is cold. Mount counts as warm because the last request time is unknown.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `tokens` is the restart trigger
	useEffect(() => {
		setCold(false);
		if (running) return;
		const timer = setTimeout(() => setCold(true), CACHE_TTL_MS);
		return () => clearTimeout(timer);
	}, [tokens, running]);

	const level = handoffLevel(tokens, window, cold);
	if (level === "none" || tokens === undefined) return null;
	const k = Math.round(tokens / 1000);
	const hint = cold
		? "cache is cold, a fresh session is cheaper now"
		: "consider a fresh session";
	return createElement("span", {
		role: "img",
		title: `Context ${k}k tokens: ${hint} (/handoff)`,
		"aria-label": `Handoff ${level === "strong" ? "recommended" : "suggested"}`,
		style: {
			width: 14,
			height: 14,
			boxSizing: "border-box",
			borderRadius: "50%",
			border: `2px solid ${COLOR[level]}`,
			flex: "none",
		},
	});
}
