/**
 * PURPOSE: Data contracts, Zod schemas, and protocol types for dsh-workflow-runner.
 * ALLOWED: Only type definitions, Zod schemas, and type-level helpers.
 * FORBIDDEN: No I/O, no filesystem, no runtime state, no network, no side effects.
 */

import type { SessionId } from "@deepseek-ai/dsh-session";
import type { JsonSchemaNode, ObjectJsonSchema } from "@deepseek-ai/dsh-tools";
import { z } from "zod";

export type { JsonSchemaNode, ObjectJsonSchema };

export interface SubagentDispatchResult {
	readonly outputText: string;
	readonly structured?: unknown;
}

// --- DSH LLM Message Source Augmentation ---

declare module "@deepseek-ai/dsh-llm" {
	interface MessageSourceMap {
		workflow: {
			readonly kind: "workflow";
			readonly form: "notice";
			readonly summary: string;
		};
	}
}

// --- Workflow YAML Schema (Strict Typing & Discriminated Union) ---

const FlatChoiceMappingSchema = z
	.record(z.string().min(1, "Choice key cannot be empty"), z.string())
	.refine((val) => Object.keys(val).length > 0, {
		message: "Choice mapping cannot be empty",
	});

const NestedChoiceMappingSchema = z
	.record(
		z.string().min(1, "Derived argument name cannot be empty"),
		z
			.record(z.string().min(1, "Choice key cannot be empty"), z.string())
			.refine((val) => Object.keys(val).length > 0, {
				message: "Choice mapping cannot be empty",
			}),
	)
	.refine((val) => Object.keys(val).length > 0, {
		message: "Choice mapping cannot be empty",
	});

export const ChoiceMappingSchema = z.union([
	FlatChoiceMappingSchema,
	NestedChoiceMappingSchema,
]);
export type ChoiceMapping = z.infer<typeof ChoiceMappingSchema>;

export const WorkflowArgSchema = z
	.discriminatedUnion("type", [
		z
			.object({
				type: z.literal("string"),
				description: z.string().optional(),
				default: z.string().optional(),
				required: z.boolean().optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("choice"),
				description: z.string().optional(),
				choices: z
					.array(z.string().min(1, "Choice values cannot be empty"))
					.min(1, "Choice argument must define at least one option"),
				default: z.string().optional(),
				required: z.boolean().optional(),
				mapping: ChoiceMappingSchema.optional(),
				mappings: ChoiceMappingSchema.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("bool"),
				description: z.string().optional(),
				default: z.union([z.boolean(), z.string()]).optional(),
				required: z.boolean().optional(),
			})
			.strict(),
	])
	.refine(
		(data) => {
			if (data.type === "choice" && data.default !== undefined) {
				return data.choices.includes(data.default);
			}
			if (data.type === "bool" && data.default !== undefined) {
				if (typeof data.default === "boolean") return true;
				if (typeof data.default === "string") {
					const lower = data.default.trim().toLowerCase();
					return lower === "true" || lower === "false";
				}
				return false;
			}
			return true;
		},
		{
			message: "Default value must be valid for the specified argument type",
			path: ["default"],
		},
	)
	.refine(
		(data) => {
			if (
				data.type === "choice" &&
				data.mapping !== undefined &&
				data.mappings !== undefined
			) {
				return false;
			}
			return true;
		},
		{
			message: "Cannot specify both 'mapping' and 'mappings'",
			path: ["mappings"],
		},
	);

export type WorkflowArg = z.infer<typeof WorkflowArgSchema>;

export const SubagentConfigSchema = z.object({
	provider: z.string().min(1, "Provider name cannot be empty").optional(),
	llmProvider: z
		.string()
		.min(1, "LLM provider name cannot be empty")
		.optional(),
	preset: z.string().min(1, "Preset name cannot be empty").optional(),
	model: z.string().min(1, "Model name cannot be empty").optional(),
	thinking: z.string().min(1, "Thinking level cannot be empty").optional(),
});

export type SubagentConfig = z.infer<typeof SubagentConfigSchema>;

export const FileOutputBaseSchema = z.enum(["scratch", "workspace"]);
export type FileOutputBase = z.infer<typeof FileOutputBaseSchema>;

