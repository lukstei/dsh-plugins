import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { LimitsConfig } from "../limits.ts";

const states: unknown[] = [];
let cursor = 0;

interface VNode {
	readonly type: unknown;
	readonly props: Record<string, unknown>;
}

mock.module("react", {
	namedExports: {
		createElement: (type: unknown, props: Record<string, unknown>): VNode => ({
			type,
			props,
		}),
		useState: <T>(initial: T): [T, (next: T | ((prev: T) => T)) => void] => {
			const idx = cursor++;
			if (!(idx in states)) states[idx] = initial;
			const setState = (next: T | ((prev: T) => T)): void => {
				const prev = states[idx] as T;
				states[idx] =
					typeof next === "function" ? (next as (value: T) => T)(prev) : next;
			};
			return [states[idx] as T, setState];
		},
		useEffect: (): void => {},
		useSyncExternalStore: <T>(
			_subscribe: (listener: () => void) => () => void,
			getSnapshot: () => T,
		): T => getSnapshot(),
	},
});

const ButtonMarker = Symbol("Button");
const TooltipMarker = Symbol("Tooltip");
const IconMarker = Symbol("Icon");

mock.module("@deepseek-ai/dsh-client-ui-primitives", {
	namedExports: {
		Button: ButtonMarker,
		Tooltip: TooltipMarker,
		IconGaugeOutlineMedium: IconMarker,
	},
});

const { HandoffRing } = await import("./ring.ts");

const SESSION_A = "11111111-2222-3333-4444-555555555555" as SessionId;
const SESSION_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" as SessionId;

function resetHooks(): void {
	states.length = 0;
	cursor = 0;
}

function renderRing(opts: {
	sessionId?: SessionId;
	tokens: number | undefined;
	contextWindow?: number;
	running: boolean;
	onHandoff?: (id: SessionId) => Promise<void>;
	config?: LimitsConfig;
}): VNode | null {
	cursor = 0;
	const result = HandoffRing({
		sessionId: opts.sessionId ?? SESSION_A,
		useProjection: (() => ({
			pressureTokens: opts.tokens,
			contextWindow: opts.contextWindow ?? 1_000_000,
		})) as never,
		useSession: ((selector: (session: { running: boolean }) => unknown) =>
			selector({ running: opts.running })) as never,
		onHandoff: opts.onHandoff ?? (async () => {}),
		loadRoute: async () => undefined,
		config: opts.config ?? {},
	});
	return result as unknown as VNode | null;
}

function buttonOf(tooltip: VNode): VNode {
	assert.equal(tooltip.type, TooltipMarker);
	const button = tooltip.props.children as VNode;
	assert.equal(button.type, ButtonMarker);
	return button;
}

test("HandoffRing returns null below threshold", () => {
	resetHooks();
	const node = renderRing({ tokens: 50_000, running: false });
	assert.equal(node, null);
});

test("HandoffRing renders enabled button and tooltip when idle above threshold", () => {
	resetHooks();
	const tooltip = renderRing({ tokens: 120_000, running: false });
	assert.ok(tooltip !== null);
	const button = buttonOf(tooltip);

	assert.equal(tooltip.props.disabled, false);
	assert.equal(button.props.disabled, false);
	assert.equal(button.props.title, undefined);
	assert.match(
		String(button.props["aria-label"]),
		/^Context 120k tokens: consider a fresh session\. Click to hand off \(\/handoff\)$/,
	);
});

test("HandoffRing disables button and tooltip with title fallback while running", () => {
	resetHooks();
	let calls = 0;
	const tooltip = renderRing({
		tokens: 120_000,
		running: true,
		onHandoff: async () => {
			calls += 1;
		},
	});
	assert.ok(tooltip !== null);
	const button = buttonOf(tooltip);

	assert.equal(tooltip.props.disabled, true);
	assert.equal(button.props.disabled, true);
	assert.match(
		String(button.props["aria-label"]),
		/Wait for the current turn to finish to hand off \(\/handoff\)$/,
	);
	assert.equal(button.props.title, button.props["aria-label"]);

	(button.props.onClick as () => void)();
	assert.equal(calls, 0);
});

test("HandoffRing blocks duplicate clicks while pending and recovers on rejection", async (t) => {
	resetHooks();
	const errorMock = t.mock.method(console, "error", () => {});
	let rejectHandoff!: (err: Error) => void;
	let calls = 0;
	const onHandoff = () => {
		calls += 1;
		return new Promise<void>((_resolve, reject) => {
			rejectHandoff = reject;
		});
	};

	const initial = renderRing({ tokens: 120_000, running: false, onHandoff });
	assert.ok(initial !== null);
	(buttonOf(initial).props.onClick as () => void)();

	const pendingTree = renderRing({
		tokens: 120_000,
		running: false,
		onHandoff,
	});
	assert.ok(pendingTree !== null);
	const pendingButton = buttonOf(pendingTree);
	assert.equal(pendingTree.props.disabled, true);
	assert.equal(pendingButton.props.disabled, true);
	assert.match(String(pendingButton.props["aria-label"]), /Handing off…$/);
	assert.equal(pendingButton.props.title, pendingButton.props["aria-label"]);

	(pendingButton.props.onClick as () => void)();
	assert.equal(calls, 1);

	rejectHandoff(new Error("boom"));
	await new Promise((resolve) => setImmediate(resolve));

	const recovered = renderRing({
		tokens: 120_000,
		running: false,
		onHandoff,
	});
	assert.ok(recovered !== null);
	assert.equal(recovered.props.disabled, false);
	assert.equal(buttonOf(recovered).props.disabled, false);
	const handoffErrors = errorMock.mock.calls.filter(
		(call) => call.arguments[0] === "session-handoff: handoff failed",
	);
	assert.equal(handoffErrors.length, 1);
});

test("HandoffRing scopes pending state to the clicked sessionId", async () => {
	resetHooks();
	let resolveHandoff!: () => void;
	const onHandoff = () =>
		new Promise<void>((resolve) => {
			resolveHandoff = resolve;
		});

	const treeA = renderRing({
		sessionId: SESSION_A,
		tokens: 120_000,
		running: false,
		onHandoff,
	});
	assert.ok(treeA !== null);
	(buttonOf(treeA).props.onClick as () => void)();

	const treeB = renderRing({
		sessionId: SESSION_B,
		tokens: 120_000,
		running: false,
		onHandoff,
	});
	assert.ok(treeB !== null);
	assert.equal(buttonOf(treeB).props.disabled, false);

	resolveHandoff();
	await new Promise((resolve) => setImmediate(resolve));
});

test("HandoffRing honours configured limits", () => {
	resetHooks();
	const node = renderRing({
		tokens: 50_000,
		running: false,
		config: { defaults: { warmSoft: 40_000, warmStrong: 60_000 } },
	});
	assert.ok(node !== null);
});
