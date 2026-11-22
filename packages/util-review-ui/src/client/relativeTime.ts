import { relativeTime } from "@deepseek-ai/dsh-client-ui-primitives";

const relativeFormat = new Intl.RelativeTimeFormat("en", {
	style: "short",
	numeric: "always",
});

export function formatRelativeTime(timestamp: number): string {
	const age = relativeTime(timestamp, Date.now());
	const units = {
		minutes: "minute",
		hours: "hour",
		days: "day",
		months: "month",
		years: "year",
	} as const;
	return age.unit === "now"
		? "just now"
		: relativeFormat.format(-age.n, units[age.unit]);
}
