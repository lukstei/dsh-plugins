import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import type {
	CommandDefinition,
	CommandExecution,
} from "@deepseek-ai/dsh-commands";
import { CommandId } from "@deepseek-ai/dsh-commands";
import { Session } from "@deepseek-ai/dsh-session";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ProjectionDefinition } from "@deepseek-ai/dsh-session-projection";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { expect, test, vi } from "vitest";
import { foldKanbanState } from "../src/fold.ts";
import { apply, Config, type KanbanState } from "../src/index.ts";

const link = { label: "Issue", url: "https://jira.example/ABC-1", priority: 0 };

async function setup(config: Config = Config({})) {
	const ctx = new Context();
	let tool: ToolDefinition | undefined;
	let command: CommandDefinition | undefined;
	let projection: ProjectionDefinition<"kanban", KanbanState> | undefined;
	const session = Session.create("s-links" as SessionId);
	const execute = vi.fn(
		async (
			agent: NonNullable<ToolRunContext["agent"]>,
			line: string,
			_attachments: readonly unknown[],
			signal: AbortSignal,
		): Promise<CommandExecution> => {
			signal.throwIfAborted();
			assert(command);
			const args = line.slice("/kanban ".length);
			const commandId = CommandId("links-1");
			agent.session.append("command/run", {
				commandId,
				name: "kanban",
				args,
				source: { kind: "user" },
			});
			const result = await command.handler({
				agent,
				rawInput: args,
				commandId,
				attachments: [],
				signal,
			});
			return { commandId, result };
		},
	);
	ctx.provide("commands", {
		register: (value: CommandDefinition) => {
			command = value;
		},
		execute,
	});
	ctx.provide("tools", {
		register: (value: ToolDefinition) => {
			tool = value;
		},
	});
	ctx.provide("sessionProjections", {
		register: (value: ProjectionDefinition<"kanban", KanbanState>) => {
			projection = value;
			return Promise.resolve({
				stateOf: (target: Session) =>
					foldKanbanState(target.header, target.snapshotEvents()),
				readerFor: (target: Session) => () =>
					foldKanbanState(target.header, target.snapshotEvents()),
				dispose: async () => {},
			});
		},
		stateOf: (target: Session) =>
			foldKanbanState(target.header, target.snapshotEvents()),
	});
	await apply(ctx, config);
	assert(tool);
	assert(projection);
	// edge case: the fixture supplies the session and execution identity consumed by this tool
	const exec = {
		agent: { session },
		signal: new AbortController().signal,
	} as ToolRunContext;
	return { tool, command, projection, session, exec, execute };
}

test("persists explicit Review placement through checkpoints and wire views", async () => {
	const { projection, session } = await setup();
	const state = foldKanbanState(session.header, [
		{
			type: "command/run",
			data: {
				name: "kanban",
				args: JSON.stringify({ action: "init", createdAt: 2000 }),
			},
		},
		{
			type: "command/run",
			data: {
				name: "kanban",
				args: JSON.stringify({ action: "unhold", unheldAt: 3000 }),
			},
		},
	]);
	const checkpoint = projection.stateSchema.parse(
		JSON.parse(JSON.stringify(state)),
	);
	expect(checkpoint).toMatchObject({ reviewAt: 3000 });
	assert(projection.wire);
	expect(
		projection.wire.viewSchema.parse(projection.wire.view(checkpoint)),
	).toEqual({
		sessionId: session.id,
		createdAt: 2000,
		links: [],
		reviewAt: 3000,
	});
});

test("registers a current-session tool and replays its canonical command events", async () => {
	const { tool, projection, session, exec, execute } = await setup();
	expect(tool.name).toBe("kanban_add_link");
	expect(tool.parameters.properties).toEqual({
		label: expect.anything(),
		url: expect.anything(),
		priority: { type: "number", default: 0, description: expect.any(String) },
	});
	expect(
		await tool.execute({ url: link.url, label: "  Issue  " }, exec),
	).toEqual(link);
	expect(execute).toHaveBeenCalledWith(
		exec.agent,
		`/kanban ${JSON.stringify({ action: "add-link", ...link })}`,
		[],
		exec.signal,
	);
	const events = session.snapshotEvents();
	const state = events.reduce<KanbanState>(
		(s, e) => projection.apply(s, e),
		projection.init(session.header, session.inheritedEventCount),
	);
	expect(state.links).toEqual([link]);
	expect(state.initialized).toBe(false);
	expect(projection.stateVersion).toBe(12);
	const checkpoint = projection.stateSchema.parse(
		JSON.parse(JSON.stringify(state)),
	);
	assert(projection.wire);
	expect(
		projection.wire.viewSchema.parse(
			projection.wire.view({ ...checkpoint, initialized: true }),
		),
	).toEqual({
		sessionId: session.id,
		createdAt: session.header.createdAt,
		links: [link],
	});
	const other = Session.create("other" as SessionId);
	expect(foldKanbanState(other.header, other.snapshotEvents()).links).toEqual(
		[],
	);
});

