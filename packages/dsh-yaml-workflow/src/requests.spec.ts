import assert from "node:assert/strict";
import { expect, test, vi } from "vitest";
import { WorkflowTestRunner } from "./e2e/test-runner.ts";
import { foldWorkflowState } from "./fold.ts";
import { nextWorkflowRequest } from "./requests.ts";
import {
	discardWorkflow,
	drainWorkflowRequests,
	executeWorkflow,
	requestWorkflow,
	resumeWorkflow,
	startPendingWorkflows,
} from "./runner.ts";

function begin(runner: WorkflowTestRunner, runId: string): void {
	runner.events.push({
		type: "command/run",
		data: { commandId: runId, name: "wf", args: `${runId}.yaml` },
	});
}

function settle(runner: WorkflowTestRunner, runId: string): void {
	runner.events.push({
		type: "command/done",
		data: { commandId: runId, kind: "success" },
	});
}

function trackStops(runner: WorkflowTestRunner) {
	const listeners = new Set<AbortController>();
	runner.watchAbort = (controller) => {
		listeners.add(controller);
		return () => {
			assert.equal(listeners.delete(controller), true);
		};
	};
	return {
		listeners,
		stop() {
			for (const controller of listeners) controller.abort({ kind: "pause" });
		},
	};
}

test.each(["idle", "reload"] as const)(
	"Stop during %s pauses the FIFO head before dispatch and leaves later work pending",
	async (phase) => {
		const runner = new WorkflowTestRunner({
			sessionId: `startup-stop-${phase}`,
		});
		runner.registerWorkflow(
			"first.yaml",
			"steps:\n  - prompt: first\n  - print: first finished",
		);
		runner.registerWorkflow("second.yaml", "steps:\n  - print: second");
		for (const runId of ["first", "second"]) {
			begin(runner, runId);
			await requestWorkflow(`${runId}.yaml`, runner, runId);
			settle(runner, runId);
		}
		const { listeners, stop } = trackStops(runner);
		const reloading = Promise.withResolvers<void>();
		const releaseReload = Promise.withResolvers<void>();
		if (phase === "idle") runner.busy = true;
		else {
			const read = runner.readWorkflow.bind(runner);
			runner.readWorkflow = async (target) => {
				if (target === "first.yaml") {
					reloading.resolve();
					await releaseReload.promise;
				}
				return read(target);
			};
		}
		const execution = drainWorkflowRequests(runner);
		if (phase === "reload") await reloading.promise;
		stop();
		if (phase === "idle") runner.resolveIdle();
		else releaseReload.resolve();
		await execution;
		const first = foldWorkflowState(runner.events, "first");
		assert.ok(first);
		assert.equal(first.state.status, "paused");
		assert.equal(first.state.pauseReason, "interrupted");
		assert.equal(first.state.stepIndex, 0);
		assert.deepEqual(
			[
				runner.dispatchedPrompts.length,
				runner.dispatchedSubagents.length,
				runner.printedTexts,
			],
			[0, 0, []],
		);
		assert.equal(nextWorkflowRequest(runner.events)?.runId, "second");
		assert.equal(listeners.size, 0);
		stop();
		await resumeWorkflow({ effects: runner });
		await vi.waitFor(() =>
			assert.equal(
				foldWorkflowState(runner.events, "second")?.state.status,
				"completed",
			),
		);
		assert.deepEqual(runner.printedTexts, ["first finished", "second"]);
		assert.equal(listeners.size, 0);
	},
);

test.each(["idle", "reload", "notification"] as const)(
	"startup Stop observation is disposed when %s fails",
	async (phase) => {
		const runner = new WorkflowTestRunner({
			sessionId: `startup-failure-${phase}`,
		});
		runner.registerWorkflow("first.yaml", "steps:\n  - print: first");
		begin(runner, "first");
		await requestWorkflow("first.yaml", runner, "first");
		settle(runner, "first");
		const { listeners } = trackStops(runner);
		if (phase === "idle")
			runner.whenIdle = async () => {
				throw new Error("idle failed");
			};
		else runner.writeFile("first.yaml", "steps: []");
		if (phase === "notification")
			runner.emit = () => {
				throw new Error("notification failed");
			};
		const execution = drainWorkflowRequests(runner);
		if (phase === "notification")
			await assert.rejects(execution, /notification failed/);
		else await execution;
		assert.equal(listeners.size, 0);
		assert.equal(runner.getLatestRun(), null);
		assert.deepEqual(runner.printedTexts, []);
	},
);

