/**
 * PURPOSE: Unit tests for production DshWorkflowEffectContext (src/effects.ts).
 * CONTRACT: Tests Cordis integration, subagent delegation, abort watching, and filesystem resolution.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Context, Logger } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SessionEventMap } from "@deepseek-ai/dsh-session/types";
import type { SubagentActivationSpec } from "@deepseek-ai/dsh-subagent";
import { test, vi } from "vitest";
import { DshWorkflowEffectContext } from "./effects.ts";

vi.mock("node:fs/promises", { spy: true });

function createMockDshAgent(cwd: string) {
	const appendedEvents: { type: string; data: unknown }[] = [];
	const followups: unknown[] = [];

	const session = {
		header: { cwd },
		requestHeader() {
			return undefined;
		},
		snapshotEvents() {
			return appendedEvents as SessionEventMap[keyof SessionEventMap][];
		},
		append(type: string, data: unknown) {
			appendedEvents.push({ type, data });
		},
	};

	const agent = {
		id: "test-sess-1",
		session,
		followup(msg: unknown) {
			followups.push(msg);
		},
		whenIdle() {
			return Promise.resolve();
		},
	};

	return { agent, appendedEvents, followups, session };
}

test("watchAbort triggers controller abort on turn/end with aborted reason", () => {
	const listeners: Record<
		string,
		((session: unknown, event: { type: string; data?: unknown }) => void)[]
	> = {};
	const mockCtx = {
		on(
			event: string,
			cb: (session: unknown, event: { type: string; data?: unknown }) => void,
		) {
			if (!listeners[event]) listeners[event] = [];
			listeners[event].push(cb);
			return () => {
				listeners[event] = listeners[event].filter((l) => l !== cb);
			};
		},
	};

	const { agent, session } = createMockDshAgent("/tmp");
	const effects = new DshWorkflowEffectContext({
		ctx: mockCtx as unknown as Context,
		agent: agent as unknown as Agent,
	});

	const controller = new AbortController();
	const unwatch = effects.watchAbort(controller);

	// Event for different session is ignored
	for (const cb of listeners["session/event"] || []) {
		cb({}, { type: "turn/end", data: { reason: { kind: "aborted" } } });
	}
	assert.equal(controller.signal.aborted, false);

	// Event for this session but different type is ignored
	for (const cb of listeners["session/event"] || []) {
		cb(session, { type: "message/create", data: {} });
	}
	assert.equal(controller.signal.aborted, false);

	// Event for this session with turn/end and aborted reason triggers abort
	for (const cb of listeners["session/event"] || []) {
		cb(session, { type: "turn/end", data: { reason: { kind: "aborted" } } });
	}
	assert.equal(controller.signal.aborted, true);
	assert.deepEqual(controller.signal.reason, { kind: "pause" });

	unwatch();
	assert.equal((listeners["session/event"] || []).length, 0);
});

test("resolveWorkflowFile: throws if cwd is missing", async () => {
	const { agent } = createMockDshAgent("/tmp");
	agent.session.header.cwd = "";
	const effects = new DshWorkflowEffectContext({
		ctx: {} as unknown as Context,
		agent: agent as unknown as Agent,
	});

	await assert.rejects(
		async () => {
			await effects.resolveWorkflowFile("wf.yaml");
		},
		{
			message:
				"Session working directory (agent.session.header.cwd) is missing",
		},
	);
});

test("resolveWorkflowFile: finds direct file, with auto extension, in cwd, in .agents/wf, or throws if not found", async () => {
	const testDir = await mkdtemp(path.join(tmpdir(), "dsh-effects-find-"));
	try {
		const { agent } = createMockDshAgent(testDir);
		const effects = new DshWorkflowEffectContext({
			ctx: {} as unknown as Context,
			agent: agent as unknown as Agent,
		});

		// 1. Direct file in cwd
		const fileA = path.join(testDir, "direct.yaml");
		await writeFile(fileA, "name: Direct", "utf8");
		assert.equal(await effects.resolveWorkflowFile("direct.yaml"), fileA);

		// 2. Auto extension (.yaml) in cwd
		assert.equal(await effects.resolveWorkflowFile("direct"), fileA);

		// 3. File in cwd/.agents/wf
		const localWfDir = path.join(testDir, ".agents/wf");
		await mkdir(localWfDir, { recursive: true });
		const fileB = path.join(localWfDir, "nested.yml");
		await writeFile(fileB, "name: Nested", "utf8");
		assert.equal(await effects.resolveWorkflowFile("nested.yml"), fileB);
		assert.equal(await effects.resolveWorkflowFile("nested"), fileB);

		// 4. Missing file throws
		await assert.rejects(
			async () => {
				await effects.resolveWorkflowFile("missing.yaml");
			},
			{
				message:
					"Workflow file not found for target 'missing.yaml'. Checked locations relative to cwd and ~/.agents/wf.",
			},
		);
	} finally {
		await rm(testDir, { recursive: true, force: true });
	}
});

test("readWorkflow reads content from resolved file path", async () => {
	const testDir = await mkdtemp(path.join(tmpdir(), "dsh-effects-read-"));
	try {
		const { agent } = createMockDshAgent(testDir);
		const effects = new DshWorkflowEffectContext({
			ctx: {} as unknown as Context,
			agent: agent as unknown as Agent,
		});

		const file = path.join(testDir, "read-test.yaml");
		await writeFile(file, "name: Test Content", "utf8");

		const content = await effects.readWorkflow("read-test.yaml");
		assert.equal(content, "name: Test Content");
	} finally {
		await rm(testDir, { recursive: true, force: true });
	}
});

test("listWorkflowFiles: throws if cwd is missing", async () => {
	const { agent } = createMockDshAgent("/tmp");
	agent.session.header.cwd = "";
	const effects = new DshWorkflowEffectContext({
		ctx: {} as unknown as Context,
		agent: agent as unknown as Agent,
	});

	await assert.rejects(
		async () => {
			await effects.listWorkflowFiles("local");
		},
		{
			message:
				"Session working directory (agent.session.header.cwd) is missing",
		},
	);
});

test("listWorkflowFiles: scans and sorts workflow files recursively in local scope", async () => {
	const testDir = await mkdtemp(path.join(tmpdir(), "dsh-effects-list-"));
	try {
		const { agent } = createMockDshAgent(testDir);
		const effects = new DshWorkflowEffectContext({
			ctx: {} as unknown as Context,
			agent: agent as unknown as Agent,
		});

		const wfDir = path.join(testDir, ".agents/wf");
		await mkdir(path.join(wfDir, "sub"), { recursive: true });

		await writeFile(path.join(wfDir, "b.yaml"), "name: B", "utf8");
		await writeFile(path.join(wfDir, "a.yml"), "name: A", "utf8");
		await writeFile(path.join(wfDir, "sub/c.yaml"), "name: C", "utf8");
		await writeFile(path.join(wfDir, "ignore.txt"), "ignored", "utf8");

		const files = await effects.listWorkflowFiles("local");
		assert.equal(files.length, 3);
		assert.equal(files[0].target, "a.yml");
		assert.equal(files[0].content, "name: A");
		assert.equal(files[1].target, "b.yaml");
		assert.equal(files[1].content, "name: B");
		assert.equal(files[2].target, "sub/c.yaml");
		assert.equal(files[2].content, "name: C");
	} finally {
		await rm(testDir, { recursive: true, force: true });
	}
});

test("dispatchPrompt creates user message with workflow notice and summary", async () => {
	const { agent, followups } = createMockDshAgent("/tmp");
	const effects = new DshWorkflowEffectContext({
		ctx: {} as unknown as Context,
		agent: agent as unknown as Agent,
	});

	await effects.dispatchPrompt({
		type: "prompt",
		promptText: "Execute step instructions",
		stepLabel: "Step 1 of 3: Planning",
	});

	assert.equal(followups.length, 1);
	const msg = followups[0] as {
		content: { type: string; text: string }[];
		source: { kind: string; form: string; summary: string };
	};
	assert.equal(msg.content[0].text, "Execute step instructions");
	assert.equal(msg.source.kind, "workflow");
	assert.equal(msg.source.form, "notice");
	assert.equal(msg.source.summary, "Step 1 of 3: Planning");
});

test("dispatchSubagent delegates to subagents service with delivery caller and options", async () => {
	let startActivationArgs: unknown;
	const mockSubagents = {
		startActivation(args: unknown) {
			startActivationArgs = args;
			return Promise.resolve({
				result: Promise.resolve({
					stopReason: "completed",
					output: [{ type: "text", text: "Subagent complete" }],
				}),
			});
		},
	};

	const mockCtx = { subagents: mockSubagents };
	const { agent } = createMockDshAgent("/tmp");
	const effects = new DshWorkflowEffectContext({
		ctx: mockCtx as unknown as Context,
		agent: agent as unknown as Agent,
	});

	const res = await effects.dispatchSubagent({
		type: "subagent",
		stepLabel: "Step 1: Subagent",
		promptText: "Do work",
		config: {
			provider: "fork",
			preset: "custom-subagent",
		},
	});

	assert.equal(res.outputText, "Subagent complete");
	assert.ok(startActivationArgs);
	const args = startActivationArgs as SubagentActivationSpec;
	assert.equal(args.provider, "fork");
	assert.equal(args.label, "Step 1: Subagent");
	assert.equal(args.delivery, "caller");
	assert.equal(args.agentPreset, "custom-subagent");
	assert.equal(args.parent, agent);
	assert.deepEqual(args.prompt, [{ type: "text", text: "Do work" }]);
});

test("dispatchSubagent passes agentOptions when model or thinking is configured", async () => {
	let startActivationArgs: unknown;
	const mockSubagents = {
		startActivation(args: unknown) {
			startActivationArgs = args;
			return Promise.resolve({
				result: Promise.resolve({
					stopReason: "completed",
					output: [{ type: "text", text: "Analysis complete" }],
				}),
			});
		},
	};

	const mockCtx = { subagents: mockSubagents };
	const { agent } = createMockDshAgent("/tmp");
	const effects = new DshWorkflowEffectContext({
		// type-safe: minimal test context mock providing subagents service
		ctx: mockCtx as unknown as Context,
		// type-safe: test agent mock with stubbed session and event log
		agent: agent as unknown as Agent,
	});

	await effects.dispatchSubagent({
		type: "subagent",
		stepLabel: "Step 1: Subagent",
		promptText: "Analyze repository",
		config: {
			provider: "fork",
			model: "deepseek-reasoner",
			thinking: "high",
		},
	});

	// type-safe: inspecting captured activation request arguments passed to mock
	const args = startActivationArgs as SubagentActivationSpec;
	assert.equal(args.agentOptions?.model, "deepseek-reasoner");
	assert.equal(args.agentOptions?.reasoningEffort, "high");
});

test("dispatchSubagent passes provider to agentOptions when llmProvider is configured", async () => {
	let startActivationArgs: unknown;
	const mockSubagents = {
		startActivation(args: unknown) {
			startActivationArgs = args;
			return Promise.resolve({
				result: Promise.resolve({
					stopReason: "completed",
					output: [{ type: "text", text: "Analysis complete" }],
				}),
			});
		},
	};

	const mockCtx = { subagents: mockSubagents };
	const { agent } = createMockDshAgent("/tmp");
	const effects = new DshWorkflowEffectContext({
		// type-safe: minimal test context mock providing subagents service
		ctx: mockCtx as unknown as Context,
		// type-safe: test agent mock with stubbed session and event log
		agent: agent as unknown as Agent,
	});

	await effects.dispatchSubagent({
		type: "subagent",
		stepLabel: "Step 1 of 1: Subagent",
		promptText: "Analyze repository",
		config: {
			provider: "spawn",
			llmProvider: "acp-codex-acp",
			model: "gpt-6.1-sol",
			thinking: "medium",
		},
	});

	// type-safe: inspecting captured activation request arguments passed to mock
	const args = startActivationArgs as SubagentActivationSpec;
	assert.equal(args.provider, "spawn");
	assert.equal(args.agentPreset, undefined);
	assert.equal(args.agentOptions?.provider, "acp-codex-acp");
	assert.equal(args.agentOptions?.model, "gpt-6.1-sol");
	assert.equal(args.agentOptions?.reasoningEffort, "medium");
});

test("dispatchSubagent passes outputSchema and returns structured data", async () => {
	let startActivationArgs: unknown;
	const mockSubagents = {
		startActivation(args: unknown) {
			startActivationArgs = args;
			return Promise.resolve({
				result: Promise.resolve({
					stopReason: "completed",
					output: [{ type: "text", text: "Scan complete" }],
					structured: {
						findings: "No smells found",
						report: "/workspace/report.md",
					},
				}),
			});
		},
	};

	const mockCtx = { subagents: mockSubagents };
	const { agent } = createMockDshAgent("/tmp");
	const effects = new DshWorkflowEffectContext({
		ctx: mockCtx as unknown as Context,
		agent: agent as unknown as Agent,
	});

	const schema = {
		type: "object" as const,
		properties: {
			findings: { type: "string" as const },
			report: { type: "string" as const },
		},
		required: ["findings", "report"],
		additionalProperties: false,
	};

	const output = await effects.dispatchSubagent({
		type: "subagent",
		stepLabel: "Step 1 of 1: Scan",
		promptText: "Scan antipatterns",
		config: {},
		outputSchema: schema,
	});

	assert.equal(output.outputText, "Scan complete");
	assert.deepEqual(output.structured, {
		findings: "No smells found",
		report: "/workspace/report.md",
	});
	const args = startActivationArgs as SubagentActivationSpec;
	assert.deepEqual(args.outputSchema, schema);
});

test("dispatchSubagent pauses workflow when subagent is aborted", async () => {
	const mockSubagents = {
		startActivation() {
			return Promise.resolve({
				result: Promise.resolve({
					stopReason: "aborted",
					output: [],
				}),
			});
		},
	};

	const mockCtx = {
		on() {
			return () => {};
		},
		subagents: mockSubagents,
	};
	const { agent } = createMockDshAgent("/tmp");
	const effects = new DshWorkflowEffectContext({
		ctx: mockCtx as unknown as Context,
		agent: agent as unknown as Agent,
	});

	const controller = new AbortController();
	effects.watchAbort(controller);

	const output = await effects.dispatchSubagent({
		type: "subagent",
		stepLabel: "Step 1: Subagent",
		promptText: "Do work",
		config: {},
	});

	assert.equal(output.outputText, "");
	assert.equal(controller.signal.aborted, true);
	assert.deepEqual(controller.signal.reason, { kind: "pause" });
});

test("logInfo calls logger when present", () => {
	const logged: string[] = [];
	const logger = {
		info(msg: string) {
			logged.push(msg);
		},
	} as unknown as Logger;

	const { agent } = createMockDshAgent("/tmp");
	const effectsWithLog = new DshWorkflowEffectContext({
		ctx: {} as unknown as Context,
		agent: agent as unknown as Agent,
		log: logger,
	});

	effectsWithLog.logInfo("System info");

	assert.deepEqual(logged, ["System info"]);

	// Without logger: should not throw
	const effectsNoLog = new DshWorkflowEffectContext({
		ctx: {} as unknown as Context,
		agent: agent as unknown as Agent,
	});
	effectsNoLog.logInfo("System info");
});

test("resolveOutputPath and checkFileWritten validation", async () => {
	const testDir = await mkdtemp(path.join(tmpdir(), "dsh-effects-files-"));
	try {
		const { agent } = createMockDshAgent(testDir);
		const effects = new DshWorkflowEffectContext({
			ctx: {} as unknown as Context,
			agent: agent as unknown as Agent,
		});

		// 1. Workspace base
		const wsPath = effects.resolveOutputPath(
			"artifacts/report.md",
			"workspace",
		);
		assert.equal(wsPath, path.resolve(testDir, "artifacts/report.md"));

		// 2. Scratch base
		const scratchPath = effects.resolveOutputPath("notes.txt", "scratch");
		assert.equal(
			scratchPath,
			path.resolve(testDir, ".agents/scratch", agent.id, "notes.txt"),
		);

		// 3. checkFileWritten: non-existent file
		assert.equal(await effects.checkFileWritten(wsPath), false);

		// 4. checkFileWritten: 0-byte file returns false
		await mkdir(path.dirname(wsPath), { recursive: true });
		await writeFile(wsPath, "", "utf8");
		assert.equal(await effects.checkFileWritten(wsPath), false);

		// 5. checkFileWritten: non-empty file returns true
		await writeFile(wsPath, "Some content", "utf8");
		assert.equal(await effects.checkFileWritten(wsPath), true);
		assert.equal(await effects.checkFileWritten(testDir), false);
		assert.equal(
			await effects.checkFileWritten(path.join(wsPath, "child")),
			false,
		);

		for (const error of [
			Object.assign(new Error("Permission denied"), { code: "EACCES" }),
			Object.assign(new Error("I/O failure"), { code: "EIO" }),
			null,
			"stat failed",
		]) {
			vi.mocked(stat).mockRejectedValueOnce(error);
			await assert.rejects(
				effects.checkFileWritten(wsPath),
				(err) => err === error,
			);
		}
	} finally {
		await rm(testDir, { recursive: true, force: true });
	}
});

test("ensureScratchDirectory creates base, .gitignore, and session directories", async () => {
	const testDir = await mkdtemp(path.join(tmpdir(), "dsh-effects-scratch-"));
	try {
		const { agent } = createMockDshAgent(testDir);
		const effects = new DshWorkflowEffectContext({
			ctx: {} as unknown as Context,
			agent: agent as unknown as Agent,
		});

		for (const code of ["EACCES", "ENOTDIR", "EIO"]) {
			const error = Object.assign(new Error("Scratch stat failed"), { code });
			vi.mocked(stat).mockRejectedValueOnce(error);
			await assert.rejects(
				effects.ensureScratchDirectory(),
				(err) => err === error,
			);
		}

		const sessionScratch = await effects.ensureScratchDirectory();
		assert.equal(
			sessionScratch,
			path.resolve(testDir, ".agents/scratch", agent.id),
		);

		// Subsequent call should safely reuse existing base
		const secondCall = await effects.ensureScratchDirectory();
		assert.equal(secondCall, sessionScratch);
	} finally {
		await rm(testDir, { recursive: true, force: true });
	}
});

test("recordOutput and getCapturedOutput record and retrieve outputs from session events", () => {
	const { agent } = createMockDshAgent("/tmp");
	const effects = new DshWorkflowEffectContext({
		ctx: {} as unknown as Context,
		agent: agent as unknown as Agent,
	});

	// Initially no captured output
	assert.equal(effects.getCapturedOutput(0, "report"), undefined);

	// Record a file output
	effects.recordOutput(
		0,
		"report",
		"/tmp/report.md",
		"file",
		"scratch",
		"test-run",
	);

	// Record a string output
	effects.recordOutput(1, "token", "xyz-123", "string", undefined, "test-run");

	// Retrieve outputs
	assert.equal(effects.getCapturedOutput(0, "report"), "/tmp/report.md");
	assert.equal(effects.getCapturedOutput(1, "token"), "xyz-123");
	assert.equal(effects.getCapturedOutput(0, "nonexistent"), undefined);
	assert.equal(effects.getCapturedOutput(2, "token"), undefined);
});

test("validateSubagentRoute validates subagent provider, agentOptions, presets, and LLM routes", async () => {
	const mockProviders: Record<
		string,
		{
			capabilities: { agentOptions: boolean; agentPreset: boolean };
			inheritsParentContext?: boolean;
		}
	> = {
		spawn: { capabilities: { agentOptions: true, agentPreset: true } },
		fork: {
			capabilities: { agentOptions: true, agentPreset: false },
			inheritsParentContext: true,
		},
		acp: { capabilities: { agentOptions: false, agentPreset: false } },
	};
	const mockLlm = {
		listProviders() {
			return [
				{ id: "acp-codex-acp", name: "Codex ACP" },
				{ id: "deepseek", name: "DeepSeek" },
			];
		},
		resolveCallConfig(config: {
			provider: string;
			model: string;
			reasoningEffort?: string;
		}) {
			if (config.model === "unknown-model") {
				throw new Error(
					`Model '${config.model}' not found on provider '${config.provider}'`,
				);
			}
			if (config.reasoningEffort === "ultra") {
				throw new Error(
					`Reasoning effort '${config.reasoningEffort}' unsupported`,
				);
			}
			return Promise.resolve(config);
		},
	};
	const mockPresets = {
		readDocument(id: string) {
			if (id === "missing-preset") {
				throw new Error(`Preset '${id}' not found`);
			}
			return Promise.resolve({ id, description: "Valid preset" });
		},
	};
	const mockCtx = {
		subagents: {
			getProvider(name: string) {
				return mockProviders[name];
			},
		},
		get(name: string) {
			if (name === "llm") return mockLlm;
			if (name === "agentPresets") return mockPresets;
			return undefined;
		},
	};
	const { agent } = createMockDshAgent("/tmp");
	const effects = new DshWorkflowEffectContext({
		ctx: mockCtx as unknown as Context,
		agent: {
			...agent,
			options: { provider: "deepseek", model: "deepseek-chat" },
		} as unknown as Agent,
	});

	// 1. Success on valid route
	const validRes = await effects.validateSubagentRoute({
		provider: "spawn",
		llmProvider: "acp-codex-acp",
		model: "gpt-6.1-sol",
		thinking: "high",
	});
	assert.deepEqual(validRes, { valid: true });

	// 2. Unregistered subagent provider
	const unregSubagent = await effects.validateSubagentRoute({
		provider: "nonexistent",
	});
	assert.equal(unregSubagent.valid, false);
	assert.match(
		unregSubagent.message,
		/Subagent provider 'nonexistent' is not registered/,
	);

	// 3. Provider does not support agentOptions
	const noOptions = await effects.validateSubagentRoute({
		provider: "acp",
		model: "some-model",
	});
	assert.equal(noOptions.valid, false);
	assert.match(noOptions.message, /does not support custom model options/);

	// 4. Provider does not support independent agentPreset
	const noPreset = await effects.validateSubagentRoute({
		provider: "fork",
		preset: "custom-preset",
	});
	assert.equal(noPreset.valid, false);
	assert.match(
		noPreset.message,
		/does not support independent agent preset selection/,
	);

	// 5. Missing preset
	const missingPreset = await effects.validateSubagentRoute({
		provider: "spawn",
		preset: "missing-preset",
	});
	assert.equal(missingPreset.valid, false);
	assert.match(
		missingPreset.message,
		/Agent preset 'missing-preset' not found/,
	);

	// 6. Unregistered LLM provider
	const unregLlm = await effects.validateSubagentRoute({
		provider: "spawn",
		llmProvider: "bogus-adapter",
		model: "some-model",
	});
	assert.equal(unregLlm.valid, false);
	assert.match(
		unregLlm.message,
		/LLM provider 'bogus-adapter' is not registered/,
	);

	// 7. Unknown model
	const unregModel = await effects.validateSubagentRoute({
		provider: "spawn",
		llmProvider: "acp-codex-acp",
		model: "unknown-model",
	});
	assert.equal(unregModel.valid, false);
	assert.match(unregModel.message, /Model 'unknown-model' not found/);

	// 8. Unsupported reasoning effort
	const unregThinking = await effects.validateSubagentRoute({
		provider: "spawn",
		llmProvider: "acp-codex-acp",
		model: "gpt-6.1-sol",
		thinking: "ultra",
	});
	assert.equal(unregThinking.valid, false);
	assert.match(unregThinking.message, /Reasoning effort 'ultra' unsupported/);
});
