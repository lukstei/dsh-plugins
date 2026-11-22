import assert from "node:assert/strict";
import test from "node:test";
import { apply, inject, name, serializeEventsToJsonl } from "./index.ts";

test("plugin metadata", () => {
	assert.equal(name, "debug");
	assert.deepEqual(inject, ["commands"]);
});

test("serializeEventsToJsonl handles empty and populated lists", () => {
	assert.equal(serializeEventsToJsonl([]), "");

	const events = [
		{ seq: 0, type: "turn/start", time: 1000, data: { turn: 1 } },
		{
			seq: 1,
			type: "user/message",
			time: 1001,
			data: { role: "user", content: [] },
		},
	];
	const jsonl = serializeEventsToJsonl(events);
	const lines = jsonl.trim().split("\n");
	assert.equal(lines.length, 2);
	assert.deepEqual(JSON.parse(lines[0]), events[0]);
	assert.deepEqual(JSON.parse(lines[1]), events[1]);
});

test("apply registers /copy-transcript command and executes successfully", async () => {
	const registeredDefinitions = [];
	const mockCtx = {
		commands: {
			register(definition) {
				registeredDefinitions.push(definition);
			},
		},
	};

	let copiedText = "";
	apply(mockCtx, {
		copy: async (text) => {
			copiedText = text;
		},
	});

	assert.deepEqual(
		registeredDefinitions.map((definition) => definition.name),
		["copy-transcript", "copy-session-id"],
	);
	const registeredDefinition = registeredDefinitions.find(
		(definition) => definition.name === "copy-transcript",
	);
	assert.ok(registeredDefinition, "command must be registered");

	const events = [
		{ seq: 0, type: "turn/start", time: 1000, data: { turn: 1 } },
	];
	const mockInvocation = {
		agent: {
			session: {
				snapshotEvents() {
					return events;
				},
			},
		},
	};

	const result = await registeredDefinition.handler(mockInvocation);
	assert.deepEqual(result, {
		kind: "success",
		text: "Copied 1 session events to clipboard",
	});
	assert.equal(copiedText, `${JSON.stringify(events[0])}\n`);
});

test("handler returns error when session has no events", async () => {
	const registeredDefinitions = [];
	const mockCtx = {
		commands: {
			register(definition) {
				registeredDefinitions.push(definition);
			},
		},
	};

	let copyCalled = false;
	apply(mockCtx, {
		copy: async () => {
			copyCalled = true;
		},
	});

	const registeredDefinition = registeredDefinitions.find(
		(definition) => definition.name === "copy-transcript",
	);

	const mockInvocation = {
		agent: {
			session: {
				snapshotEvents() {
					return [];
				},
			},
		},
	};

	const result = await registeredDefinition.handler(mockInvocation);
	assert.deepEqual(result, {
		kind: "error",
		text: "Session contains no events to copy",
	});
	assert.equal(copyCalled, false);
});

test("handler returns error when copy operation fails", async () => {
	const registeredDefinitions = [];
	const mockCtx = {
		commands: {
			register(definition) {
				registeredDefinitions.push(definition);
			},
		},
	};

	apply(mockCtx, {
		copy: async () => {
			throw new Error("clipboard process failure");
		},
	});

	const registeredDefinition = registeredDefinitions.find(
		(definition) => definition.name === "copy-transcript",
	);

	const mockInvocation = {
		agent: {
			session: {
				snapshotEvents() {
					return [
						{ seq: 0, type: "turn/start", time: 1000, data: { turn: 1 } },
					];
				},
			},
		},
	};

	const result = await registeredDefinition.handler(mockInvocation);
	assert.deepEqual(result, {
		kind: "error",
		text: "Failed to copy transcript: clipboard process failure",
	});
});

test("apply registers /copy-session-id command and copies the session id", async () => {
	const registeredDefinitions = [];
	const mockCtx = {
		commands: {
			register(definition) {
				registeredDefinitions.push(definition);
			},
		},
	};

	let copiedText = "";
	apply(mockCtx, {
		copy: async (text) => {
			copiedText = text;
		},
	});

	const registeredDefinition = registeredDefinitions.find(
		(definition) => definition.name === "copy-session-id",
	);
	assert.ok(registeredDefinition, "command must be registered");

	const mockInvocation = {
		agent: {
			session: {
				id: "session-abc",
			},
		},
	};

	const result = await registeredDefinition.handler(mockInvocation);
	assert.deepEqual(result, {
		kind: "success",
		text: "Copied session ID to clipboard",
	});
	assert.equal(copiedText, "session-abc");
});

test("copy-session-id returns error when copy operation fails", async () => {
	const registeredDefinitions = [];
	const mockCtx = {
		commands: {
			register(definition) {
				registeredDefinitions.push(definition);
			},
		},
	};

	apply(mockCtx, {
		copy: async () => {
			throw new Error("clipboard process failure");
		},
	});

	const registeredDefinition = registeredDefinitions.find(
		(definition) => definition.name === "copy-session-id",
	);

	const mockInvocation = {
		agent: {
			session: {
				id: "session-abc",
			},
		},
	};

	const result = await registeredDefinition.handler(mockInvocation);
	assert.deepEqual(result, {
		kind: "error",
		text: "Failed to copy session ID: clipboard process failure",
	});
});
