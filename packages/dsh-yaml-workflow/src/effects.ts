/**
 * PURPOSE: Execution effect boundary and Cordis/DSH runtime implementation.
 * ALLOWED: Async execution, agent followups, subagent activation, event appending.
 * FORBIDDEN: Direct workflow parsing or state transitions (delegate to pure core).
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Context, Logger } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CommandId } from "@deepseek-ai/dsh-commands";
import { createUserMessage, ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import type { SessionEventMap } from "@deepseek-ai/dsh-session";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {} from "@deepseek-ai/dsh-session-title";
import { parentAgentOptionsForDelegation } from "@deepseek-ai/dsh-subagent";
import {
	type FileOutputBase,
	type SubagentConfig,
	type SubagentDispatchResult,
	WORKFLOW_EVENT_NAME,
	type WorkflowDocument,
	type WorkflowEffect,
	type WorkflowInvocation,
	type WorkflowOutputPayloadData,
	type WorkflowPayload,
	type WorkflowState,
} from "./types.ts";

/**
 * PURPOSE: Abstract execution effect boundary for workflows.
 * CONTRACT:
 * - Subclasses define runtime-specific I/O (DSH/Cordis vs. in-memory test runner).
 * - Stateless workflow runner delegates all side effects through this contract.
 */
export abstract class WorkflowEffectContext {
	abstract readonly sessionId: SessionId;

	/**
	 * Resolves a workflow target path or well-known name to an existing workflow file path.
	 * CONTRACT:
	 * - Inputs: targetPath string.
	 * - Outputs: Promise resolving to the absolute file path.
	 * - Throws: Error when workflow file cannot be resolved.
	 */
	abstract resolveWorkflowFile(targetPath: string): Promise<string>;

	/** Reads raw workflow file content from specified target path */
	abstract readWorkflow(targetPath: string): Promise<string>;

	/**
	 * Lists all workflow files (.yaml and .yml) in the specified scope ("local" or "common").
	 * CONTRACT:
	 * - Inputs: scope: "local" (session cwd/.agents/wf) or "common" (~/.agents/wf).
	 * - Outputs: Promise resolving to array of target identifier and raw string content.
	 * - Throws: None (missing directories return empty array).
	 */
	abstract listWorkflowFiles(
		scope: "local" | "common",
	): Promise<
		ReadonlyArray<{ readonly target: string; readonly content: string }>
	>;

	/** Dispatches an interactive prompt to the agent and awaits completion */
	abstract dispatchPrompt(
		effect: Extract<WorkflowEffect, { type: "prompt" }>,
	): Promise<void>;

	/** Dispatches a subagent activation and awaits completion, returning the output text and optional structured data */
	abstract dispatchSubagent(
		effect: Extract<WorkflowEffect, { type: "subagent" }>,
		signal?: AbortSignal,
	): Promise<SubagentDispatchResult>;

	/** Validates that a subagent step's provider, adapter route, and model are supported and registered */
	abstract validateSubagentRoute(
		config: SubagentConfig,
		signal?: AbortSignal,
	): Promise<
		| { readonly valid: true }
		| { readonly valid: false; readonly message: string }
	>;

	/** Emits informational log messages regarding workflow lifecycle */
	abstract logInfo(message: string): void;

	/** Resolves the fully-qualified target path for a file output */
	abstract resolveOutputPath(filePath: string, base: FileOutputBase): string;

	/**
	 * Subscribes an AbortController to agent/turn interruption events during execution.
	 * CONTRACT:
	 * - Inputs: AbortController instance.
	 * - Outputs: Cleanup function to remove event subscriptions.
	 */
	abstract watchAbort(controller: AbortController): () => void;

	/** Checks for a non-empty file; propagates filesystem errors other than absence. */
	abstract checkFileWritten(resolvedPath: string): Promise<boolean>;

	/** Ensures the scratch directory exists, writing .gitignore if base scratch directory is created */
	abstract ensureScratchDirectory(): Promise<string>;