test("requests validate immediately while a workflow is paused and contain no YAML", async () => {
	const runner = new WorkflowTestRunner();
	runner.registerWorkflow(
		"active.yaml",
		"steps:\n  - prompt: work\n    gate: approve",
	);
	runner.registerWorkflow("next.yaml", "steps:\n  - print: next");
	await executeWorkflow({
		effects: runner,
		targetPath: "active.yaml",
		runId: "active",
	});
	const active = runner.getLatestRun();
	const invalid = await requestWorkflow("missing.yaml", runner, "missing");
	assert.equal(invalid.kind, "error");
	assert.match(invalid.text, /not found/);
	begin(runner, "next");
	const accepted = await requestWorkflow("next.yaml", runner, "next");
	settle(runner, "next");
	await drainWorkflowRequests(runner);
	assert.deepEqual(runner.getLatestRun(), active);
	assert.deepEqual(runner.printedTexts, []);
	const requests = runner.events.flatMap((event) => {
		if (event.type !== "command/run") return [];
		const data = event.data as { name: string; args: string };
		if (data.name !== "wf-event") return [];
		const payload: { action: string } = JSON.parse(data.args);
		return payload.action === "request" ? [payload] : [];
	});
	expect({ accepted, requests }).toMatchInlineSnapshot(`
		{
		  "accepted": {
		    "kind": "success",
		    "text": "Workflow queued",
		  },
		  "requests": [
		    {
		      "action": "request",
		      "rawInput": "next.yaml",
		      "runId": "next",
		      "sessionId": "test-session",
		    },
		  ],
		}
	`);
});

test("FIFO uses command arrival even when validation settles in reverse order", async () => {
	const runner = new WorkflowTestRunner();
	runner.registerWorkflow("first.yaml", "steps:\n  - print: first");
	runner.registerWorkflow("second.yaml", "steps:\n  - print: second");
	const release = Promise.withResolvers<void>();
	const read = runner.readWorkflow.bind(runner);
	let delayed = true;
	runner.readWorkflow = async (target) => {
		if (target === "first.yaml" && delayed) {
			delayed = false;
			await release.promise;
		}
		return read(target);
	};
	begin(runner, "first");
	const first = requestWorkflow("first.yaml", runner, "first");
	begin(runner, "second");
	await requestWorkflow("second.yaml", runner, "second");
	settle(runner, "second");
	await drainWorkflowRequests(runner);
	assert.deepEqual(runner.printedTexts, []);
	release.resolve();
	await first;
	settle(runner, "first");
	await Promise.all([
		drainWorkflowRequests(runner),
		drainWorkflowRequests(runner),
	]);
	assert.deepEqual(runner.printedTexts, ["first", "second"]);
});

test("queued files reload and invalid edits fail visibly without blocking later requests", async () => {
	const runner = new WorkflowTestRunner();
	runner.registerWorkflow("bad.yaml", "steps:\n  - print: before");
	runner.registerWorkflow("good.yaml", "steps:\n  - print: before");
	for (const runId of ["bad", "good"]) {
		begin(runner, runId);
		await requestWorkflow(`${runId}.yaml`, runner, runId);
		settle(runner, runId);
	}
	runner.writeFile("bad.yaml", "steps: []");
	runner.writeFile("good.yaml", "steps:\n  - print: after");
	await drainWorkflowRequests(runner);
	assert.deepEqual(runner.printedTexts, ["after"]);
	assert.equal(foldWorkflowState(runner.events, "bad"), null);
	assert.equal(
		foldWorkflowState(runner.events, "good")?.state.status,
		"completed",
	);
	expect(
		runner.events.filter((event) => {
			if (event.type !== "command/run") return false;
			const data = event.data as { name: string; args: string };
			return (
				data.name === "wf-event" &&
				data.args.includes('"action":"request-failed"')
			);
		}),
	).toMatchInlineSnapshot(`
		[
		  {
		    "data": {
		      "args": "{"action":"request-failed","runId":"bad","sessionId":"test-session"}",
		      "commandId": "wf-request-failed-8",
		      "name": "wf-event",
		      "source": {
		        "kind": "user",
		      },
		    },
		    "type": "command/run",
		  },
		]
	`);
	await drainWorkflowRequests(runner);
	assert.deepEqual(runner.printedTexts, ["after"]);
});

