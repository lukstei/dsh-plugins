import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "vitest";

test("plain Node imports the published host and Remote entries and activates the service", async () => {
	const { stdout } = await promisify(execFile)(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`
		import assert from "node:assert/strict";
		import { Context } from "@deepseek-ai/cordis";
		import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
		import * as plugin from "@lukstei/dsh-client-review-git";
		import { TYPERT } from "@lukstei/dsh-client-review-git/typert";
		import remote from "@lukstei/dsh-client-review-git/remote";
		assert.equal(plugin.name, "dsh-client-git-diff");
		assert.deepEqual(plugin.inject, ["sessionController", "workingDirectory", "sessions", "sessionPersistence"]);
		const ctx = new Context();
		for (const name of plugin.inject) ctx.provide(name, {});
		ctx.provide("tools", { register: () => () => {} });
		const fiber = ctx.plugin({ apply: plugin.apply });
		await fiber.await();
		assert.equal(ctx.workspaceReview.typertRemote.serviceKey, "workspaceReview");
		assert.deepEqual(remoteMethods(ctx.workspaceReview).map(method => method.method).sort(), ["catalog", "commits", "file", "resolve", "view"]);
		assert.equal(TYPERT.invocations.length, 5);
		assert.equal(remote.descriptors.length, 5);
		await fiber.dispose();
		console.log("host load passed");
	`,
		],
		{
			cwd: fileURLToPath(new URL("../", import.meta.url)),
			env: { ...process.env, NODE_OPTIONS: "" },
		},
	);
	assert.equal(stdout.trim(), "host load passed");
});
