import type { Story } from "@ladle/react";
import { useState } from "react";
import { KanbanCard } from "../KanbanCard.tsx";
import { createMockAlert, createMockSession } from "./fixtures.ts";

export const CardVariants: Story = () => {
	const [selectedId, setSelectedId] = useState<string>("card-1");
	const [pinned, setPinned] = useState(false);

	const cardActive = createMockSession(
		"card-1",
		"feat(auth): Add OAuth2 PKCE callback handler",
		"active",
		{
			running: true,
			prompt: "Implement PKCE auth exchange in auth-service",
		},
	);

	const cardAlertQuestion = createMockSession(
		"card-2",
		"fix(db): Migrate connection pool to pgx",
		"active",
		{
			running: true,
			prompt: "Fix database connection leaks",
		},
	);

	const cardAlertPermission = createMockSession(
		"card-3",
		"deploy(infra): Roll out staging cluster v2",
		"active",
		{
			running: true,
			prompt: "Execute deployment script with infra credentials",
		},
	);

	const cardAlertError = createMockSession(
		"card-4",
		"refactor(core): Decouple session projections",
		"active",
		{
			running: false,
			prompt: "Isolate projection events",
		},
	);

	const cardDone = createMockSession(
		"card-5",
		"docs: Update deployment architecture diagram",
		"done",
		{
			pinned,
			links: [
				{
					label: "PR #142",
					url: "https://github.com/example/repo/pull/142",
					priority: 1,
				},
				{
					label: "Jira DSH-890",
					url: "https://example.com/browse/DSH-890",
					priority: 0,
				},
			],
		},
	);

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "16px",
				maxWidth: "360px",
			}}
		>
			<div>
				<div style={{ fontSize: "11px", opacity: 0.6, marginBottom: "4px" }}>
					1. Active Session (Selected)
				</div>
				<KanbanCard
					session={cardActive}
					lane="active"
					isSelected={selectedId === cardActive.id}
					onSelect={(id) => setSelectedId(id)}
				/>
			</div>

			<div>
				<div style={{ fontSize: "11px", opacity: 0.6, marginBottom: "4px" }}>
					2. Question Alert (Needs input)
				</div>
				<KanbanCard
					session={cardAlertQuestion}
					lane="active"
					alert={createMockAlert("question")}
					isSelected={selectedId === cardAlertQuestion.id}
					onSelect={(id) => setSelectedId(id)}
				/>
			</div>

			<div>
				<div style={{ fontSize: "11px", opacity: 0.6, marginBottom: "4px" }}>
					3. Permission Alert (Approval required)
				</div>
				<KanbanCard
					session={cardAlertPermission}
					lane="active"
					alert={createMockAlert("permission")}
					isSelected={selectedId === cardAlertPermission.id}
					onSelect={(id) => setSelectedId(id)}
				/>
			</div>

			<div>
				<div style={{ fontSize: "11px", opacity: 0.6, marginBottom: "4px" }}>
					4. Error Alert (Task stopped/failed)
				</div>
				<KanbanCard
					session={cardAlertError}
					lane="active"
					alert={createMockAlert("error")}
					isSelected={selectedId === cardAlertError.id}
					onSelect={(id) => setSelectedId(id)}
				/>
			</div>

			<div>
				<div style={{ fontSize: "11px", opacity: 0.6, marginBottom: "4px" }}>
					5. Done Lane Card (Pinnable & External Links)
				</div>
				<KanbanCard
					session={cardDone}
					lane="done"
					isSelected={selectedId === cardDone.id}
					onSelect={(id) => setSelectedId(id)}
					onTogglePin={() => setPinned((prev) => !prev)}
				/>
			</div>
		</div>
	);
};
