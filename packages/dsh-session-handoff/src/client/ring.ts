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
import { type LimitsConfig, resolveLimits } from "../limits.ts";
import {
	type AcpUsage,
	currentAcpUsageReader,
	subscribeAcpUsageReader,
} from "./acp-usage.ts";
import { handoffLevel } from "./level.ts";

const COLOR = { soft: "#d9a400", strong: "#d62839" } as const;

/** Gauge icon beside the send button once the session is big enough that `/handoff` pays off. */
export function HandoffRing({
	sessionId,
	useProjection,
	useSession,
	onHandoff,
	loadRoute,
	config,
}: Pick<SessionStandardProps, "sessionId" | "useProjection" | "useSession"> & {
	onHandoff: (sessionId: SessionStandardProps["sessionId"]) => Promise<void>;
	/** The session's current provider and model, which select its limits. */
	loadRoute: (
		sessionId: SessionStandardProps["sessionId"],
	) => Promise<{ provider: string; model: string } | undefined>;
	config: LimitsConfig;
}) {
	const pressure = useProjection("contextPressure");
	const running = useSession((session) => session.running);
	const [acp, setAcp] = useState<AcpUsage | undefined>(undefined);
	const [route, setRoute] = useState<
		{ provider: string; model: string } | undefined
	>(undefined);
	const [cold, setCold] = useState(false);
	const [pendingSession, setPendingSession] = useState<
		SessionStandardProps["sessionId"] | undefined
	>(undefined);

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

	// The model can change between turns, so re-read it whenever a turn settles.
	useEffect(() => {
		if (running) return;
		let live = true;
		void loadRoute(sessionId)
			.then((current) => {
				if (live) setRoute(current);
			})
			.catch(() => {
				// edge case: addressed subagent sessions or transient catalog errors keep built-in limits.
			});
		return () => {
			live = false;
		};
	}, [sessionId, running, loadRoute]);
	const limits = resolveLimits(config, route);

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
		const timer = setTimeout(() => setCold(true), limits.cacheTtlMs);
		return () => clearTimeout(timer);
	}, [tokens, running, limits.cacheTtlMs]);

	const level = handoffLevel(tokens, window, cold, limits);
	if (level === "none" || tokens === undefined) return null;
	const k = Math.round(tokens / 1000);
	const pending = pendingSession === sessionId;
	const isDisabled = running || pending;
	const startHandoff = async (): Promise<void> => {
		if (isDisabled) return;
		setPendingSession(sessionId);
		try {
			await onHandoff(sessionId);
		} catch (error: unknown) {
			console.error("session-handoff: handoff failed", error);
		} finally {
			setPendingSession((current) =>
				current === sessionId ? undefined : current,
			);
		}
	};
	const hint = cold
		? "cache is cold, a fresh session is cheaper now"
		: "consider a fresh session";
	const action = pending
		? "Handing off…"
		: running
			? "Wait for the current turn to finish to hand off (/handoff)"
			: "Click to hand off (/handoff)";
	const label = `Context ${k}k tokens: ${hint}. ${action}`;
	return createElement(Tooltip, {
		label,
		side: "top",
		portal: true,
		// Disabled native buttons omit mouseleave, so close Tooltip from state.
		disabled: isDisabled,
		// biome-ignore lint/correctness/noChildrenProp: Tooltip types `children` as a required prop, which createElement's 3rd argument does not satisfy
		children: createElement(Button, {
			variant: "ghost",
			size: "sm",
			disabled: isDisabled,
			title: isDisabled ? label : undefined,
			"aria-label": label,
			// the icon strokes with currentColor; 28px square instead of the text-button padding
			style: { color: COLOR[level], padding: 0, width: 28 },
			icon: createElement(IconGaugeOutlineMedium, { size: 16 }),
			onClick: () => void startHandoff(),
		}),
	});
}
