/**
 * PURPOSE: Behavioral in-memory stateful test runner implementing WorkflowEffectContext.
 * ALLOWED: Pure in-memory virtual files, event logs, prompt/subagent dispatch recording, behavioral hooks.
 * FORBIDDEN: No filesystem access, no network, no external Cordis services.
 */

import type { SessionEventMap } from "@deepseek-ai/dsh-session";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { WorkflowEffectContext } from "../effects.ts";
import { foldWorkflowState } from "../fold.ts";
import type {
	FileOutputBase,
	SubagentConfig,
	SubagentDispatchResult,
	WorkflowEffect,
	WorkflowRun,
} from "../types.ts";
import type {
	DispatchedSubagentInvocation,
	WorkflowRunnerBehavior,
} from "./types.ts";

export interface WorkflowTestRunnerOptions {
	readonly sessionId?: string;
	readonly behavior?: WorkflowRunnerBehavior;
	readonly abortController?: AbortController;
}

/**
 * PURPOSE: Stateful in-memory execution harness for workflow testing with configurable behavior.
 * CONTRACT:
 * - Records all session events, prompts, prints, and subagents in memory.
 * - Enables stateful derivation via foldWorkflowState without mocking.
 * - Simulates runtime conditions (interruptions, failures, busy states) via declarative behavior.
 */
export class WorkflowTestRunner extends WorkflowEffectContext {
	readonly sessionId: SessionId;
	readonly behavior: WorkflowRunnerBehavior;
	abortController: AbortController;

	resetAbortController(): void {
		this.abortController = new AbortController();
	}

	watchAbort(controller: AbortController): () => void {
		const onAbort = () => {
			const reason =
				this.abortController.signal.reason !== undefined
					? this.abortController.signal.reason
					: { kind: "pause" };
			controller.abort(reason);
		};
		if (this.abortController.signal.aborted) {
			onAbort();
		} else {
			this.abortController.signal.addEventListener("abort", onAbort, {
				once: true,
			});
		}
		return () => {
			this.abortController.signal.removeEventListener("abort", onAbort);
		};
	}

	readonly events: Array<{ readonly type: string; readonly data?: unknown }> =
		[];
	readonly dispatchedPrompts: Array<
		Extract<WorkflowEffect, { type: "prompt" }>
	> = [];
	readonly dispatchedSubagents: Array<DispatchedSubagentInvocation> = [];
	readonly printedTexts: Array<string> = [];
	readonly directories = new Set<string>();

	private readonly files = new Map<string, string>();
	private promptCount = 0;
	private subagentCount = 0;

	busy = false;
	private whenIdleResolvers: Array<() => void> = [];

	onPrompt?: (
		effect: Extract<WorkflowEffect, { type: "prompt" }>,
		runner: WorkflowTestRunner,
	) => void | Promise<void>;

	onSubagent?: (
		effect: Extract<WorkflowEffect, { type: "subagent" }>,
		signal: AbortSignal | undefined,
		runner: WorkflowTestRunner,
	) =>
		| string
		| SubagentDispatchResult
		| undefined
		| Promise<string | SubagentDispatchResult | undefined>;

	constructor(options?: WorkflowTestRunnerOptions) {
		super();
		this.behavior = options?.behavior ?? {};
		this.sessionId = (
			this.behavior.missingSessionId
				? ""
				: (options?.sessionId ?? "test-session")
		) as SessionId;
		this.abortController = options?.abortController ?? new AbortController();

		if (this.behavior.initialEvents) {
			for (const evt of this.behavior.initialEvents) {
				this.events.push(evt);
			}
		}

		if (this.behavior.agent?.initiallyBusy) {
			this.busy = true;
			if (this.behavior.agent.resolveBusyAfterMs !== undefined) {
				setTimeout(
					() => this.resolveIdle(),
					this.behavior.agent.resolveBusyAfterMs,
				);
			}
		}

		if (this.behavior.agent?.preExistingTitle) {
			this.setTitle(this.behavior.agent.preExistingTitle);
		}
	}

	/**
	 * Registers a virtual workflow file in memory.
	 * CONTRACT:
	 * - Inputs: target path and YAML content string.
	 * - Returns this instance for chaining.
	 */
	registerWorkflow(targetPath: string, content: string): this {
		this.files.set(targetPath, content);
		return this;
	}

	writeFile(filePath: string, content: string): void {
		this.files.set(filePath, content);
	}