test.each(["complete", "failure", "resume", "discard", "interrupt"] as const)(
	"%s hands pending work off only after runner cleanup",
	async (ending) => {
		const runner = new WorkflowTestRunner({ sessionId: `handoff-${ending}` });
		const gate =
			ending === "resume" || ending === "discard" ? "\n    gate: approve" : "";
		runner.registerWorkflow("active.yaml", `steps:\n  - prompt: work${gate}`);
		runner.registerWorkflow("next.yaml", "steps:\n  - print: next");
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const finished = Promise.withResolvers<void>();
		let cleaned = false;
		let watches = 0;
		const watchAbort = runner.watchAbort.bind(runner);
		runner.watchAbort = (controller) => {
			if (watches++ > 0) assert.equal(cleaned, true);
			cleaned = false;
			const dispose = watchAbort(controller);
			return () => {
				dispose();
				cleaned = true;
			};
		};
		runner.onPrompt = async () => {
			started.resolve();
			await release.promise;
			if (ending === "failure") throw new Error("step failed");
			if (ending === "interrupt")
				runner.abortController.abort({ kind: "pause" });
		};
		const emit = runner.emit.bind(runner);
		runner.emit = (event) => {
			if (event.action !== "print") {
				emit(event);
				return;
			}
			assert.equal(cleaned, false);
			assert.equal(
				foldWorkflowState(runner.events, "active")?.state.status === "running",
				false,
			);
			emit(event);
			finished.resolve();
		};
		const execution = executeWorkflow({
			effects: runner,
			targetPath: "active.yaml",
			runId: "active",
		});
		await started.promise;
		begin(runner, "next");
		await requestWorkflow("next.yaml", runner, "next");
		settle(runner, "next");
		await drainWorkflowRequests(runner);
		assert.deepEqual(runner.printedTexts, []);
		assert.equal(
			(await requestWorkflow("missing.yaml", runner, "invalid")).kind,
			"error",
		);
		release.resolve();
		await execution;
		if (ending === "resume" || ending === "discard" || ending === "interrupt") {
			await drainWorkflowRequests(runner);
			assert.deepEqual(runner.printedTexts, []);
			assert.equal(cleaned, true);
			if (ending === "resume") await resumeWorkflow({ effects: runner });
			else {
				runner.resetAbortController();
				await discardWorkflow({ effects: runner });
			}
		}
		await finished.promise;
		await vi.waitFor(() =>
			assert.equal(runner.getLatestRun()?.state.status, "completed"),
		);
		assert.deepEqual(runner.printedTexts, ["next"]);
	},
);

test("a rejected earlier validation does not strand a later accepted request", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "rejected-admission" });
	runner.registerWorkflow("next.yaml", "steps:\n  - print: next");
	begin(runner, "bad");
	begin(runner, "next");
	await requestWorkflow("next.yaml", runner, "next");
	settle(runner, "next");
	await drainWorkflowRequests(runner);
	assert.deepEqual(runner.printedTexts, []);
	assert.equal(
		(await requestWorkflow("missing.yaml", runner, "bad")).kind,
		"error",
	);
	settle(runner, "bad");
	await drainWorkflowRequests(runner);
	assert.deepEqual(runner.printedTexts, ["next"]);
});

test("waiting for an ordinary busy turn precedes reloading the queued file", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "busy-request" });
	runner.registerWorkflow("next.yaml", "steps:\n  - print: before");
	begin(runner, "next");
	await requestWorkflow("next.yaml", runner, "next");
	settle(runner, "next");
	runner.busy = true;
	const execution = drainWorkflowRequests(runner);
	assert.equal(runner.getLatestRun(), null);
	runner.writeFile("next.yaml", "steps:\n  - print: after");
	runner.resolveIdle();
	await execution;
	assert.deepEqual(runner.printedTexts, ["after"]);
});

test("idle failures consume the request without starting a workflow", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "queue-failure" });
	runner.registerWorkflow("next.yaml", "steps:\n  - print: next");
	begin(runner, "next");
	await requestWorkflow("next.yaml", runner, "next");
	settle(runner, "next");
	runner.whenIdle = () => Promise.reject(new Error("idle failed"));
	await drainWorkflowRequests(runner);
	assert.equal(runner.getLatestRun(), null);
	assert.deepEqual(runner.printedTexts, []);
	runner.whenIdle = async () => {};
	begin(runner, "later");
	await requestWorkflow("next.yaml", runner, "later");
	settle(runner, "later");
	await drainWorkflowRequests(runner);
	assert.deepEqual(runner.printedTexts, ["next"]);
});

test("failed originating commands and malformed replay events never start requests", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "failed-command" });
	runner.registerWorkflow("next.yaml", "steps:\n  - print: next");
	begin(runner, "next");
	await requestWorkflow("next.yaml", runner, "next");
	runner.events.push(
		{ type: "command/done", data: { commandId: "next", kind: "error" } },
		{ type: "command/run", data: null },
		{
			type: "command/run",
			data: { commandId: "noise", name: "wf-event", args: "{" },
		},
		{
			type: "command/run",
			data: {
				commandId: "noise-2",
				name: "wf-event",
				args: '{"action":"request","runId":"next"}',
			},
		},
		{ type: "command/done", data: { commandId: "unrelated", kind: "success" } },
	);
	assert.equal(nextWorkflowRequest(runner.events), undefined);
	await drainWorkflowRequests(runner);
	assert.deepEqual(runner.printedTexts, []);
});

test("background event-store failures are logged and release the execution guard", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "broken-store" });
	const snapshotEvents = runner.snapshotEvents.bind(runner);
	const logs: string[] = [];
	runner.logInfo = (text) => {
		logs.push(text);
	};
	runner.snapshotEvents = () => {
		throw new Error("store failed");
	};
	startPendingWorkflows(runner);
	await vi.waitFor(() =>
		assert.deepEqual(logs, ["Workflow queue failed: store failed"]),
	);
	runner.snapshotEvents = snapshotEvents;
	runner.registerWorkflow("next.yaml", "steps:\n  - print: next");
	begin(runner, "next");
	await requestWorkflow("next.yaml", runner, "next");
	settle(runner, "next");
	await drainWorkflowRequests(runner);
	assert.deepEqual(runner.printedTexts, ["next"]);
});
