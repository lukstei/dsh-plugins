import assert from "node:assert/strict";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import { type Button, Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ComponentProps, MouseEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanIcon } from "../src/client/KanbanIcon.tsx";
import { KanbanStatusDot } from "../src/client/KanbanStatusDot.tsx";
import {
	KanbanTransitionDropdown,
	type KanbanTransitionDropdownProps,
} from "../src/client/KanbanTransitionDropdown.tsx";
import { KANBAN_CSS } from "../src/client/styles.ts";

const ui = vi.hoisted(() => ({
	open: false,
	setOpen: vi.fn(),
	jsx: vi.fn((_type: unknown, _props: unknown) => null),
	session: {
		running: false,
		blank: false,
		pendingSubmissions: [] as unknown[],
	},
	byId: {} as Record<string, SessionSummary>,
}));

vi.mock("react", () => ({
	useState: (initial: unknown) => [
		typeof initial === "boolean" ? ui.open : initial,
		ui.setOpen,
	],
	useMemo: (compute: () => unknown) => compute(),
	useEffect: () => {},
}));

vi.mock("react/jsx-dev-runtime", () => ({
	jsxDEV: (...args: unknown[]) => {
		ui.jsx(args[0], args[1]);
		return { type: args[0], props: args[1] };
	},
	Fragment: Symbol.for("react.fragment"),
}));

vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
	Button: "Button",
	Menu: "Menu",
	IconChevronDownOutlineRegular: "IconChevronDownOutlineRegular",
}));

