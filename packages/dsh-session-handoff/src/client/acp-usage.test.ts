import assert from "node:assert/strict";
import { test } from "node:test";
import {
	currentAcpUsageReader,
	setAcpUsageReader,
	subscribeAcpUsageReader,
} from "./acp-usage.ts";

test("without the ACP adapter there is no reader", () => {
	setAcpUsageReader(undefined);
	assert.equal(currentAcpUsageReader(), undefined);
});

test("a late-mounted reader notifies subscribers, and clearing does too", async () => {
	let calls = 0;
	const off = subscribeAcpUsageReader(() => {
		calls += 1;
	});
	setAcpUsageReader(async (id) => ({ used: id.length, size: 1_000_000 }));
	const reader = currentAcpUsageReader();
	assert.ok(reader);
	assert.deepEqual(await reader("abc"), { used: 3, size: 1_000_000 });
	setAcpUsageReader(undefined);
	off();
	setAcpUsageReader(undefined);
	assert.equal(calls, 2);
});
