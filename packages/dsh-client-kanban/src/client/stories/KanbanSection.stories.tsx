import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { Story } from "@ladle/react";
import { useState } from "react";
import { KanbanSection } from "../KanbanSection.tsx";
import { createMockAlert, createMockSession } from "./fixtures.ts";

export const SectionVariants: Story = () => {
	const [selectedId, setSelectedId] = useState<SessionId>("s1" as SessionId);

	const activeSessions = [
		createMockSession("s1", "Implement WebSocket heartbeat ping", "active", {
			running: true,
		}),
		createMockSession(
			"s2",
			"Resolve flaky Playwright worker shutdown",
			"active",
			{
				running: true,
			},
		),
	];

	return (
		<div style={{ display: "flex", gap: "20px", height: "500px" }}>
			<div style={{ width: "280px", height: "100%" }}>
				<div style={{ fontSize: "11px", opacity: 0.6, marginBottom: "8px" }}>
					Populated Lane
				</div>
				<KanbanSection
					lane="active"
					title="In Progress"
					sessions={activeSessions}
					selectedSessionId={selectedId}
					onSelect={(id) => setSelectedId(id)}
					onDropSession={() => {}}
					getAlert={(id) =>
						id === ("s2" as SessionId) ? createMockAlert("question") : undefined
					}
				/>
			</div>

			<div style={{ width: "280px", height: "100%" }}>
				<div style={{ fontSize: "11px", opacity: 0.6, marginBottom: "8px" }}>
					Empty Lane
				</div>
				<KanbanSection
					lane="review"
					title="Under Review"
					sessions={[]}
					onSelect={(id) => setSelectedId(id)}
					onDropSession={() => {}}
				/>
			</div>

			<div style={{ width: "280px", height: "100%" }}>
				<div style={{ fontSize: "11px", opacity: 0.6, marginBottom: "8px" }}>
					Active Drop Target (Accepts drop from active)
				</div>
				<KanbanSection
					lane="done"
					title="Completed"
					sessions={[]}
					activeDragSourceLane="active"
					onSelect={(id) => setSelectedId(id)}
					onDropSession={() => {}}
				/>
			</div>
		</div>
	);
};