	readFile(filePath: string): string | undefined {
		return this.files.get(filePath);
	}

	hasDirectory(dir: string): boolean {
		return this.directories.has(dir);
	}

	/**
	 * Resolves a workflow target path or well-known name to an existing workflow file path.
	 * CONTRACT:
	 * - Inputs: targetPath string.
	 * - Outputs: Promise resolving to the matching virtual file path key.
	 * - Throws: Error when workflow file cannot be resolved.
	 */
	async resolveWorkflowFile(targetPath: string): Promise<string> {
		const basePaths = [
			targetPath,
			`.agents/wf/${targetPath}`,
			`~/.agents/wf/${targetPath}`,
		];
		const hasExt = targetPath.endsWith(".yaml") || targetPath.endsWith(".yml");
		for (const base of basePaths) {
			const candidates = hasExt
				? [base]
				: [base, `${base}.yaml`, `${base}.yml`];
			for (const candidate of candidates) {
				if (this.files.has(candidate)) {
					return candidate;
				}
			}
		}
		throw new Error(`File not found: '${targetPath}'`);
	}

	async readWorkflow(targetPath: string): Promise<string> {
		const resolvedPath = await this.resolveWorkflowFile(targetPath);
		const content = this.files.get(resolvedPath);
		if (content === undefined) {
			// smell: unreachable defensive fallback if resolveWorkflowFile returned a key
			throw new Error(`File not found: '${targetPath}'`);
		}
		return content;
	}

	async listWorkflowFiles(
		scope: "local" | "common",
	): Promise<
		ReadonlyArray<{ readonly target: string; readonly content: string }>
	> {
		const prefix = scope === "local" ? ".agents/wf/" : "~/.agents/wf/";
		const results: Array<{
			readonly target: string;
			readonly content: string;
		}> = [];
		for (const [filePath, content] of this.files) {
			if (
				filePath.startsWith(prefix) &&
				(filePath.endsWith(".yaml") || filePath.endsWith(".yml"))
			) {
				results.push({
					target: filePath.slice(prefix.length),
					content,
				});
			}
		}
		return results.sort((a, b) => a.target.localeCompare(b.target));
	}

	resolveOutputPath(filePath: string, base: FileOutputBase): string {
		if (base === "workspace") {
			return filePath;
		}
		return `.agents/scratch/${this.sessionId}/${filePath}`;
	}

	async checkFileWritten(resolvedPath: string): Promise<boolean> {
		if (this.behavior.abortBeforeComplete) {
			this.abortController.abort();
		}
		const content = this.files.get(resolvedPath);
		return content !== undefined && content.length > 0;
	}

	async ensureScratchDirectory(): Promise<string> {
		const baseScratchDir = ".agents/scratch";
		const gitignorePath = ".agents/scratch/.gitignore";
		if (!this.directories.has(baseScratchDir)) {
			this.directories.add(baseScratchDir);
			this.files.set(gitignorePath, "*\n");
		}
		const sessionScratchDir = `.agents/scratch/${this.sessionId}`;
		this.directories.add(sessionScratchDir);
		return sessionScratchDir;
	}

	async dispatchPrompt(
		effect: Extract<WorkflowEffect, { type: "prompt" }>,
	): Promise<void> {
		const currentIndex = this.promptCount++;
		this.dispatchedPrompts.push(effect);

		const interruption = this.behavior.promptInterruption;
		if (interruption?.stepIndex === currentIndex) {
			if (interruption.pause) {
				this.abortController.abort({ kind: "pause" });
			}
			if (interruption.abort) {
				this.abortController.abort();
			}
			if (interruption.error) {
				throw new Error(interruption.error);
			}
		}

		if (this.behavior.outputs) {
			const stepMatch = effect.stepLabel.match(/^Step (\d+)/);
			const activeStepIndex = stepMatch
				? Number(stepMatch[1]) - 1
				: currentIndex;
			const retryMatch = effect.stepLabel.match(/Output Retry (\d+)\/3/);
			const currentAttempt = retryMatch ? Number(retryMatch[1]) + 1 : 1;
			for (const sim of this.behavior.outputs) {
				const matchStep =
					sim.stepIndex === undefined || sim.stepIndex === activeStepIndex;
				const matchAttempt =
					sim.attempt === undefined || sim.attempt === currentAttempt;
				if (matchStep && matchAttempt) {
					const currentRun = this.getLatestRun();
					if (!currentRun) {
						throw new Error(
							"Cannot simulate output: no active workflow run found",
						);
					}
					const activeRunId = currentRun.invocation.runId;
					if (sim.file) {
						const resolved = this.resolveOutputPath(
							sim.file.path,
							sim.file.base ?? "scratch",
						);
						this.writeFile(resolved, sim.file.content);
					}
					if (sim.string) {
						this.recordOutput(
							activeStepIndex,
							sim.string.name,
							sim.string.value,
							"string",
							undefined,
							activeRunId,
						);
					}
					if (sim.list) {
						const val =
							typeof sim.list.value === "string"
								? sim.list.value
								: JSON.stringify(sim.list.value);
						this.recordOutput(
							activeStepIndex,
							sim.list.name,
							val,
							"list",
							undefined,
							activeRunId,
						);
					}
				}
			}
		}

		if (this.onPrompt) {
			await this.onPrompt(effect, this);
		}
	}

