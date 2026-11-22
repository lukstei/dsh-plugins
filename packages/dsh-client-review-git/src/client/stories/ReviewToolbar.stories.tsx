import type { Story } from "@ladle/react";
import { useState } from "react";
import { ReviewToolbar } from "../ReviewToolbar.tsx";
import type { resolveReviewBaseline } from "../reviewSelection.ts";
import {
	createMockApi,
	createMockCatalog,
	createMockRepository,
} from "./fixtures.ts";

type Selection = Parameters<typeof resolveReviewBaseline>[0];

export const StandardToolbar: Story = () => {
	const repo = createMockRepository();
	const catalog = createMockCatalog(repo);
	const api = createMockApi();

	const [selection, setSelection] = useState<Selection>({
		kind: "branch",
		repository: "/repo/project-alpha",
		ref: "refs/heads/feature/oauth",
		base: { kind: "manual", ref: "refs/remotes/origin/main" },
		revision: { kind: "all-commits" },
	});
	const [revision, setRevision] = useState(0);

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "24px",
				maxWidth: "800px",
			}}
		>
			<div
				style={{
					border: "1px solid var(--dsw-alias-border-l1)",
					borderRadius: "6px",
				}}
			>
				<ReviewToolbar
					catalog={catalog}
					activeRepository={repo}
					onSelectRepository={() => {}}
					selection={selection}
					base="refs/remotes/origin/main"
					revision={revision}
					select={(sel) => setSelection(sel)}
					api={api}
					sessionId="session-demo"
					refresh={() => setRevision((r) => r + 1)}
				/>
			</div>
		</div>
	);
};
