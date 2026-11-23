import assert from "node:assert/strict";
import { test } from "node:test";
import { handoffLevel } from "./level.ts";

test("warm cache: 70k soft, 100k strong", () => {
	assert.equal(handoffLevel(69_999, 1_000_000, false), "none");
	assert.equal(handoffLevel(70_000, 1_000_000, false), "soft");
	assert.equal(handoffLevel(99_999, 1_000_000, false), "soft");
	assert.equal(handoffLevel(100_000, 1_000_000, false), "strong");
});

test("cold cache lowers both bars to 40k and 70k", () => {
	assert.equal(handoffLevel(39_999, 1_000_000, true), "none");
	assert.equal(handoffLevel(40_000, 1_000_000, true), "soft");
	assert.equal(handoffLevel(70_000, 1_000_000, true), "strong");
});

test("a small window caps the bars at 60% and 80%", () => {
	assert.equal(handoffLevel(59_999, 100_000, false), "none");
	assert.equal(handoffLevel(60_000, 100_000, false), "soft");
	assert.equal(handoffLevel(80_000, 100_000, false), "strong");
});

test("no usage sample yields none; no window uses the fixed bars", () => {
	assert.equal(handoffLevel(undefined, 100_000, true), "none");
	assert.equal(handoffLevel(100_000, undefined, false), "strong");
});