	async dispatchSubagent(
		effect: Extract<WorkflowEffect, { type: "subagent" }>,
		signal?: AbortSignal,
	): Promise<SubagentDispatchResult> {
		const currentIndex = this.subagentCount++;
		this.dispatchedSubagents.push({ effect, signal });

		const subagentBehavior = this.behavior.subagent;
		if (subagentBehavior?.abortAtStepIndex === currentIndex) {
			this.abortController.abort();
		}
		if (subagentBehavior?.pauseAtStepIndex === currentIndex) {
			this.abortController.abort({ kind: "pause" });
		}
		if (subagentBehavior?.throwAtStepIndex === currentIndex) {
			throw new Error(
				subagentBehavior.errorMessage ??
					`Simulated subagent error at step ${currentIndex}`,
			);
		}

		if (this.behavior.outputs) {
			const stepMatch = effect.stepLabel.match(/^Step (\d+)/);
			const activeStepIndex = stepMatch
				? Number(stepMatch[1]) - 1
				: currentIndex;
			for (const sim of this.behavior.outputs) {
				const matchStep =
					sim.stepIndex === undefined || sim.stepIndex === activeStepIndex;
				if (matchStep) {
					const currentRun = this.getLatestRun();
					if (!currentRun) {
						throw new Error(
							"Cannot simulate output: no active workflow run found",
						);
					}
					const activeRunId = currentRun.invocation.runId;
					if (sim.file) {
						const resolved = this.resolveOutputPath(
							sim.file.path,
							sim.file.base ?? "workspace",
						);
						this.writeFile(resolved, sim.file.content);
					}
					if (sim.string) {
						this.recordOutput(
							activeStepIndex,
							sim.string.name,
							sim.string.value,
							"string",
							undefined,
							activeRunId,
						);
					}
					if (sim.list) {
						const val =
							typeof sim.list.value === "string"
								? sim.list.value
								: JSON.stringify(sim.list.value);
						this.recordOutput(
							activeStepIndex,
							sim.list.name,
							val,
							"list",
							undefined,
							activeRunId,
						);
					}
				}
			}
		}

		if (this.onSubagent) {
			const result = await this.onSubagent(effect, signal, this);
			if (typeof result === "string") {
				return { outputText: result };
			}
			if (typeof result === "object" && result !== null) {
				return result;
			}
		}

		let outputText = `Mock subagent output for ${effect.stepLabel}`;
		if (subagentBehavior?.outputs) {
			if (effect.stepLabel in subagentBehavior.outputs) {
				outputText = subagentBehavior.outputs[effect.stepLabel];
			} else if (String(currentIndex) in subagentBehavior.outputs) {
				outputText = subagentBehavior.outputs[String(currentIndex)];
			}
		} else if (subagentBehavior?.defaultOutput !== undefined) {
			outputText = subagentBehavior.defaultOutput;
		}

		let structuredResult: Record<string, unknown> | undefined;
		if (subagentBehavior?.structuredOutputs) {
			if (String(currentIndex) in subagentBehavior.structuredOutputs) {
				structuredResult =
					subagentBehavior.structuredOutputs[String(currentIndex)];
			}
		} else if (subagentBehavior && "structured" in subagentBehavior) {
			structuredResult = subagentBehavior.structured as
				| Record<string, unknown>
				| undefined;
		} else if (effect.outputSchema?.properties) {
			structuredResult = {};
			for (const propName of Object.keys(effect.outputSchema.properties)) {
				if (effect.resolvedOutputPaths?.[propName]) {
					structuredResult[propName] = effect.resolvedOutputPaths[propName];
				}
			}
			if (this.behavior.outputs) {
				const stepMatch = effect.stepLabel.match(/^Step (\d+)/);
				const activeStepIndex = stepMatch
					? Number(stepMatch[1]) - 1
					: currentIndex;
				for (const sim of this.behavior.outputs) {
					const matchStep =
						sim.stepIndex === undefined || sim.stepIndex === activeStepIndex;
					if (matchStep && sim.string) {
						structuredResult[sim.string.name] = sim.string.value;
					}
				}
			}
		}

		return {
			outputText,
			structured: structuredResult,
		};
	}

