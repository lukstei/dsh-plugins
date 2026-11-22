import type { ToolCallBlock } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { TypertRemoteNamespace } from "@deepseek-ai/dsh-typert-protocol";
import type { BranchReviewScope } from "@lukstei/util-review-ui/types";
import type {} from "../../lib/typert.remote-client.js";

declare module "@deepseek-ai/dsh-client-ui-slots" {
	interface SlotFactoryMap {
		"gitdiff.review": {
			scope: "session";
			props: { scope?: BranchReviewScope };
			inject: { api: TypertRemoteNamespace<"workspaceReview"> };
		};
	}
	interface SlotMap {
		"tool.call.toolview": {
			kind: "keyed";
			scope: "session";
			owner: {
				callId: string;
				toolName: string;
				phase?: "preparing" | "start" | "result";
				block: ToolCallBlock;
				inspect?: () => void;
			};
		};
	}
}
