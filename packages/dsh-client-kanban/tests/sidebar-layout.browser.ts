// Run against the native-theme HeaderLayout story with: agent-browser --session <name> eval --stdin < packages/dsh-client-kanban/tests/sidebar-layout.browser.ts
(async () => {
	const sidebar = document.querySelector(".dsh-inflight-sidebar");
	const host = document.querySelector(".header-story-sidebar");
	const list = document.querySelector(".dsh-inflight-sidebar-list");
	const close = document.querySelector(".dsh-inflight-btn-close");
	if (sidebar === null || host === null || list === null || close === null)
		throw new Error(
			"Open the expanded HeaderLayout story before checking layout",
		);

	await Promise.all(
		sidebar
			.getAnimations({ subtree: true })
			.filter((animation) => animation instanceof CSSTransition)
			.map((animation) => animation.finished),
	);
	const failures = [];
	const hostBox = host.getBoundingClientRect();
	const sidebarBox = sidebar.getBoundingClientRect();
	const closeBox = close.getBoundingClientRect();
	if (closeBox.right > hostBox.right || closeBox.left < sidebarBox.left)
		failures.push("Section close target escapes the sidebar");

	for (const row of document.querySelectorAll(
		".dsh-inflight-ws-header-row,.dsh-inflight-card",
	)) {
		const box = row.getBoundingClientRect();
		const expectedHeight = row.classList.contains("dsh-inflight-card")
			? 32
			: 34;
		if (Math.abs(box.height - expectedHeight) > 1)
			failures.push(`Row height ${box.height} differs from ${expectedHeight}`);
		if (Math.abs(box.right - (hostBox.right - 8)) > 1)
			failures.push(
				`Row right ${box.right} differs from native edge ${hostBox.right - 8}`,
			);
	}

	for (const badges of document.querySelectorAll(".dsh-inflight-badges")) {
		const box = badges.getBoundingClientRect();
		const parent = badges.parentElement;
		if (parent === null) throw new Error("Badge parent missing");
		const parentBox = parent.getBoundingClientRect();
		if (
			Math.abs(box.y + box.height / 2 - parentBox.y - parentBox.height / 2) > 1
		)
			failures.push("Badges are not vertically centered");
		if (box.right > parentBox.right || box.left < parentBox.left)
			failures.push("Badges escape their label button");
	}

	for (const card of document.querySelectorAll(".dsh-inflight-card")) {
		const paint = getComputedStyle(card);
		if (paint.backgroundClip !== "padding-box")
			failures.push("Session paint covers the native side insets");
		if (
			!card.classList.contains("is-current") &&
			!card.matches(":hover") &&
			paint.backgroundColor !== "rgba(0, 0, 0, 0)"
		)
			failures.push("Unselected session has a persistent fill");
		const title = card.querySelector(".dsh-inflight-card-title");
		const time = card.querySelector(".dsh-inflight-card-time");
		const actions = card.querySelector(".dsh-inflight-card-actions");
		if (title === null || time === null || actions === null)
			throw new Error("Session row is incomplete");
		if (
			card.contains(document.activeElement) &&
			getComputedStyle(actions).display === "none"
		)
			failures.push("Focused session hides keyboard actions");
		const trailing =
			getComputedStyle(actions).display === "none" ? time : actions;
		if (
			title.getBoundingClientRect().right >
			trailing.getBoundingClientRect().left + 1
		)
			failures.push("Title overlaps trailing controls");
		for (const button of card.querySelectorAll("button")) {
			if (
				getComputedStyle(button).display === "none" ||
				button.getClientRects().length === 0
			)
				continue;
			const box = button.getBoundingClientRect();
			const rowBox = card.getBoundingClientRect();
			if (
				box.right > rowBox.right ||
				box.left < rowBox.left ||
				box.top < rowBox.top ||
				box.bottom > rowBox.bottom
			)
				failures.push("Session control escapes its row");
		}
	}
	if (failures.length > 0) throw new Error(failures.join("\n"));
	return {
		rows: document.querySelectorAll(".dsh-inflight-card").length,
		scrolling: list.scrollHeight > list.clientHeight,
		width: hostBox.width,
		passed: true,
	};
})();