	async validateSubagentRoute(
		config: SubagentConfig,
		signal?: AbortSignal,
	): Promise<
		| { readonly valid: true }
		| { readonly valid: false; readonly message: string }
	> {
		if (this.behavior.subagentRouteValidation) {
			const res = this.behavior.subagentRouteValidation(config, signal);
			if (res !== undefined) {
				return { valid: false, message: res };
			}
		}
		if (config.provider === "invalid-provider") {
			return {
				valid: false,
				message: `Subagent provider '${config.provider}' is not registered`,
			};
		}
		if (config.llmProvider === "invalid-provider") {
			return {
				valid: false,
				message: `LLM provider '${config.llmProvider}' is not registered`,
			};
		}
		if (config.model === "invalid-model") {
			return {
				valid: false,
				message: `Model '${config.model}' is not valid`,
			};
		}
		if (config.thinking === "invalid-thinking") {
			return {
				valid: false,
				message: `Thinking '${config.thinking}' is not supported`,
			};
		}
		return { valid: true };
	}

	emit(event: Parameters<WorkflowEffectContext["emit"]>[0]): void {
		super.emit(event);
		if (event.action === "print") {
			this.printedTexts.push(event.text);
			if (this.behavior.printInterruption?.abort) {
				this.abortController.abort();
			}
			if (this.behavior.printInterruption?.pause) {
				this.abortController.abort({ kind: "pause" });
			}
		}
	}

	logInfo(_message: string): void {}

	private seenCommandIds = new Set<string>();

	appendSessionEvent(
		type: "command/run" | "command/done" | "session/title",
		data:
			| SessionEventMap["command/run"]
			| SessionEventMap["command/done"]
			| SessionEventMap["session/title"],
	): void {
		if (type === "command/run") {
			const cmd = data as SessionEventMap["command/run"];
			if (this.seenCommandIds.has(String(cmd.commandId))) {
				throw new Error(
					`SessionFormatError: command/run repeats commandId ${cmd.commandId}`,
				);
			}
			this.seenCommandIds.add(String(cmd.commandId));
			if (
				this.behavior.abortAfterStepIndex !== undefined &&
				typeof cmd.args === "string"
			) {
				try {
					const parsed = JSON.parse(cmd.args) as {
						action?: string;
						stepIndex?: number;
					};
					if (
						parsed.action === "state" &&
						parsed.stepIndex === this.behavior.abortAfterStepIndex
					) {
						this.abortController.abort();
					}
				} catch {
					// smell: ignored noise event parsing
				}
			}
		}
		this.events.push({ type, data });
	}

	snapshotEvents(): readonly {
		readonly type: string;
		readonly data?: unknown;
	}[] {
		return [...this.events];
	}

	setStatus(_status: "running" | "idle"): void {}

	whenIdle(): Promise<void> {
		if (this.behavior.agent?.whenIdleError) {
			throw new Error(this.behavior.agent.whenIdleError);
		}

		if (this.behavior.agent?.abortWhileBusy && this.busy) {
			this.abortController.abort();
			setImmediate(() => this.resolveIdle());
		}

		if (!this.busy) {
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			this.whenIdleResolvers.push(resolve);
		});
	}

	resolveIdle(): void {
		this.busy = false;
		const resolvers = this.whenIdleResolvers;
		this.whenIdleResolvers = [];
		for (const resolve of resolvers) {
			resolve();
		}
	}

	/**
	 * Reconstructs the current workflow run state from recorded session events.
	 * CONTRACT:
	 * - Uses pure event folding (identical to production resumption).
	 */
	getLatestRun(): WorkflowRun | null {
		return foldWorkflowState(this.events);
	}
}