export const StepOutputDefSchema = z
	.discriminatedUnion("type", [
		z.object({
			type: z.literal("file"),
			path: z.string().min(1, "File path cannot be empty"),
			base: FileOutputBaseSchema.optional(),
		}),
		z.object({
			type: z.literal("string"),
			description: z.string().optional(),
		}),
		z.object({
			type: z.literal("list"),
			description: z.string().optional(),
			min: z.number().int().nonnegative().optional(),
			max: z.number().int().nonnegative().optional(),
		}),
	])
	.refine(
		(data) => {
			if (data.type === "list") {
				if (
					data.min !== undefined &&
					data.max !== undefined &&
					data.min > data.max
				) {
					return false;
				}
			}
			return true;
		},
		{
			message: "'min' cannot be greater than 'max'",
			path: ["min"],
		},
	);

export type StepOutputDef = z.infer<typeof StepOutputDefSchema>;

export const StepOutputsMapSchema = z.record(
	z.string().min(1, "Output name cannot be empty"),
	StepOutputDefSchema,
);
export type StepOutputsMap = z.infer<typeof StepOutputsMapSchema>;

// --- Workflow File YAML Schema (External Contract) ---
// Note: In YAML file format, subagents are declared via `subagent:` on a prompt step.
// The `kind: "subagent"` step variant is an internal normalized runtime type only,
// produced during preprocessing.
export const WorkflowFileStepSchema = z.union([
	z.string().min(1, "Prompt cannot be empty"),
	z
		.looseObject({
			kind: z.literal("prompt").optional(),
			name: z.string().optional(),
			if: z.string().min(1, "If condition cannot be empty").optional(),
			prompt: z.string().min(1, "Prompt cannot be empty"),
			gate: z
				.union([
					z.boolean(),
					z.string().min(1, "Gate description cannot be empty"),
				])
				.optional(),
			subagent: z
				.union([
					z.boolean(),
					z.string().trim().min(1, "Subagent descriptor cannot be empty"),
					SubagentConfigSchema,
				])
				.optional(),
			foreach: z.string().min(1, "Foreach cannot be empty").optional(),
			outputs: StepOutputsMapSchema.optional(),
			output: z.string().min(1, "Output name cannot be empty").optional(),
		})
		.refine(
			(data) => !(data.output !== undefined && data.outputs !== undefined),
			{ message: "Step cannot declare both 'output' and 'outputs'" },
		)
		.refine(
			(data) =>
				!(
					data.output !== undefined &&
					(data.subagent === undefined || data.subagent === false)
				),
			{ message: "'output' is only allowed on subagent steps" },
		)
		.refine(
			(data) =>
				!(
					data.foreach !== undefined &&
					(data.subagent === undefined || data.subagent === false)
				),
			{ message: "'foreach' is only allowed on subagent steps" },
		)
		.refine(
			(data) => {
				const isSubagent =
					data.subagent !== undefined && data.subagent !== false;
				if (!isSubagent || !data.outputs) return true;
				return Object.values(data.outputs).every((def) => def.type !== "list");
			},
			{ message: "Subagent steps cannot declare outputs of type 'list'" },
		)
		.refine(
			(data) => {
				const isForeachSubagent =
					data.foreach !== undefined &&
					data.subagent !== undefined &&
					data.subagent !== false;
				if (!isForeachSubagent || !data.outputs) return true;
				return Object.values(data.outputs).every(
					(def) => def.type === "string",
				);
			},
			{ message: "Foreach subagent steps only support string outputs" },
		),
	z
		.looseObject({
			kind: z.literal("print").optional(),
			name: z.string().optional(),
			if: z.string().min(1, "If condition cannot be empty").optional(),
			text: z.string().min(1, "Text cannot be empty"),
		})
		.refine((data) => !("output" in data && data.output !== undefined), {
			message: "'output' is only allowed on subagent steps",
		})
		.refine((data) => !("foreach" in data && data.foreach !== undefined), {
			message: "'foreach' is only allowed on subagent steps",
		}),
	z
		.looseObject({
			name: z.string().optional(),
			if: z.string().min(1, "If condition cannot be empty").optional(),
			print: z.string().min(1, "Text cannot be empty"),
		})
		.refine((data) => !("output" in data && data.output !== undefined), {
			message: "'output' is only allowed on subagent steps",
		})
		.refine((data) => !("foreach" in data && data.foreach !== undefined), {
			message: "'foreach' is only allowed on subagent steps",
		}),
	z
		.looseObject({
			name: z.string().optional(),
			if: z.string().min(1, "If condition cannot be empty").optional(),
			gate: z.union([
				z.boolean(),
				z.string().min(1, "Gate description cannot be empty"),
			]),
			outputs: StepOutputsMapSchema.optional(),
		})
		.refine(
			(data) =>
				!("output" in data && data.output !== undefined) &&
				!("prompt" in data && data.prompt !== undefined),
			{
				message: "'output' is only allowed on subagent steps",
			},
		)
		.refine((data) => !("foreach" in data && data.foreach !== undefined), {
			message: "'foreach' is only allowed on subagent steps",
		}),
]);

