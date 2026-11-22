import assert from "node:assert/strict";
import { test } from "node:test";
import { Context } from "@deepseek-ai/cordis";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import * as plugin from "./index.ts";

const SOURCE = "11111111-2222-3333-4444-555555555555";
const LAUNCHED = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CREATED = 1700000000000;

type Listener = () => void;

interface Change {
	readonly kind: "replace" | "append";
	readonly entries: readonly unknown[];
}

interface Harness {
	/** Sessions added as their own pane, in call order. */
	readonly panes: SessionId[];
	/** Hold or drop client scopes for `ids`, exactly as the object layer does. */
	readonly retain: (ids: readonly string[]) => void;
	readonly release: (id: string) => void;
	readonly emit: (id: string, event: SessionEvent) => void;
}

function setup(): Harness {
	const panes: SessionId[] = [];
	const listeners = new Map<string, Set<Listener>>();
	const changes = new Map<string, Change>();
	const listListeners = new Set<Listener>();
	let ids: string[] = [];

	const ctx = new Context();
	ctx.provide("splitView", {
		toggleSession: (target: SessionId) => {
			panes.push(target);
		},
	});
	ctx.provide("sessions", {
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

	return { panes, retain, release, emit };
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

test("launch adds the created session as its own split pane", () => {
	const harness = setup();
	harness.retain([SOURCE]);

	harness.emit(SOURCE, launchedEvent(LAUNCHED));

	assert.deepEqual(harness.panes, [LAUNCHED]);
});

test("only an appended launch result adds a pane", () => {
	const harness = setup();
	// `retain` replays a `replace` change for the freshly opened session.
	harness.retain([SOURCE]);
	harness.emit(SOURCE, {
		type: "user/message",
		seq: 8,
		time: CREATED,
		data: {},
	} as unknown as SessionEvent);

	assert.deepEqual(harness.panes, []);

	harness.emit(SOURCE, launchedEvent(LAUNCHED));

	assert.deepEqual(harness.panes, [LAUNCHED]);
});

test("a released session stops watching", () => {
	const harness = setup();
	harness.retain([SOURCE]);
	harness.release(SOURCE);

	harness.emit(SOURCE, launchedEvent(LAUNCHED));

	assert.deepEqual(harness.panes, []);
});
