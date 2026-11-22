/**
 * PURPOSE: End-to-end fixture-based workflow test suite.
 * ALLOWED: Top-level async fixture discovery, WorkflowTestRunner execution, snapshot assertions.
 * FORBIDDEN: Direct external service orchestration or mock network calls.
 *
 * Read ./AGENTS.md first before modifying this file.
 */

import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CommandId } from "@deepseek-ai/dsh-commands";
import { test, vi } from "vitest";
import {
	discardWorkflow,
	executeWorkflow,
	parseInvocationInput,
	resumeWorkflow,
} from "../index.ts";
import { nextWorkflowRequest } from "../requests.ts";
import { drainWorkflowRequests, requestWorkflow } from "../runner.ts";
import { assertRecordedEvents, assertRecordedState } from "./assertions.ts";
import { WorkflowTestRunner } from "./test-runner.ts";
import type { ScenarioDefinition } from "./types.ts";

const FIXTURES_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"fixtures",
);

const fixtureEntries = await readdir(FIXTURES_DIR, { withFileTypes: true });
const scenarios = fixtureEntries
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();

for (const scenario of scenarios) {
	test(`e2e workflow fixture: ${scenario}`, async () => {
		const scenarioDir = path.join(FIXTURES_DIR, scenario);
		const casePath = path.join(scenarioDir, "case.json");
		const workflowPath = path.join(scenarioDir, "workflow.yaml");
		const eventsFixturePath = path.join(scenarioDir, "events.json");
		const stateFixturePath = path.join(scenarioDir, "state.json");

		const caseContent = await readFile(casePath, "utf-8");
		const caseDef = JSON.parse(caseContent) as ScenarioDefinition;

		let workflowContent = "";
		try {
			workflowContent = await readFile(workflowPath, "utf-8");
		} catch (err: unknown) {
			const nodeErr = err as NodeJS.ErrnoException;
			if (nodeErr.code !== "ENOENT") throw err;
		}

		const runner = new WorkflowTestRunner({
			sessionId: caseDef.sessionId,
			behavior: caseDef.behavior,
		});

		if (caseDef.files) {
			for (const [filePath, content] of Object.entries(caseDef.files)) {
				runner.registerWorkflow(filePath, content);
			}
		}

		const defaultTargetPath =
			caseDef.targetPath ??
			(caseDef.actions && caseDef.actions[0]?.type === "execute"
				? caseDef.actions[0].targetPath
				: "workflow.yaml");

		if (workflowContent) {
			const parsed = parseInvocationInput(defaultTargetPath);
			runner.registerWorkflow(parsed.targetPath, workflowContent);
		}

		let recordedState: unknown;
		let lastResult: unknown;

		if (caseDef.actions && caseDef.actions.length > 0) {
			let executeCount = 0;
			for (const action of caseDef.actions) {
				if (
					runner.abortController.signal.aborted &&
					!("abortBeforeStart" in action && action.abortBeforeStart) &&
					!("pauseBeforeStart" in action && action.pauseBeforeStart)
				) {
					runner.resetAbortController();
				}
				switch (action.type) {
					case "request": {
						const commandId = CommandId(action.runId);
						runner.appendSessionEvent("command/run", {
							commandId,
							name: "wf",
							args: action.targetPath,
							source: { kind: "user" },
						});
						const result = await requestWorkflow(
							action.targetPath,
							runner,
							action.runId,
						);
						runner.appendSessionEvent("command/done", { commandId, ...result });
						lastResult = result;
						await drainWorkflowRequests(runner);
						break;
					}
					case "write":
						runner.writeFile(action.targetPath, action.content);
						break;
					case "drain":
						await drainWorkflowRequests(runner);
						await vi.waitFor(() => {
							assert.equal(nextWorkflowRequest(runner.events), undefined);
							assert.notEqual(runner.getLatestRun()?.state.status, "running");
						});
						break;
					case "execute": {
						executeCount++;
						const defaultRunId =
							executeCount === 1
								? `${runner.sessionId}-run`
								: `${runner.sessionId}-run-${executeCount}`;
						const parsed = parseInvocationInput(action.targetPath);
						if (workflowContent && !parsed.targetPath.startsWith("missing")) {
							runner.registerWorkflow(parsed.targetPath, workflowContent);
						}
						if (action.abortBeforeStart) {
							runner.abortController.abort();
						} else if (action.pauseBeforeStart) {
							runner.abortController.abort({ kind: "pause" });
						}
						lastResult = await executeWorkflow({
							effects: runner,
							targetPath: action.targetPath,
							signal: runner.abortController.signal,
							runId: action.runId ?? defaultRunId,
						});
						break;
					}
					case "resume": {
						if (action.abortBeforeStart) {
							runner.abortController.abort();
						} else if (action.pauseBeforeStart) {
							runner.abortController.abort({ kind: "pause" });
						}
						lastResult = await resumeWorkflow({
							effects: runner,
							instructions: action.instructions,
							signal: runner.abortController.signal,
						});
						break;
					}
					case "discard": {
						lastResult = await discardWorkflow({
							effects: runner,
						});
						break;
					}
				}
			}
			recordedState = {
				latestRun: runner.getLatestRun(),
				lastResult,
			};
			if (caseDef.expectedResult) {
				const resultObj = lastResult as
					| { kind?: string; text?: string }
					| undefined;
				assert.ok(resultObj, "Expected lastResult to be defined");
				assert.equal(resultObj.kind, caseDef.expectedResult.kind);
				if (caseDef.expectedResult.textPattern && resultObj.text) {
					assert.match(
						resultObj.text,
						new RegExp(caseDef.expectedResult.textPattern),
					);
				}
			}
		} else if (caseDef.resume !== undefined) {
			const execResult = await executeWorkflow({
				effects: runner,
				targetPath: caseDef.targetPath ?? "workflow.yaml",
				signal: runner.abortController.signal,
				runId: `${runner.sessionId}-run`,
			});
			assert.equal(execResult.kind, "success");
			const pausedState = runner.getLatestRun();
			assert.ok(pausedState, "Paused workflow run state must be present");
			assert.equal(pausedState.state.status, "paused");

			const resumeResult = await resumeWorkflow({
				effects: runner,
				instructions: caseDef.resume.instructions,
				signal: runner.abortController.signal,
			});
			assert.equal(resumeResult.kind, "success");

			const completedState = runner.getLatestRun();
			assert.ok(completedState, "Completed workflow run state must be present");
			assert.equal(completedState.state.status, "completed");

			recordedState = {
				paused: pausedState,
				completed: completedState,
			};
		} else {
			const execResult = await executeWorkflow({
				effects: runner,
				targetPath: caseDef.targetPath ?? "workflow.yaml",
				signal: runner.abortController.signal,
				runId: `${runner.sessionId}-run`,
			});
			if (caseDef.expectedResult) {
				assert.equal(execResult.kind, caseDef.expectedResult.kind);
				if (caseDef.expectedResult.textPattern && execResult.text) {
					assert.match(
						execResult.text,
						new RegExp(caseDef.expectedResult.textPattern),
					);
				}
			} else {
				assert.equal(execResult.kind, "success");
			}
			recordedState = runner.getLatestRun();
		}

		const recordedEvents = runner.snapshotEvents();
		assertRecordedState(recordedState, caseDef.expectedState);
		assertRecordedEvents(recordedEvents, caseDef.expectedEvents);

		const shouldUpdate =
			process.env.UPDATE_FIXTURES === "1" ||
			process.env.UPDATE_SNAPSHOTS === "1";

		if (shouldUpdate) {
			await writeFile(
				eventsFixturePath,
				`${JSON.stringify(recordedEvents, null, "\t")}\n`,
			);
			await writeFile(
				stateFixturePath,
				`${JSON.stringify(recordedState, null, "\t")}\n`,
			);
			return;
		}

		let expectedEventsContent: string | null = null;
		let expectedStateContent: string | null = null;

		try {
			expectedEventsContent = await readFile(eventsFixturePath, "utf-8");
			expectedStateContent = await readFile(stateFixturePath, "utf-8");
		} catch (err: unknown) {
			const nodeErr = err as NodeJS.ErrnoException;
			if (nodeErr.code !== "ENOENT") throw err;
		}

		if (expectedEventsContent === null || expectedStateContent === null) {
			assert.fail(
				`Missing fixture snapshot (${expectedEventsContent === null ? "events.json" : "state.json"}) for scenario "${scenario}". Run with UPDATE_FIXTURES=1 to generate baseline.`,
			);
		}

		const expectedEvents = JSON.parse(expectedEventsContent);
		const expectedState = JSON.parse(expectedStateContent);

		assert.deepEqual(recordedEvents, expectedEvents);
		assert.deepEqual(recordedState, expectedState);
	});
}