export type WorkflowFileStep = z.infer<typeof WorkflowFileStepSchema>;

export const WorkflowFileSchema = z
	.object({
		name: z.string().optional(),
		title: z.string().optional(),
		description: z.string().optional(),
		args: z.record(z.string(), WorkflowArgSchema).optional(),
		steps: z
			.array(WorkflowFileStepSchema)
			.min(1, "Workflow must contain at least one step"),
	})
	.strict();

export type WorkflowFile = z.infer<typeof WorkflowFileSchema>;

// --- Preprocessed Workflow Types (Internal Runtime Model) ---

export type WorkflowStepOutputDef =
	| {
			readonly type: "file";
			readonly path: string;
			readonly base: FileOutputBase;
	  }
	| {
			readonly type: "string";
			readonly description?: string;
	  }
	| {
			readonly type: "list";
			readonly description?: string;
			readonly min?: number;
			readonly max?: number;
	  };

export type WorkflowStepOutputsMap = Record<string, WorkflowStepOutputDef>;

export type WorkflowStep =
	| {
			readonly kind: "prompt";
			readonly name: string;
			readonly if?: string;
			readonly prompt: string;
			readonly gate?: string | boolean;
			readonly isSoloGate?: boolean;
			readonly outputs?: WorkflowStepOutputsMap;
	  }
	| {
			readonly kind: "subagent";
			readonly name: string;
			readonly if?: string;
			readonly prompt: string;
			readonly config: SubagentConfig;
			readonly rawSubagent?: string;
			readonly foreach?: string;
			readonly gate?: string | boolean;
			readonly outputs?: WorkflowStepOutputsMap;
			readonly output?: string;
	  }
	| {
			readonly kind: "print";
			readonly name: string;
			readonly if?: string;
			readonly text: string;
	  };

export interface WorkflowDocument {
	readonly name?: string;
	readonly title?: string;
	readonly description?: string;
	readonly args: Record<string, WorkflowArg>;
	readonly steps: readonly WorkflowStep[];
}

// --- Workflow Invocation & Dynamic State ---

export interface WorkflowInvocation {
	readonly targetPath: string;
	readonly runId: string;
	// edge case: historical initialization events did not record the original input.
	readonly rawInput?: string;
	readonly resolvedArgs: Record<string, string>;
}

export const WorkflowStatusSchema = z.enum([
	"running",
	"paused",
	"aborted",
	"completed",
]);

export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const workflowRunSummarySchema = z.object({
	status: z.enum(["idle", "running", "paused", "aborted", "completed"]),
	runId: z.string().optional(),
	stepIndex: z.number().int().nonnegative().optional(),
	skillInvoked: z.boolean().default(false),
});

export type WorkflowRunSummary = z.infer<typeof workflowRunSummarySchema>;

export const WorkflowStateSchema = z.object({
	stepIndex: z.number().int().nonnegative(),
	status: WorkflowStatusSchema,
	pauseReason: z.enum(["gate", "interrupted"]).optional(),
	outputs: z
		.record(z.string(), z.union([z.string(), z.array(z.string()).readonly()]))
		.readonly()
		.optional(),
	error: z.string().optional(),
});

export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export interface WorkflowRun {
	readonly workflow: WorkflowDocument;
	readonly invocation: WorkflowInvocation;
	readonly state: WorkflowState;
}

export type WorkflowFoldResult = WorkflowRun;

// --- Workflow Command Payloads (Strict Typing & Discriminated Union) ---

export interface WorkflowInitPayloadData {
	readonly workflow: WorkflowDocument;
	readonly invocation: WorkflowInvocation;
	readonly sessionId: SessionId;
	readonly runId: string;
}

export type WorkflowStatePayloadData = Partial<WorkflowState> & {
	readonly sessionId: SessionId;
	readonly runId: string;
};

