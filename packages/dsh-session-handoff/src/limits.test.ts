import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_LIMITS, resolveLimits } from "./limits.ts";

const route = { provider: "anthropic", model: "opus" };

test("no config yields the built-ins", () => {
	assert.deepEqual(resolveLimits({}, route), BUILTIN_LIMITS);
	assert.deepEqual(resolveLimits({}, undefined), BUILTIN_LIMITS);
});

test("model beats provider beats defaults, merged per field", () => {
	const limits = resolveLimits(
		{
			defaults: { warmSoft: 1, coldSoft: 2, cacheTtlMs: 3 },
			providers: { anthropic: { warmSoft: 10, coldStrong: 20 } },
			models: { "anthropic/opus": { warmSoft: 100 } },
		},
		route,
	);
	assert.deepEqual(limits, {
		warm: { soft: 100, strong: 150_000 },
		cold: { soft: 2, strong: 20 },
		cacheTtlMs: 3,
	});
});

test("other models ignore a different model's entry", () => {
	const limits = resolveLimits(
		{ models: { "anthropic/opus": { warmSoft: 100 } } },
		{ provider: "anthropic", model: "haiku" },
	);
	assert.equal(limits.warm.soft, BUILTIN_LIMITS.warm.soft);
});
