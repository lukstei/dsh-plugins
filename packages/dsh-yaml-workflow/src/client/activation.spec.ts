import { Context } from "@deepseek-ai/cordis";
import { expect, test } from "vitest";

test("workflow-runner client activation smoke test", async () => {
	let clientPlugin: unknown;
	(globalThis as unknown as { window: unknown }).window = {
		__ModuleLoader__: {
			load: ({
				factory,
			}: {
				id: string;
				factory: (require: (mod: string) => unknown) => unknown;
			}) => {
				clientPlugin = factory((mod: string) => {
					if (mod === "react") {
						return {
							createContext: () => ({ Provider: () => null }),
							useSyncExternalStore: () => undefined,
						};
					}
					if (mod === "react/jsx-runtime") {
						return {
							jsx: () => null,
							jsxs: () => null,
						};
					}
					return {};
				});
			},
		},
	};

	// @ts-expect-error Bundle output has no generated declaration file
	await import("../../dist/client.js");
	expect(clientPlugin).toBeDefined();

	const ctx = new Context();
	const registeredSlots: Array<{ name: string; key?: string }> = [];
	const listCommandViews: Array<() => unknown> = [];
	ctx.provide("slots", {
		inject: (_key: string, cb: () => void) => {
			cb();
			return () => {};
		},
		register: (def: { name: string; key?: string }, view: () => unknown) => {
			const validSlots = new Set([
				"conversation.chat.node",
				"conversation.chat.commandview",
				"conversation.input.right",
			]);
			if (!validSlots.has(def.name)) {
				throw new Error(`Undeclared slot registration: ${def.name}`);
			}
			registeredSlots.push(def);
			if (
				def.name === "conversation.chat.commandview" &&
				def.key === "wf-list"
			) {
				listCommandViews.push(view);
			}
			return () => {};
		},
	});

	ctx.provide("uiConversation", {
		events: {
			register: () => () => {},
		},
	});
	ctx.provide("conversation", {});
	ctx.provide("sessions", {});

	const fiber = ctx.plugin(clientPlugin as never, undefined as never);
	await fiber.await();

	// 2 is FiberState.ACTIVE
	expect(fiber.state).toBe(2);

	const commandViews = registeredSlots
		.filter((s) => s.name === "conversation.chat.commandview")
		.map((s) => s.key);
	expect(commandViews).toEqual([
		"wf",
		"wf-resume",
		"wf-abort",
		"wf-event",
		"wf-list",
		"wf-validate",
	]);
	expect(registeredSlots).toContainEqual({
		name: "conversation.chat.node",
		key: "wf-list",
	});
	expect(registeredSlots).toContainEqual({
		name: "conversation.chat.node",
		key: "wf-print",
	});
	expect(listCommandViews.map((view) => view())).toEqual([null]);
});
