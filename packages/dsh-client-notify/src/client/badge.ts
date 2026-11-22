/** Sets the installed-PWA app-icon badge; a count of 0 clears it. */
export function syncAppBadge(count: number): void {
	if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) return;
	// edge case: the browser rejects when the app is not installed or permission is missing.
	const result =
		count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
	result.catch(() => {});
}