	/** Records a verified workflow output in session events */
	recordOutput(
		stepIndex: number,
		name: string,
		value: string,
		outputType: "file" | "string" | "list",
		base: FileOutputBase | undefined,
		runId: string,
	): void {
		this.emit({
			action: "output",
			stepIndex,
			name,
			value,
			outputType,
			...(base ? { base } : {}),
			runId,
		});
	}

	/** Retrieves a previously captured output for a step from session events */
	getCapturedOutput(stepIndex: number, name: string): string | undefined {
		const events = this.snapshotEvents();
		for (let i = events.length - 1; i >= 0; i--) {
			const evt = events[i];
			if (evt.type !== "command/run") continue;
			const data = evt.data as { name?: string; args?: string } | undefined;
			if (data?.name !== WORKFLOW_EVENT_NAME || typeof data.args !== "string")
				continue;
			try {
				const payload = JSON.parse(data.args) as WorkflowPayload;
				if (
					payload.action === "output" &&
					payload.stepIndex === stepIndex &&
					payload.name === name
				) {
					return payload.value;
				}
			} catch {
				// ignore parse errors
			}
		}
		return undefined;
	}

	/** Appends a low-level session event */
	abstract appendSessionEvent(
		type: "command/run",
		data: SessionEventMap["command/run"],
	): void;
	abstract appendSessionEvent(
		type: "command/done",
		data: SessionEventMap["command/done"],
	): void;
	abstract appendSessionEvent(
		type: "session/title",
		data: SessionEventMap["session/title"],
	): void;

	/** Retrieves the full chronological snapshot of session events */
	abstract snapshotEvents(): readonly {
		readonly type: string;
		readonly data?: unknown;
	}[];

	/** Updates the agent status */
	abstract setStatus(status: "running" | "idle"): void;

	/**
	 * Purpose: Awaits until the underlying agent finishes its active turn.
	 * Contract:
	 * - Inputs: None.
	 * - Outputs: Promise that resolves when the agent is idle.
	 * - Throws: None.
	 */
	abstract whenIdle(): Promise<void>;

	/**
	 * Purpose: Determines whether a session title has already been set in the event log.
	 * Contract:
	 * - Inputs: None.
	 * - Outputs: True if a session/title event exists; false otherwise.
	 */
	hasTitle(): boolean {
		return this.snapshotEvents().some(
			(event) => event.type === "session/title",
		);
	}

	/** Sets the session title */
	setTitle(title: string): void {
		this.appendSessionEvent("session/title", {
			title,
			messageSeqs: [],
			source: { kind: "user" },
		});
	}

	/**
	 * Emits a workflow event as paired command/run and command/done records.
	 * CONTRACT:
	 * - Inputs: workflow lifecycle, request, step, print, or output payload.
	 * - Outputs: appends command/run and command/done records to session.
	 */
	emit(
		event:
			| {
					readonly action: "request";
					readonly rawInput: string;
					readonly runId: string;
			  }
			| {
					readonly action: "request-failed";
					readonly runId: string;
			  }
			| {
					readonly action: "init";
					readonly workflow: WorkflowDocument;
					readonly invocation: WorkflowInvocation;
					readonly runId: string;
			  }
			| ({
					readonly action: "state";
					readonly runId: string;
			  } & Partial<WorkflowState>)
			| {
					readonly action: "step";
					readonly id: string;
					readonly stepIndex: number;
					readonly label: string;
					readonly kind: "success" | "error";
					readonly runId: string;
			  }
			| {
					readonly action: "print";
					readonly id: string;
					readonly text: string;
					readonly runId: string;
			  }
			| ({
					readonly action: "output";
					readonly runId: string;
			  } & Omit<WorkflowOutputPayloadData, "sessionId">),
	): void {
		const commandId =
			`wf-${event.action}-${this.snapshotEvents().length}` as CommandId;

		const payload: WorkflowPayload = {
			...event,
			sessionId: this.sessionId,
		};

		this.appendSessionEvent("command/run", {
			commandId,
			name: WORKFLOW_EVENT_NAME,
			args: JSON.stringify(payload),
			source: { kind: "user" },
		});
		this.appendSessionEvent("command/done", {
			commandId,
			kind: "success",
			text: `Workflow action '${event.action}' recorded`,
		});
	}
}

