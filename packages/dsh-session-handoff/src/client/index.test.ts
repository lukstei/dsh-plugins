import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { Context } from "@deepseek-ai/cordis";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { SessionId } from "@deepseek-ai/dsh-session/types";

// smell: the real primitives package imports `.css`, which Node's loader rejects
mock.module("@deepseek-ai/dsh-client-ui-primitives", {
	namedExports: {
		Button: () => null,
		Tooltip: () => null,
		IconGaugeOutlineMedium: () => null,
	},
});
const plugin = await import("./index.ts");

const SOURCE = "11111111-2222-3333-4444-555555555555";
const LAUNCHED = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CREATED = 1700000000000;

type Listener = () => void;

interface Change {
	readonly kind: "replace" | "append";
	readonly entries: readonly unknown[];
}

interface Harness {
	/** Sessions replaced as panes, in call order. */
	readonly replaced: { oldId: SessionId; newId: SessionId }[];
	/** Raw command lines sent per session. */
	readonly commands: { id: string; line: string }[];
	/** Hold or drop client scopes for `ids`, exactly as the object layer does. */
	readonly retain: (ids: readonly string[]) => void;
	readonly release: (id: string) => void;
	readonly emit: (id: string, event: SessionEvent) => void;
	/** Decorations hung on host commands through `commandUi.decorate`. */
	readonly decorations: {
		name: string;
		ui: {
			options: (session: { sessionId: string }) => Promise<unknown>;
			onSelect: (
				option: { id: string },
				session: { sessionId: string },
			) => Promise<void>;
		};
	}[];
}

function setup(
	current: unknown = { provider: "google", model: "gemini-4" },
): Harness {
	const replaced: { oldId: SessionId; newId: SessionId }[] = [];
	const commands: { id: string; line: string }[] = [];
	const listeners = new Map<string, Set<Listener>>();
	const changes = new Map<string, Change>();
	const listListeners = new Set<Listener>();
	let ids: string[] = [];

	const decorations: Harness["decorations"] = [];

	const ctx = new Context();
	ctx.provide("commandUi", {
		decorate: (decoration: Harness["decorations"][number]) => {
			decorations.push(decoration);
			return () => {};
		},
	});
	ctx.provide("modelDirectories", {
		directoryFor: () => ({
			load: async () => ({
				current,
				groups: [
					{
						id: "google",
						name: "Google",
						models: [{ id: "gemini-4", name: "Gemini 4" }],
					},
					{
						id: "openrouter",
						name: "OpenRouter",
						models: [{ id: "baidu/ernie", name: "Ernie" }],
					},
				],
			}),
		}),
	});
	ctx.provide("slots", {
		inject: () => () => {},
		register: () => () => {},
	});
	ctx.provide("splitView", {
		replaceSession: (oldId: SessionId, newId: SessionId) => {
			replaced.push({ oldId, newId });
		},
	});
	ctx.provide("sessions", {
		using: async (
			id: string,
			_options: unknown,
			run: (reference: unknown) => Promise<void>,
		) => {
			await run({
				binding: {
					session: {
						command: async (line: string) => {
							commands.push({ id, line });
							return { ok: true };
						},
					},
				},
			});
		},
		list: {
			getSnapshot: () => ({ ids, byId: {} }),
			subscribe: (listener: Listener) => {
				listListeners.add(listener);
				return () => {
					listListeners.delete(listener);
				};
			},
		},
		binding: (id: string) => {
			const set = listeners.get(id);
			if (set === undefined) return undefined;
			return {
				eventSource: {
					getSnapshot: () => ({ change: changes.get(id) }),
					subscribe: (listener: Listener) => {
						set.add(listener);
						return () => {
							set.delete(listener);
						};
					},
				},
			};
		},
	});
	plugin.apply(ctx);

	const sync = (): void => {
		for (const listener of listListeners) listener();
	};
	const retain = (next: readonly string[]): void => {
		ids = [...next];
		for (const id of ids) {
			if (listeners.has(id)) continue;
			listeners.set(id, new Set());
			changes.set(id, { kind: "replace", entries: [] });
		}
		sync();
	};
	const release = (id: string): void => {
		listeners.delete(id);
		changes.delete(id);
		ids = ids.filter((candidate) => candidate !== id);
		sync();
	};
	const emit = (id: string, event: SessionEvent): void => {
		const set = listeners.get(id);
		changes.set(id, {
			kind: "append",
			entries: [{ type: "event", event }],
		});
		if (set === undefined) return;
		for (const listener of set) listener();
	};

	return { replaced, commands, retain, release, emit, decorations };
}

const launchedEvent = (id: string): SessionEvent =>
	({
		type: "command/done",
		seq: 7,
		time: CREATED,
		data: {
			commandId: "handoff",
			kind: "success",
			text: `Handoff launched: ${id}`,
		},
	}) as unknown as SessionEvent;

test("launch replaces the source session with the launched session in split view", () => {
	const harness = setup();
	harness.retain([SOURCE]);

	harness.emit(SOURCE, launchedEvent(LAUNCHED));

	assert.deepEqual(harness.replaced, [{ oldId: SOURCE, newId: LAUNCHED }]);
});

test("launch marks the source done in Kanban", async () => {
	const harness = setup();
	harness.retain([SOURCE]);

	harness.emit(SOURCE, launchedEvent(LAUNCHED));
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(harness.commands.length, 1);
	assert.equal(harness.commands[0].id, SOURCE);
	assert.match(
		harness.commands[0].line,
		/^\/kanban \{"action":"done","doneAt":\d+\}$/,
	);
});

test("only an appended launch result replaces the pane", () => {
	const harness = setup();
	// `retain` replays a `replace` change for the freshly opened session.
	harness.retain([SOURCE]);
	harness.emit(SOURCE, {
		type: "user/message",
		seq: 8,
		time: CREATED,
		data: {},
	} as unknown as SessionEvent);

	assert.deepEqual(harness.replaced, []);

	harness.emit(SOURCE, launchedEvent(LAUNCHED));

	assert.deepEqual(harness.replaced, [{ oldId: SOURCE, newId: LAUNCHED }]);
});

test("a released session stops watching", () => {
	const harness = setup();
	harness.retain([SOURCE]);
	harness.release(SOURCE);

	harness.emit(SOURCE, launchedEvent(LAUNCHED));

	assert.deepEqual(harness.replaced, []);
});

test("a bare /handoff lists the catalog and submits the pick as an argued line", async () => {
	const harness = setup();
	const [decoration] = harness.decorations;
	const session = { sessionId: SOURCE };

	assert.equal(decoration.name, "handoff");
	assert.deepEqual(await decoration.ui.options(session), [
		{
			id: "google/gemini-4",
			label: "Gemini 4",
			group: { name: "google", label: "Google" },
			active: true,
		},
		{
			id: "openrouter/baidu/ernie",
			label: "Ernie",
			group: { name: "openrouter", label: "OpenRouter" },
		},
	]);

	await decoration.ui.onSelect({ id: "openrouter/baidu/ernie" }, session);

	assert.deepEqual(harness.commands, [
		{ id: SOURCE, line: "/handoff openrouter/baidu/ernie" },
	]);
});

test("without a current model no picker row is marked active", async () => {
	const harness = setup(null);
	const [decoration] = harness.decorations;

	const options = await decoration.ui.options({ sessionId: SOURCE });

	assert.equal(JSON.stringify(options).includes("active"), false);
});
