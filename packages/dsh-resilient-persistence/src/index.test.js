import assert from "node:assert/strict";
import test from "node:test";
import { apply, inject, name } from "./index.ts";

test("metadata exports", () => {
	assert.equal(name, "resilient-session-persistence");
	assert.deepEqual(inject, ["sessionPersistence"]);
});

test("resilient-session-persistence filters out corrupt sessions during list()", async () => {
	let openCalls = 0;
	const originalList = async () => [
		{ header: { id: "session-good" }, revision: "rev-1" },
		{ header: { id: "session-corrupt" }, revision: "rev-corrupt" },
	];
	const mockPersistence = {
		list: originalList,
		open: async (id) => {
			openCalls++;
			if (id === "session-corrupt") {
				throw new Error("corrupt session log");
			}
			return {
				header: { id },
				close: async () => {},
			};
		},
	};

	let disposeEffect;
	const mockCtx = {
		sessionPersistence: mockPersistence,
		logger: {
			warn: () => {},
		},
		effect: (cb) => {
			disposeEffect = cb();
			return disposeEffect;
		},
	};

	apply(mockCtx);

	// First list(): validates both sessions, filters out corrupt
	const firstList = await mockCtx.sessionPersistence.list();
	assert.equal(firstList.length, 1);
	assert.equal(firstList[0].header.id, "session-good");
	assert.equal(openCalls, 2);

	// Second list(): uses cached revisions, does not re-open
	const secondList = await mockCtx.sessionPersistence.list();
	assert.equal(secondList.length, 1);
	assert.equal(secondList[0].header.id, "session-good");
	assert.equal(openCalls, 2);

	// Effect disposal restores original list
	assert.equal(typeof disposeEffect, "function");
	disposeEffect();
	assert.equal(mockCtx.sessionPersistence.list, originalList);
});
