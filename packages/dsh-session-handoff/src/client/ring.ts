import {
	Button,
	IconGaugeOutlineMedium,
	Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";
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

/** Gauge icon beside the send button once the session is big enough that `/handoff` pays off. */
export function HandoffRing({
	sessionId,
	useProjection,
	useSession,
	onHandoff,
}: Pick<SessionStandardProps, "sessionId" | "useProjection" | "useSession"> & {
	onHandoff: (sessionId: SessionStandardProps["sessionId"]) => Promise<void>;
}) {
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
	const label = `Context ${k}k tokens: ${hint}. Click to hand off (/handoff)`;
	return createElement(Tooltip, {
		label,
		side: "top",
		portal: true,
		// biome-ignore lint/correctness/noChildrenProp: Tooltip types `children` as a required prop, which createElement's 3rd argument does not satisfy
		children: createElement(Button, {
			variant: "ghost",
			size: "sm",
			"aria-label": label,
			// the icon strokes with currentColor; 28px square instead of the text-button padding
			style: { color: COLOR[level], padding: 0, width: 28 },
			icon: createElement(IconGaugeOutlineMedium, { size: 16 }),
			onClick: () => void onHandoff(sessionId),
		}),
	});
}
