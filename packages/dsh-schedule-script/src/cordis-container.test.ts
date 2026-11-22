import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { test } from "vitest";
import * as clientPlugin from "./client.tsx";
import * as plugin from "./index.ts";

test("plugin validates required service injections without missing property access errors", () => {
	assert.ok(Array.isArray(plugin.inject), "plugin must export inject array");
	assert.ok(plugin.inject.includes("commands"));
	assert.ok(plugin.inject.includes("sessionProjections"));
	assert.ok(plugin.inject.includes("tools"));
	assert.ok(plugin.inject.includes("skills"));
	assert.ok(plugin.inject.includes("schedule"));

	const ctx = new Context();

	// Provide mock services declared in inject
	ctx.provide("commands", { execute: async () => {} });
	ctx.provide("sessionProjections", {
		register: async () => ({
			stateOf: () => plugin.initialScheduleScriptSummary(),
			dispose: async () => {},
		}),
	});
	ctx.provide("tools", { register: () => {} });
	ctx.provide("skills", { register: () => () => {} });
	ctx.provide("schedule", {
		create: async () => {},
		list: async () => ({
			items: [],
			shown: 0,
			total: 0,
			limit: 100,
			offset: 0,
		}),
		edit: async () => {},
	});

	// Verify plugin loads without throwing Cordis inject error
	assert.doesNotThrow(() => {
		ctx.plugin(plugin);
	});
});

test("client plugin is a valid cordis plugin with apply and inject", async () => {
	assert.equal(typeof clientPlugin.apply, "function");
	assert.ok(Array.isArray(clientPlugin.inject));
	assert.ok(clientPlugin.inject.includes("slots"));

	const ctx = new Context();
	const registeredSlots = new Map<string, unknown>();
	ctx.provide("remote.schedule", {});
	ctx.provide("remote", {
		schedule: { catalog: async () => ({ ok: true, value: [] }) },
		$on: () => () => {},
	});
	ctx.provide("slots", {
		inject: (_slot: string, cb: () => void) => cb(),
		register: (
			spec: { name: string; [key: string]: unknown },
			comp: unknown,
		) => {
			registeredSlots.set(spec.name, comp);
		},
	});

	const fiber = ctx.plugin(clientPlugin);
	await fiber.await();

	assert.equal(
		typeof registeredSlots.get("conversation.input.left"),
		"function",
	);
	assert.equal(
		registeredSlots.get("conversation.chat.commandview"),
		clientPlugin.ScheduleScriptCommandCard,
	);
});

test("conversation.input.left slot registration injects sessionId and remote", async () => {
	const ctx = new Context();
	let capturedSpec:
		| {
				name: string;
				order?: number;
				inject?: (id: string) => { sessionId: string; ctx: unknown };
		  }
		| undefined;
	ctx.provide("remote.schedule", {});
	ctx.provide("remote", {
		schedule: { catalog: async () => ({ ok: true, value: [] }) },
		$on: () => () => {},
	});
	ctx.provide("slots", {
		inject: (_slot: string, cb: () => void) => cb(),
		register: (spec: {
			name: string;
			order?: number;
			inject?: (id: string) => { sessionId: string; ctx: unknown };
		}) => {
			if (spec.name === "conversation.input.left") {
				capturedSpec = spec;
			}
		},
	});

	const fiber = ctx.plugin(clientPlugin);
	await fiber.await();

	assert.ok(capturedSpec);
	assert.ok(capturedSpec.inject);
	assert.equal(capturedSpec.order, 85);
	assert.equal(typeof capturedSpec.inject, "function");
	const injected = capturedSpec.inject("session-xyz");
	assert.equal(injected.sessionId, "session-xyz");
	assert.ok(injected.ctx);
});
