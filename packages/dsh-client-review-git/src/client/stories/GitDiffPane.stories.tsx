import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { Story } from "@ladle/react";
import { GitDiffPane } from "../GitDiffPane.tsx";
import { createMockApi } from "./fixtures.ts";

export const FullReviewWorkspace: Story = () => {
	const api = createMockApi();

	return (
		<div
			style={{
				height: "750px",
				width: "100%",
				display: "flex",
				flexDirection: "column",
				border: "1px solid var(--dsw-alias-border-l1)",
				borderRadius: "6px",
				overflow: "hidden",
			}}
		>
			<GitDiffPane sessionId={"session-demo" as SessionId} api={api} />
		</div>
	);
};
