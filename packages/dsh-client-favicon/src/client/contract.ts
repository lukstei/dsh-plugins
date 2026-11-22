import type {} from "@deepseek-ai/cordis";

export interface IFaviconBadge {
	readonly setBadge: (badge: { readonly reviewCount: number }) => void;
}

declare module "@deepseek-ai/cordis" {
	interface Context {
		faviconBadge: IFaviconBadge;
	}
}
