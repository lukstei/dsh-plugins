import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceSnapshot } from "@deepseek-ai/dsh-api-workspace-controller/client";
import {
	Button,
	IconChevronDownOutlineRegular,
	IconCloseOutlineRegular,
	IconFullscreenOutlineRegular,
	IconRightUpOutlineMedium,
	Menu,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { SessionStatusSnapshot } from "@deepseek-ai/dsh-client-ui-session/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { Story } from "@ladle/react";
import type {
	ISplitView,
	SplitState,
} from "@lukstei/dsh-client-split-view/client-contract";
import { useMemo, useState } from "react";
import { SplitPaneHeader } from "../../../../dsh-client-split-view/src/client/SplitPaneHeader.tsx";
import { SPLIT_VIEW_CSS } from "../../../../dsh-client-split-view/src/client/styles.ts";
import type { KanbanLane } from "../../types.ts";
import { InFlightSidebar } from "../InFlightSidebar.tsx";
import { KanbanPaneStatus } from "../KanbanPaneStatus.tsx";
import { KanbanStatusDot } from "../KanbanStatusDot.tsx";
import {
	createMockObservable,
	createMockSession,
	createMockWorkspace,
} from "./fixtures.ts";

export default { title: "Split panes", meta: { nativeTheme: true } };

/**
 * Purpose: Reproduce pane header geometry beside the real Kanban sidebar.
 * Contract:
 * - Inputs: Interactive width, pane, status, and label controls.
 * - Outputs: Production components backed by isolated fixture stores.
 * - Throws / Errors: Component errors remain visible in Ladle.
 */
export const HeaderLayout: Story = () => {
	const [width, setWidth] = useState(1200);
	const [sidebarWidth, setSidebarWidth] = useState(280);
	const [height, setHeight] = useState(400);
	const [overflow, setOverflow] = useState(false);
	const [count, setCount] = useState(2);
	const [focused, setFocused] = useState(0);
	const [long, setLong] = useState(false);
	const [wide, setWide] = useState(true);
	const [guides, setGuides] = useState(true);
	const [lane, setLane] = useState<KanbanLane>("active");
	const [alert, setAlert] = useState(false);
	const [maximized, setMaximized] = useState<SessionId>();
	const [subagentMenu, setSubagentMenu] = useState(-1);
	const [selectedSubagent, setSelectedSubagent] = useState("");
	const sessions = useMemo(
		() => [
			createMockSession(
				"header-1",
				long
					? "Plan fix for tab drag-and-drop scroll reset and preserve all pane state"
					: "Plan fix for tab drag-and-drop scroll reset",
				lane,
			),
			createMockSession("header-2", "Example Search in Vienna", "review"),
			createMockSession("header-3", "Review a subagent's result", "done"),
			...(overflow
				? Array.from({ length: 24 }, (_, i) =>
						createMockSession(
							`overflow-${i}`,
							`Additional task ${i + 1}`,
							"review",
						),
					)
				: []),
		],
		[long, lane, overflow],
	);
	const ids = useMemo(
		() => sessions.slice(0, count).map((s) => s.id),
		[sessions, count],
	);
	const splitState: SplitState = useMemo(
		() => ({
			sessionIds: ids,
			focusedSessionId: ids[focused],
			maximizedSessionId: maximized,
			suspended: false,
			hoveredSessionId: undefined,
			overlays: new Map(),
		}),
		[ids, focused, maximized],
	);
	const stores = useMemo(() => {
		const list: SessionListState = {
			ids: sessions.map((s) => s.id),
			byId: Object.fromEntries(sessions.map((s) => [s.id, s])),
			phase: "ready",
			projectionsBySession: {},
		};
		const workspaces: WorkspaceSnapshot = {
			items: [
				createMockWorkspace(
					"headers",
					long ? "dsh-plugins-with-a-long-workspace-name" : "dsh-plugins",
					"/work/dsh-plugins",
					sessions.map((s) => s.id),
				),
			],
			archivedSessionIds: [],
			pinnedSessionIds: [],
			state: "idle",
			phase: "ready",
			error: null,
		};
		const status: SessionStatusSnapshot = new Map([
			[
				sessions[0].id,
				{
					running: lane === "active",
					completionUnread: false,
					pendingInteraction: alert
						? { kind: "question", key: "preview", sessionId: sessions[0].id }
						: undefined,
				},
			],
		]);
		return {
			sessionsList: createMockObservable(list),
			workspacesList: createMockObservable(workspaces),
			sessionStatus: createMockObservable(status),
		};
	}, [sessions, long, lane, alert]);
	const select = (id: SessionId) => {
		const index = ids.indexOf(id);
		if (index !== -1) setFocused(index);
	};
	const splitView: ISplitView = {
		setFallbackPanelId: () => {},
		openSlotOverlay: () => {},
		closeOverlay: () => {},
		getSnapshot: () => splitState,
		subscribe: () => () => {},
		isSuspended: () => false,
		isSplitActive: () => true,
		setFocus: select,
		openSession: select,
		toggleSession: select,
		removeSession: () => {},
		replaceSession: () => {},
		setHoveredSession: () => {},
		resetToSingle: () => {},
		suspend: () => {},
		resume: () => {},
		toggleMaximize: (id) => setMaximized(maximized === id ? undefined : id),
		reorderSession: () => {},
	};
	const actions = {
		selectPanel: () => {},
		selectSession: select,
		searchSessions: async () => ({
			ok: true as const,
			value: { items: [], hasMore: false },
		}),
		searchResultLimit: 20,
		startTask: async () => {},
		prepareTask: async () => {},
		startPreparedTask: async () => {},
		markDone: async () => {},
		reopen: async () => {},
		deleteSession: async () => {},
		holdSession: async () => {},
		unholdSession: async () => {},
		pinSession: async () => {},
		unpinSession: async () => {},
	};
	return (
		<>
			<style>{SPLIT_VIEW_CSS}</style>
			<style>{`.header-story-controls { display:flex; flex-wrap:wrap; gap:16px; margin-bottom:24px; }
      .header-story { display:flex; border:0.5px solid var(--dsw-alias-border-l3); max-width:100%; }
      .header-story-sidebar { --dsh-sidebar-inline-padding:8px; --dsh-sidebar-row-padding:12px; --dsh-sidebar-label-gap:6px; --dsh-sidebar-paint-inset:3px; flex:none; min-height:0; display:flex; flex-direction:column; padding:6px 8px; box-sizing:border-box; overflow:hidden; background:var(--dsw-specific-sidebar-fill); }
      .header-story-region { flex:1; min-height:0; display:flex; flex-direction:column; margin-left:-4px; margin-right:-8px; padding-left:4px; overflow:hidden; }
      .header-story-sidebar.is-rail { padding:18px 10px 6px; }
      .header-story-sidebar.is-rail .header-story-region { margin:0; padding:0; }
      .header-story-pane { min-width:0; flex:1; background:var(--dsw-alias-bg-base); }
      .header-story.with-guides .dsh-split-header-left { outline:0.5px dashed var(--dsw-alias-label-caption); }
      .header-story.with-guides .dsh-split-pane-status { outline:0.5px solid var(--dsw-alias-state-error-primary); }
      .header-story.with-guides .dsh-split-crumb { outline:0.5px dotted var(--dsw-alias-state-business-primary); }
      .header-story-body { padding:12px; color:var(--dsw-alias-label-secondary); }
    `}</style>
			<div className="header-story-controls">
				<label>
					Width{" "}
					<input
						aria-label="Preview width"
						type="range"
						min="480"
						max="1800"
						value={width}
						onChange={(e) => setWidth(Number(e.target.value))}
					/>{" "}
					{width}px
				</label>
				<label>
					Sidebar width{" "}
					<input
						aria-label="Sidebar width"
						type="number"
						min="200"
						max="400"
						value={sidebarWidth}
						onChange={(e) => setSidebarWidth(Number(e.target.value))}
					/>
				</label>
				<label>
					Height{" "}
					<input
						aria-label="Preview height"
						type="number"
						min="140"
						max="800"
						value={height}
						onChange={(e) => setHeight(Number(e.target.value))}
					/>
				</label>
				<label>
					<input
						type="checkbox"
						checked={overflow}
						onChange={(e) => setOverflow(e.target.checked)}
					/>
					Overflow sessions
				</label>
				<label>
					Panes{" "}
					<select
						value={count}
						onChange={(e) => {
							setCount(Number(e.target.value));
							setFocused(0);
						}}
					>
						<option>1</option>
						<option>2</option>
						<option>3</option>
					</select>
				</label>
				<label>
					Stage{" "}
					<select
						value={lane}
						onChange={(e) => {
							// edge case: every option belongs to the closed KanbanLane union
							setLane(e.target.value as KanbanLane);
						}}
					>
						<option value="active">In Progress</option>
						<option value="review">In Review</option>
						<option value="todo">To Do</option>
						<option value="done">Done</option>
					</select>
				</label>
				<label>
					<input
						type="checkbox"
						checked={alert}
						onChange={(e) => setAlert(e.target.checked)}
					/>
					Alert
				</label>
				<label>
					<input
						type="checkbox"
						checked={long}
						onChange={(e) => setLong(e.target.checked)}
					/>
					Long labels
				</label>
				<label>
					<input
						type="checkbox"
						checked={wide}
						onChange={(e) => setWide(e.target.checked)}
					/>
					Expanded sidebar
				</label>
				<label>
					<input
						type="checkbox"
						checked={guides}
						onChange={(e) => setGuides(e.target.checked)}
					/>
					Guides
				</label>
			</div>
			<div
				className={`header-story ${guides ? "with-guides" : ""}`}
				style={{ width, height }}
			>
				<aside
					className={`header-story-sidebar${wide ? "" : " is-rail"}`}
					style={{ width: wide ? sidebarWidth : 56 }}
				>
					<div className="header-story-region">
						<InFlightSidebar
							wide={wide}
							expandSidebar={() => setWide(true)}
							{...stores}
							{...actions}
							navigation={splitView}
						/>
					</div>
				</aside>
				{sessions.slice(0, count).map((session, index) => (
					<div
						key={session.id}
						className="header-story-pane"
						onPointerDown={() => setFocused(index)}
						onFocus={() => setFocused(index)}
					>
						<SplitPaneHeader
							focused={index === focused}
							status={<KanbanPaneStatus sessionId={session.id} {...stores} />}
							workspaceTitle={
								long ? "dsh-plugins-with-a-long-workspace-name" : "dsh-plugins"
							}
							ancestry={[
								{
									id: session.id,
									displayTitle: session.displayTitle,
									subagent: index === 2,
								},
							]}
							displayTitle={session.displayTitle}
							actions={[
								{
									label: "Maximize pane",
									Icon: IconFullscreenOutlineRegular,
								},
								{ label: "Native view", Icon: IconRightUpOutlineMedium },
								{ label: "Close pane", Icon: IconCloseOutlineRegular },
							].map(({ label, Icon }) => (
								<Button
									key={label}
									variant="ghost"
									size="sm"
									className={`dsh-split-icon-btn${label === "Close pane" ? " dsh-split-pane-close" : ""}`}
									aria-label={label}
									icon={<Icon size={16} />}
								/>
							))}
						>
							{index < 2 && (
								<Menu
									open={subagentMenu === index}
									portal
									compact
									align="start"
									onClose={() => setSubagentMenu(-1)}
									onSelect={(id) => {
										setSelectedSubagent(id);
										setSubagentMenu(-1);
									}}
									items={Array.from(
										{ length: index === 0 ? 1 : 3 },
										(_, i) => ({
											id: `Worker ${i + 1}`,
											label: `Worker ${i + 1}`,
											icon: (
												<KanbanStatusDot
													state={index === 0 ? "active" : "review"}
												/>
											),
										}),
									)}
									anchor={
										<Button
											variant="ghost"
											size="sm"
											className={`dsh-split-subagent-pill ${subagentMenu === index ? "is-active" : ""}`}
											aria-haspopup="menu"
											aria-expanded={subagentMenu === index}
											onClick={() =>
												setSubagentMenu(subagentMenu === index ? -1 : index)
											}
										>
											<KanbanStatusDot
												state={index === 0 ? "active" : "review"}
											/>
											<span className="dsh-split-subagent-text">
												{index === 0 ? "1 subagent" : "3 subagents"}
											</span>
											<IconChevronDownOutlineRegular size={12} />
										</Button>
									}
								/>
							)}
						</SplitPaneHeader>
						<div className="header-story-body">
							{selectedSubagent || "Content inset"}
						</div>
					</div>
				))}
			</div>
		</>
	);
};