export interface DshWorkflowEffectContextOptions {
	readonly ctx: Context;
	readonly agent: Agent;
	readonly log?: Logger;
}

/**
 * PURPOSE: Production effect context binding the runner to DeepSeek Harness / Cordis runtime.
 * CONTRACT:
 * - Inputs: DshWorkflowEffectContextOptions containing Context, Agent, and optional Logger.
 * - Side-effects: Dispatches to Cordis services, reads files via fs/promises, appends to Session.
 */
export class DshWorkflowEffectContext extends WorkflowEffectContext {
	readonly sessionId: SessionId;
	private readonly ctx: Context;
	private readonly agent: Agent;
	private readonly log?: Logger;
	private activeAbortController?: AbortController;

	constructor({ ctx, agent, log }: DshWorkflowEffectContextOptions) {
		super();
		this.ctx = ctx;
		this.agent = agent;
		this.sessionId = agent.id as SessionId;
		this.log = log;
	}

	watchAbort(controller: AbortController): () => void {
		this.activeAbortController = controller;
		// cast: Cordis Context type does not export host session/event interface
		const eventDispose = (
			this.ctx.on as unknown as (
				event: string,
				cb: (session: unknown, event: { type: string; data?: unknown }) => void,
			) => () => void
		)("session/event", (session, event) => {
			if (session === this.agent.session && event.type === "turn/end") {
				const reason = (event.data as { reason?: { kind?: string } })?.reason;
				if (reason?.kind === "aborted") {
					controller.abort({ kind: "pause" });
				}
			}
		});

		return () => {
			this.activeAbortController = undefined;
			eventDispose();
		};
	}

	async resolveWorkflowFile(targetPath: string): Promise<string> {
		const cwd = this.agent.session.header.cwd;
		if (!cwd) {
			throw new Error(
				"Session working directory (agent.session.header.cwd) is missing",
			);
		}
		const baseLocations = path.isAbsolute(targetPath)
			? [targetPath]
			: [
					path.resolve(cwd, targetPath),
					path.resolve(cwd, ".agents/wf", targetPath),
					path.resolve(homedir(), ".agents/wf", targetPath),
				];
		const hasExt = targetPath.endsWith(".yaml") || targetPath.endsWith(".yml");
		for (const base of baseLocations) {
			const candidates = hasExt
				? [base]
				: [base, `${base}.yaml`, `${base}.yml`];
			for (const candidate of candidates) {
				try {
					const s = await stat(candidate);
					if (s.isFile()) {
						return candidate;
					}
				} catch (err: unknown) {
					// edge case: candidate path does not exist, continue search
					const nodeErr = err as NodeJS.ErrnoException;
					if (nodeErr.code !== "ENOENT" && nodeErr.code !== "ENOTDIR") {
						throw err;
					}
				}
			}
		}
		throw new Error(
			`Workflow file not found for target '${targetPath}'. Checked locations relative to cwd and ~/.agents/wf.`,
		);
	}

	async readWorkflow(targetPath: string): Promise<string> {
		const resolvedPath = await this.resolveWorkflowFile(targetPath);
		return readFile(resolvedPath, "utf8");
	}

	async listWorkflowFiles(
		scope: "local" | "common",
	): Promise<
		ReadonlyArray<{ readonly target: string; readonly content: string }>
	> {
		const cwd = this.agent.session.header.cwd;
		if (!cwd) {
			throw new Error(
				"Session working directory (agent.session.header.cwd) is missing",
			);
		}
		const dirPath =
			scope === "local"
				? path.resolve(cwd, ".agents/wf")
				: path.resolve(homedir(), ".agents/wf");

		const files = await scanWorkflowDirectory(dirPath, dirPath);
		return files.sort((a, b) => a.target.localeCompare(b.target));
	}

	async dispatchPrompt(
		effect: Extract<WorkflowEffect, { type: "prompt" }>,
	): Promise<void> {
		this.agent.followup(
			createUserMessage({
				content: [{ type: "text", text: effect.promptText }],
				source: {
					kind: "workflow",
					form: "notice",
					summary: effect.stepLabel,
				},
			}),
		);
		await this.agent.whenIdle();
	}

