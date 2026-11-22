/**
 * PURPOSE: Type contracts for behavioral E2E testing scenarios and execution.
 * CONTRACT: Zero runtime dependencies except pure TypeScript interfaces.
 */

import type { SubagentConfig, WorkflowEffect } from "../types.ts";

export interface PromptInterruptionBehavior {
	readonly stepIndex?: number;
	readonly abort?: boolean;
	readonly pause?: boolean;
	readonly error?: string;
}

export interface SubagentBehavior {
	readonly outputs?: Record<string, string>;
	readonly defaultOutput?: string;
	readonly structured?: Record<string, unknown> | null;
	readonly structuredOutputs?: Record<string, Record<string, unknown>>;
	readonly throwAtStepIndex?: number;
	readonly errorMessage?: string;
	readonly abortAtStepIndex?: number;
	readonly pauseAtStepIndex?: number;
}

export interface PrintInterruptionBehavior {
	readonly abort?: boolean;
	readonly pause?: boolean;
}

export interface AgentBehavior {
	readonly initiallyBusy?: boolean;
	readonly resolveBusyAfterMs?: number;
	readonly abortWhileBusy?: boolean;
	readonly preExistingTitle?: string;
	readonly whenIdleError?: string;
}

export interface OutputSimulation {
	readonly stepIndex?: number;
	readonly attempt?: number;
	readonly file?: {
		readonly path: string;
		readonly content: string;
		readonly base?: "scratch" | "workspace";
	};
	readonly string?: {
		readonly name: string;
		readonly value: string;
	};
	readonly list?: {
		readonly name: string;
		readonly value: string | readonly string[];
	};
}

export interface WorkflowRunnerBehavior {
	readonly promptInterruption?: PromptInterruptionBehavior;
	readonly printInterruption?: PrintInterruptionBehavior;
	readonly abortAfterStepIndex?: number;
	readonly abortBeforeComplete?: boolean;
	readonly subagent?: SubagentBehavior;
	readonly agent?: AgentBehavior;
	readonly initialEvents?: readonly {
		readonly type: string;
		readonly data?: unknown;
	}[];
	readonly missingSessionId?: boolean;
	readonly outputs?: readonly OutputSimulation[];
	readonly subagentRouteValidation?: (
		config: SubagentConfig,
		signal?: AbortSignal,
	) => string | undefined;
}

export interface DispatchedSubagentInvocation {
	readonly effect: Extract<WorkflowEffect, { type: "subagent" }>;
	readonly signal?: AbortSignal;
}

export type ScenarioAction =
	| {
			readonly type: "request";
			readonly targetPath: string;
			readonly runId: string;
	  }
	| {
			readonly type: "write";
			readonly targetPath: string;
			readonly content: string;
	  }
	| { readonly type: "drain" }
	| {
			readonly type: "execute";
			readonly targetPath: string;
			readonly runId?: string;
			readonly abortBeforeStart?: boolean;
			readonly pauseBeforeStart?: boolean;
	  }
	| {
			readonly type: "resume";
			readonly instructions?: string;
			readonly abortBeforeStart?: boolean;
			readonly pauseBeforeStart?: boolean;
	  }
	| {
			readonly type: "discard";
	  };

export interface ExpectedStateAssertion {
	readonly status?: "running" | "paused" | "completed" | "aborted";
	readonly stepIndex?: number;
	readonly pauseReason?: "gate" | "interrupted";
	readonly outputs?: Record<string, string | readonly string[]>;
}

export interface ExpectedEventsAssertion {
	readonly actions?: readonly string[];
	readonly noErrors?: boolean;
	readonly commandCount?: number;
}

export interface ScenarioDefinition {
	readonly sessionId?: string;
	readonly targetPath?: string;
	readonly files?: Record<string, string>;
	readonly resume?: {
		readonly instructions?: string;
	};
	readonly actions?: readonly ScenarioAction[];
	readonly behavior?: WorkflowRunnerBehavior;
	readonly expectedResult?: {
		readonly kind: "success" | "error";
		readonly textPattern?: string;
	};
	readonly expectedState?: ExpectedStateAssertion;
	readonly expectedEvents?: ExpectedEventsAssertion;
}
