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
}

function setup(): Harness {
	const replaced: { oldId: SessionId; newId: SessionId }[] = [];
	const commands: { id: string; line: string }[] = [];
	const listeners = new Map<string, Set<Listener>>();
	const changes = new Map<string, Change>();
	const listListeners = new Set<Listener>();
	let ids: string[] = [];

	const ctx = new Context();
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

	return { replaced, commands, retain, release, emit };
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