describe("KanbanTransitionDropdown", () => {
	const sessionId = "sess-1" as SessionId;
	const holdSession = vi.fn(async () => {});
	const unholdSession = vi.fn(async () => {});
	const markDone = vi.fn(async () => {});
	const reopen = vi.fn(async () => {});
	const startPreparedTask = vi.fn(async () => {});

	beforeEach(() => {
		vi.clearAllMocks();
		ui.open = false;
		ui.session.running = false;
		ui.session.blank = false;
		ui.session.pendingSubmissions = [];
		ui.byId = {};
	});

	const renderDropdown = () => {
		const props = {
			sessionId,
			useSession: ((selector: (s: typeof ui.session) => unknown) =>
				selector(ui.session)) as never,
			useSessions: ((selector: (s: { byId: typeof ui.byId }) => unknown) =>
				selector({ byId: ui.byId })) as never,
			holdSession,
			unholdSession,
			markDone,
			reopen,
			startPreparedTask,
		} as unknown as KanbanTransitionDropdownProps;
		return KanbanTransitionDropdown(props);
	};

	it("renders trigger button with KanbanIcon and opens menu on click", () => {
		ui.byId[sessionId] = {
			id: sessionId,
			displayTitle: "Review Task",
			running: false,
			blank: false,
			updatedAt: 1000,
			retainedBy: {},
			projectionValues: {
				kanban: { sessionId, createdAt: 1000, links: [] },
			},
		};

		renderDropdown();

		const iconCall = ui.jsx.mock.calls.find(([type]) => type === KanbanIcon);
		expect(iconCall).toBeDefined();
		expect(iconCall?.[1]).toEqual({ size: 18, strokeWidth: 1 });

		const dotCall = ui.jsx.mock.calls.find(
			([type]) => type === KanbanStatusDot,
		);
		expect(dotCall).toBeDefined();
		expect(dotCall?.[1]).toEqual({ state: "review" });

		const menuCall = ui.jsx.mock.calls.find(([type]) => type === Menu);
		assert(menuCall);
		const menuProps = menuCall[1] as ComponentProps<typeof Menu>;
		expect(menuProps.open).toBe(false);
		expect(menuProps.align).toBe("start");
		expect(menuProps.side).toBe("top");
		expect(menuProps.compact).toBeUndefined();
		expect(menuProps.className).toBe("dsh-kanban-transition-menu");

		// Anchor button
		const anchor = menuProps.anchor as {
			type: string;
			props: ComponentProps<typeof Button>;
		};
		expect(anchor.type).toBe("Button");
		expect(anchor.props.variant).toBe("ghost");
		expect(anchor.props.size).toBe("sm");
		expect(anchor.props.className).toContain("dsh-kanban-input-chip");
		expect(anchor.props["aria-pressed"]).toBe(false);
		expect(anchor.props.title).toContain("Kanban: In Review");
		expect(anchor.props.disabled).toBe(false);

		// Click trigger
		const stopPropagation = vi.fn();
		anchor.props.onClick?.({
			stopPropagation,
		} as unknown as MouseEvent<HTMLButtonElement>);
		expect(stopPropagation).toHaveBeenCalled();
		expect(ui.setOpen).toHaveBeenCalled();
	});

	it("renders nothing for subagent sessions", () => {
		ui.byId[sessionId] = {
			id: sessionId,
			displayTitle: "Child",
			running: false,
			blank: false,
			updatedAt: 1000,
			retainedBy: {},
			origin: "subagent",
			parentId: "parent-1" as SessionId,
		};

		expect(renderDropdown()).toBeNull();
		expect(ui.jsx.mock.calls.find(([type]) => type === Menu)).toBeUndefined();
	});

	it("disables trigger when session is currently running", () => {
		ui.session.running = true;
		ui.byId[sessionId] = {
			id: sessionId,
			displayTitle: "Running Task",
			running: true,
			blank: false,
			updatedAt: 1000,
			retainedBy: {},
		};

		renderDropdown();

		const menuCall = ui.jsx.mock.calls.find(([type]) => type === Menu);
		assert(menuCall);
		const menuProps = menuCall[1] as ComponentProps<typeof Menu>;
		const anchor = menuProps.anchor as {
			type: string;
			props: ComponentProps<typeof Button>;
		};
		expect(anchor.type).toBe("Button");
		expect(anchor.props.disabled).toBe(true);
		expect(anchor.props.title).toBe("Task is in progress");

		const stopPropagation = vi.fn();
		anchor.props.onClick?.({
			stopPropagation,
		} as unknown as MouseEvent<HTMLButtonElement>);
		expect(ui.setOpen).not.toHaveBeenCalled();
	});

	it("provides Done before Hold in Review lane and executes transitions", () => {
		ui.open = true;
		ui.byId[sessionId] = {
			id: sessionId,
			displayTitle: "In Review Task",
			running: false,
			blank: false,
			updatedAt: 1000,
			retainedBy: {},
			projectionValues: {
				kanban: { sessionId, createdAt: 1000, links: [] },
			},
		};

		renderDropdown();

		const menuCall = ui.jsx.mock.calls.find(([type]) => type === Menu);
		assert(menuCall);
		const menuProps = menuCall[1] as ComponentProps<typeof Menu>;
		const itemIds = menuProps.items?.map((item) => item.id);
		expect(itemIds).toEqual(["done", "hold"]);

		// Select hold
		menuProps.onSelect?.("hold");
		expect(holdSession).toHaveBeenCalledWith(sessionId);
		expect(ui.setOpen).toHaveBeenCalledWith(false);

		// Select done
		menuProps.onSelect?.("done");
		expect(markDone).toHaveBeenCalledWith(sessionId);
	});

	it("provides Resume and Done options in To Do lane", () => {
		ui.open = true;
		ui.byId[sessionId] = {
			id: sessionId,
			displayTitle: "Held Task",
			running: false,
			blank: false,
			updatedAt: 1000,
			retainedBy: {},
			projectionValues: {
				kanban: { sessionId, createdAt: 1000, heldAt: 2000, links: [] },
			},
		};

		renderDropdown();

		const menuCall = ui.jsx.mock.calls.find(([type]) => type === Menu);
		assert(menuCall);
		const menuProps = menuCall[1] as ComponentProps<typeof Menu>;
		const itemIds = menuProps.items?.map((item) => item.id);
		expect(itemIds).toEqual(["resume", "done"]);

		menuProps.onSelect?.("resume");
		expect(unholdSession).toHaveBeenCalledWith(sessionId);
	});

	it("provides Reopen and Hold options in Done lane", () => {
		ui.open = true;
		ui.byId[sessionId] = {
			id: sessionId,
			displayTitle: "Completed Task",
			running: false,
			blank: false,
			updatedAt: 1000,
			retainedBy: {},
			projectionValues: {
				kanban: { sessionId, createdAt: 1000, doneAt: 2000, links: [] },
			},
		};

		renderDropdown();

		const dotCall = ui.jsx.mock.calls.find(
			([type]) => type === KanbanStatusDot,
		);
		expect(dotCall).toBeDefined();
		expect(dotCall?.[1]).toEqual({ state: "done" });

		const menuCall = ui.jsx.mock.calls.find(([type]) => type === Menu);
		assert(menuCall);
		const menuProps = menuCall[1] as ComponentProps<typeof Menu>;
		const itemIds = menuProps.items?.map((item) => item.id);
		expect(itemIds).toEqual(["reopen", "hold"]);

		menuProps.onSelect?.("reopen");
		expect(reopen).toHaveBeenCalledWith(sessionId);
	});

	it("styles done indicator dot with muted gray instead of green success color", () => {
		expect(KANBAN_CSS).toContain(".dsh-kanban-badge-dot.is-done");
		expect(KANBAN_CSS).toMatch(
			/\.dsh-kanban-badge-dot\.is-done\s*\{[^}]*background:\s*var\(--dsw-alias-label-tertiary,\s*#94a3b8\);/,
		);
	});
});
