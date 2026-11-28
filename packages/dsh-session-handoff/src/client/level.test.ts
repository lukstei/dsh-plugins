import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_LIMITS as L } from "../limits.ts";
import { handoffLevel } from "./level.ts";

test("warm cache: 100k soft, 150k strong", () => {
	assert.equal(handoffLevel(99_999, 1_000_000, false, L), "none");
	assert.equal(handoffLevel(100_000, 1_000_000, false, L), "soft");
	assert.equal(handoffLevel(149_999, 1_000_000, false, L), "soft");
	assert.equal(handoffLevel(150_000, 1_000_000, false, L), "strong");
});

test("cold cache lowers both bars to 70k and 100k", () => {
	assert.equal(handoffLevel(69_999, 1_000_000, true, L), "none");
	assert.equal(handoffLevel(70_000, 1_000_000, true, L), "soft");
	assert.equal(handoffLevel(100_000, 1_000_000, true, L), "strong");
});

test("a small window caps the bars at 60% and 80%", () => {
	assert.equal(handoffLevel(59_999, 100_000, false, L), "none");
	assert.equal(handoffLevel(60_000, 100_000, false, L), "soft");
	assert.equal(handoffLevel(80_000, 100_000, false, L), "strong");
});

test("no usage sample yields none; no window uses the fixed bars", () => {
	assert.equal(handoffLevel(undefined, 100_000, true, L), "none");
	assert.equal(handoffLevel(150_000, undefined, false, L), "strong");
});

test("custom limits replace the bars", () => {
	const limits = { ...L, warm: { soft: 10, strong: 20 } };
	assert.equal(handoffLevel(15, undefined, false, limits), "soft");
	assert.equal(handoffLevel(20, undefined, false, limits), "strong");
});
