import type {} from "@deepseek-ai/cordis";

export interface IAppBadge {
	/** Sessions in review that were active recently; added to pending-interaction sessions for the app-icon badge. */
	readonly setRecentReviewCount: (count: number) => void;
}

declare module "@deepseek-ai/cordis" {
	interface Context {
		appBadge: IAppBadge;
	}
}