test("config defaults enable the tool with the requested instructions", async () => {
	const config = Config(undefined);
	expect(Config({})).toEqual(config);
	expect(config).toEqual({
		kanban_add_link_tool_enabled: true,
		kanban_add_link_tool_instructions:
			'Collect important links relevant to the session. Keep link labels concise and unambiguous. Give links directly related to the task negative priorities; give supporting context links zero or positive priorities. For context links, briefly explain their relevance in the label. Examples: "Task PR: jackwener/OpenCLI #32", "Task Ticket: EXAMPLE-2", "EXAMPLE-333: Acceptance criteria".',
	});
	expect((await setup()).tool.description).toContain(
		config.kanban_add_link_tool_instructions,
	);
	expect(() =>
		Config({
			kanban_add_link_tool_enabled: "true" as unknown as boolean,
		}),
	).toThrow();
	expect(() =>
		Config({
			kanban_add_link_tool_instructions: 42 as unknown as string,
		}),
	).toThrow();
});

test("custom instructions replace the instruction text in tool discovery", async () => {
	const config = Config({
		kanban_add_link_tool_instructions: "Collect only task reviews.",
	});
	const { tool } = await setup(config);
	expect(tool.description).toContain(config.kanban_add_link_tool_instructions);
	expect(tool.description).not.toContain(
		Config({}).kanban_add_link_tool_instructions,
	);
});

test("disabled link tool leaves commands and projections registered", async () => {
	const ctx = new Context();
	const tools = vi.fn();
	const commands = vi.fn();
	const projections = vi.fn(() =>
		Promise.resolve({
			stateOf: () => ({ initialized: true, deleted: false }),
			dispose: async () => {},
		}),
	);
	ctx.provide("tools", { register: tools });
	ctx.provide("commands", { register: commands });
	ctx.provide("sessionProjections", { register: projections });
	await apply(ctx, Config({ kanban_add_link_tool_enabled: false }));
	expect(tools).not.toHaveBeenCalled();
	expect(commands).toHaveBeenCalledOnce();
	expect(projections).toHaveBeenCalledOnce();
});

test("tool writes and returns explicit priority, rejecting invalid priority before dispatch", async () => {
	const { tool, exec, session, execute } = await setup();
	expect(await tool.execute({ ...link, priority: -5 }, exec)).toEqual({
		...link,
		priority: -5,
	});
	expect(
		foldKanbanState(session.header, session.snapshotEvents()).links,
	).toEqual([{ ...link, priority: -5 }]);
	execute.mockClear();
	await expect(
		tool.execute({ ...link, priority: "high" }, exec),
	).rejects.toThrow();
	expect(execute).not.toHaveBeenCalled();
});

test.each([
	{ label: " ", url: link.url },
	{ label: "Issue", url: "javascript:alert(1)" },
	{ label: "Issue", url: "/relative" },
	{ label: 42, url: link.url },
])("invalid input writes no events: %j", async (input) => {
	const { tool, exec, session, execute } = await setup();
	await expect(tool.execute(input, exec)).rejects.toThrow();
	expect(execute).not.toHaveBeenCalled();
	expect(session.snapshotEvents()).toEqual([]);
});

test("requires a caller, respects cancellation, and propagates dispatch failures", async () => {
	const { tool, exec, execute } = await setup();
	const { agent: _, ...standalone } = exec;
	await expect(tool.execute(link, standalone)).rejects.toThrow(
		"requires a caller",
	);
	await expect(
		tool.execute(link, { ...exec, signal: AbortSignal.abort() }),
	).rejects.toThrow();
	expect(execute).not.toHaveBeenCalled();
	execute.mockRejectedValueOnce(new Error("dispatch failed"));
	await expect(tool.execute(link, exec)).rejects.toThrow("dispatch failed");
	execute.mockResolvedValueOnce({
		commandId: CommandId("failed"),
		result: { kind: "error", text: "command rejected" },
	});
	await expect(tool.execute(link, exec)).rejects.toThrow("command rejected");
});

test("rejects link collection for deleted records before dispatch", async () => {
	const { tool, exec, session, execute } = await setup();
	for (const payload of [
		{ action: "init", createdAt: 1000 },
		{ action: "delete", deletedAt: 2000 },
	]) {
		session.append("command/run", {
			commandId: CommandId(payload.action),
			name: "kanban",
			args: JSON.stringify(payload),
			source: { kind: "user" },
		});
	}
	await expect(tool.execute(link, exec)).rejects.toThrow("deleted Kanban task");
	expect(execute).not.toHaveBeenCalled();
});

test("kanban command handler enables session with empty input", async () => {
	const { command, exec } = await setup();
	assert(command);
	assert(exec.agent);
	const res = await command.handler({
		agent: exec.agent,
		rawInput: "",
		commandId: CommandId("c-1"),
		attachments: [],
		signal: new AbortController().signal,
	});
	expect(res).toEqual({
		kind: "success",
		text: "Session enabled in Kanban",
	});
});

test("kanban command handler enables session with whitespace input", async () => {
	const { command, exec } = await setup();
	assert(command);
	assert(exec.agent);
	const res = await command.handler({
		agent: exec.agent,
		rawInput: "   ",
		commandId: CommandId("c-2"),
		attachments: [],
		signal: new AbortController().signal,
	});
	expect(res).toEqual({
		kind: "success",
		text: "Session enabled in Kanban",
	});
});
