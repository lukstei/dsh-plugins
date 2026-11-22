/** Ambient runtime type augmentations for DSH Kanban. */
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-api-workspace-controller/client";
import type {} from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import type {} from "@lukstei/dsh-client-split-view/client-contract";

export type {
	IWorkspaces,
	WorkspaceId,
	WorkspaceSnapshot,
	WorkspaceView,
} from "@deepseek-ai/dsh-api-workspace-controller/client";

declare module "@deepseek-ai/cordis" {
	interface Context {
		sidebarMode: import("./sidebar-mode.ts").SidebarModeStore;
	}
}

declare module "@deepseek-ai/dsh-api-session-controller/client" {
	interface SessionReferenceSourceMap {
		kanban: unknown;
	}
}
