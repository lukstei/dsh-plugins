import { createElement, type ReactNode } from "react";

export function useDismissOnOutsidePointer() {}

export function DisclosureRow(props: {
	title?: ReactNode;
	icon?: ReactNode;
	collapsedContent?: ReactNode;
	children?: ReactNode;
}) {
	return createElement(
		"div",
		{ className: "dsh-disclosure-row" },
		props.icon,
		createElement("span", null, props.title),
		props.collapsedContent,
		props.children,
	);
}

export function TextShimmer(props: { children?: ReactNode; active?: boolean }) {
	return createElement(
		"span",
		{ className: "dsh-text-shimmer" },
		props.children,
	);
}

export function IconApiOutlineRegular(_props: { size?: number }) {
	return createElement("span", { className: "dsh-icon-api" });
}