	async dispatchSubagent(
		effect: Extract<WorkflowEffect, { type: "subagent" }>,
		signal?: AbortSignal,
	): Promise<SubagentDispatchResult> {
		const provider = effect.config.provider ?? "spawn";

		const subagentSignal = signal ?? new AbortController().signal;
		const activation = await this.ctx.subagents.startActivation({
			provider,
			label: effect.stepLabel,
			delivery: "caller",
			signal: subagentSignal,
			parent: this.agent,
			prompt: [{ type: "text", text: effect.promptText }],
			...(effect.config.preset ? { agentPreset: effect.config.preset } : {}),
			...(effect.config.llmProvider ||
			effect.config.model ||
			effect.config.thinking
				? {
						agentOptions: {
							...(effect.config.llmProvider
								? { provider: effect.config.llmProvider }
								: {}),
							...(effect.config.model ? { model: effect.config.model } : {}),
							...(effect.config.thinking
								? {
										reasoningEffort: ReasoningEffortId(effect.config.thinking),
									}
								: {}),
						},
					}
				: {}),
			...(effect.outputSchema ? { outputSchema: effect.outputSchema } : {}),
		});

		const result = await activation.result;
		if (result.stopReason === "aborted") {
			this.activeAbortController?.abort({ kind: "pause" });
		}
		const outputText = result.output
			.filter(
				(block): block is { type: "text"; text: string } =>
					block.type === "text" && Boolean(block.text),
			)
			.map((block) => block.text)
			.join("\n")
			.trim();

		return {
			outputText,
			structured: result.structured,
		};
	}

	async validateSubagentRoute(
		config: SubagentConfig,
		signal?: AbortSignal,
	): Promise<
		| { readonly valid: true }
		| { readonly valid: false; readonly message: string }
	> {
		const provider = config.provider ?? "spawn";
		const subagentProvider = this.ctx.subagents.getProvider(provider);
		if (!subagentProvider) {
			return {
				valid: false,
				message: `Subagent provider '${provider}' is not registered`,
			};
		}

		if (config.preset) {
			if (
				!subagentProvider.capabilities.agentPreset ||
				subagentProvider.inheritsParentContext
			) {
				return {
					valid: false,
					message: `Subagent provider '${provider}' does not support independent agent preset selection`,
				};
			}
			const presets = this.ctx.get("agentPresets");
			if (!presets) {
				return {
					valid: false,
					message: `Cannot validate agent preset '${config.preset}': 'agentPresets' service is unavailable`,
				};
			}
			try {
				await presets.readDocument(config.preset);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					valid: false,
					message: `Agent preset '${config.preset}' not found: ${message}`,
				};
			}
		}