export interface WorkflowStepPayloadData {
	readonly id: string;
	readonly stepIndex: number;
	readonly label: string;
	readonly kind: "success" | "error";
	readonly sessionId: SessionId;
	readonly runId: string;
}

export interface WorkflowPrintPayloadData {
	readonly id: string;
	readonly text: string;
	readonly sessionId: SessionId;
	readonly runId: string;
}

export interface WorkflowOutputPayloadData {
	readonly stepIndex: number;
	readonly name: string;
	readonly value: string;
	readonly outputType: "file" | "string" | "list";
	readonly base?: FileOutputBase;
	readonly sessionId: SessionId;
	readonly runId: string;
}

export { WORKFLOW_EVENT_NAME } from "./fold.ts";

export type WorkflowPayload =
	| {
			readonly action: "request";
			readonly rawInput: string;
			readonly sessionId: SessionId;
			readonly runId: string;
	  }
	| {
			readonly action: "request-failed";
			readonly sessionId: SessionId;
			readonly runId: string;
	  }
	| ({ readonly action: "init" } & WorkflowInitPayloadData)
	| ({ readonly action: "state" } & WorkflowStatePayloadData)
	| ({ readonly action: "step" } & WorkflowStepPayloadData)
	| ({ readonly action: "print" } & WorkflowPrintPayloadData)
	| ({ readonly action: "output" } & WorkflowOutputPayloadData);

export interface ParsedInvocation {
	readonly targetPath: string;
	readonly explicitArgs: Record<string, string>;
	readonly implicitInstructions: string;
}

export interface FormatStepPromptOutputRequirement {
	readonly name: string;
	readonly type: "file" | "string" | "list";
	readonly resolvedPath?: string;
	readonly description?: string;
	readonly min?: number;
	readonly max?: number;
}

export interface FormatStepPromptOptions {
	readonly stepIndex: number;
	readonly totalSteps: number;
	readonly stepName: string;
	readonly workflowName?: string;
	readonly prompt: string;
	readonly isResumedStep: boolean;
	readonly instructions?: string;
	readonly outputRequirements?: readonly FormatStepPromptOutputRequirement[];
}

export type WorkflowEffect =
	| {
			readonly type: "prompt";
			readonly promptText: string;
			readonly stepLabel: string;
			readonly gate?: string;
			readonly outputs?: WorkflowStepOutputsMap;
	  }
	| {
			readonly type: "subagent";
			readonly promptText: string;
			readonly stepLabel: string;
			readonly config: SubagentConfig;
			readonly foreach?: string;
			readonly gate?: string;
			readonly outputs?: WorkflowStepOutputsMap;
			readonly output?: string;
			readonly outputSchema?: ObjectJsonSchema;
			readonly resolvedOutputPaths?: Record<string, string>;
	  }
	| {
			readonly type: "print";
			readonly text: string;
			readonly stepLabel: string;
	  }
	| {
			readonly type: "gate_pause";
			readonly gate: string;
			readonly stepLabel: string;
	  }
	| {
			readonly type: "step_pause";
			readonly stepIndex: number;
			readonly stepLabel: string;
	  }
	| {
			readonly type: "abort";
			readonly stepIndex: number;
			readonly totalSteps: number;
			readonly isAfter: boolean;
	  }
	| {
			readonly type: "skip";
			readonly stepIndex: number;
			readonly stepLabel: string;
	  }
	| {
			readonly type: "complete";
			readonly totalSteps: number;
	  };

export interface TransitionResult {
	readonly nextState: WorkflowState;
	readonly effect: WorkflowEffect;
}

export interface WorkflowParamSummary {
	readonly name: string;
	readonly description?: string;
	readonly type: "string" | "choice" | "bool";
	readonly required: boolean;
	readonly default?: string;
	readonly choices?: readonly string[];
}

export interface WorkflowSummary {
	readonly target: string;
	readonly name?: string;
	readonly description?: string;
	readonly params: readonly WorkflowParamSummary[];
}

export interface WorkflowGroup {
	readonly title: string;
	readonly workflows: readonly WorkflowSummary[];
}

declare module "@deepseek-ai/dsh-session-projection/types" {
	interface SessionProjectionMap {
		workflow: WorkflowRunSummary | null;
	}
}

declare module "@deepseek-ai/dsh-session-projection" {
	interface SessionProjectionMap {
		workflow: WorkflowRunSummary | null;
	}
}