		if (config.llmProvider || config.model || config.thinking) {
			if (!subagentProvider.capabilities.agentOptions) {
				return {
					valid: false,
					message: `Subagent provider '${provider}' does not support custom model options (agentOptions: false)`,
				};
			}

			const llm = this.ctx.get("llm");
			if (!llm) {
				return {
					valid: false,
					message:
						"Cannot validate subagent model: 'llm' service is unavailable",
				};
			}

			const parentOptions = parentAgentOptionsForDelegation(this.agent);
			const effectiveProvider = config.llmProvider ?? parentOptions.provider;
			const effectiveModel = config.model ?? parentOptions.model;

			if (!effectiveProvider) {
				return {
					valid: false,
					message:
						"Cannot validate subagent model without an effective LLM provider",
				};
			}
			if (!effectiveModel) {
				return {
					valid: false,
					message:
						"Cannot validate subagent model without an effective model ID",
				};
			}

			const availableProviders = llm.listProviders();
			if (!availableProviders.some((p) => p.id === effectiveProvider)) {
				const available =
					availableProviders.map((p) => p.id).join(", ") || "(none)";
				return {
					valid: false,
					message: `LLM provider '${effectiveProvider}' is not registered; available providers: ${available}`,
				};
			}

			try {
				await llm.resolveCallConfig(
					{
						provider: effectiveProvider,
						model: effectiveModel,
						...(config.thinking
							? { reasoningEffort: ReasoningEffortId(config.thinking) }
							: {}),
					},
					signal,
				);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					valid: false,
					message,
				};
			}
		}

		return { valid: true };
	}

	logInfo(message: string): void {
		if (this.log) {
			this.log.info(message);
		}
	}

	resolveOutputPath(filePath: string, base: FileOutputBase): string {
		const cwd = this.agent.session.header.cwd;
		if (!cwd) {
			throw new Error(
				"Session working directory (agent.session.header.cwd) is missing",
			);
		}
		if (base === "workspace") {
			return path.resolve(cwd, filePath);
		}
		return path.resolve(cwd, ".agents/scratch", this.sessionId, filePath);
	}

	async checkFileWritten(resolvedPath: string): Promise<boolean> {
		try {
			const s = await stat(resolvedPath);
			return s.isFile() && s.size > 0;
		} catch (err: unknown) {
			// edge case: a missing path component or non-directory parent means no file.
			if (
				err instanceof Error &&
				"code" in err &&
				(err.code === "ENOENT" || err.code === "ENOTDIR")
			) {
				return false;
			}
			throw err;
		}
	}

	async ensureScratchDirectory(): Promise<string> {
		const cwd = this.agent.session.header.cwd;
		if (!cwd) {
			throw new Error(
				"Session working directory (agent.session.header.cwd) is missing",
			);
		}
		const baseScratchDir = path.resolve(cwd, ".agents/scratch");
		let baseExists = false;
		try {
			const s = await stat(baseScratchDir);
			baseExists = s.isDirectory();
		} catch (err: unknown) {
			if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) {
				throw err;
			}
		}
		if (!baseExists) {
			await mkdir(baseScratchDir, { recursive: true });
			await writeFile(path.join(baseScratchDir, ".gitignore"), "*\n", "utf8");
		}
		const sessionScratchDir = path.resolve(baseScratchDir, this.sessionId);
		await mkdir(sessionScratchDir, { recursive: true });
		return sessionScratchDir;
	}

	appendSessionEvent(
		type: "command/run" | "command/done" | "session/title",
		data:
			| SessionEventMap["command/run"]
			| SessionEventMap["command/done"]
			| SessionEventMap["session/title"],
	): void {
		// smell: Session.append uses generic overloads that cannot be correlated without casting
		(this.agent.session.append as (t: string, d: unknown) => void)(type, data);
	}

	snapshotEvents(): readonly {
		readonly type: string;
		readonly data?: unknown;
	}[] {
		return this.agent.session.snapshotEvents();
	}

	setStatus(status: "running" | "idle"): void {
		this.ctx.emit("agent/status", { agent: this.agent, status });
	}

	whenIdle(): Promise<void> {
		return this.agent.whenIdle();
	}
}

/**
 * Recursively scans directory for workflow files (.yaml and .yml).
 * CONTRACT:
 * - Inputs: base directory path and current directory path.
 * - Outputs: Array of target identifier relative to base and raw file content.
 * - Throws: Re-throws unexpected filesystem errors; returns [] on ENOENT / ENOTDIR.
 */
async function scanWorkflowDirectory(
	baseDir: string,
	currentDir: string,
): Promise<Array<{ readonly target: string; readonly content: string }>> {
	try {
		const entries = await readdir(currentDir, { withFileTypes: true });
		const results: Array<{
			readonly target: string;
			readonly content: string;
		}> = [];
		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				const nested = await scanWorkflowDirectory(baseDir, fullPath);
				results.push(...nested);
			} else if (
				entry.isFile() &&
				(entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
			) {
				const relPath = path.relative(baseDir, fullPath);
				const content = await readFile(fullPath, "utf8");
				results.push({ target: relPath, content });
			}
		}
		return results;
	} catch (err: unknown) {
		const nodeErr = err as NodeJS.ErrnoException;
		if (nodeErr.code === "ENOENT" || nodeErr.code === "ENOTDIR") {
			return [];
		}
		throw err;
	}
}
