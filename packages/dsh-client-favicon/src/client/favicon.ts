export interface FaviconBadgeOptions {
	/** Active / running processes (rendered in #00C853) */
	readonly running?: number;
	/** Items awaiting review / action (rendered in #FF9800) */
	readonly review?: number;
	/** Critical alerts (activates central red pip #EF4444) */
	readonly alert?: number;
}

const COLOR_INACTIVE = "rgba(128, 128, 128, 0.25)";
const COLOR_RUNNING = "#00C853";
const COLOR_REVIEW = "#FF9800";
const COLOR_ALERT = "#EF4444";
const COLOR_IDLE_PIP = COLOR_INACTIVE;

// Tick indices run clockwise from north (0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW).
// Review fills from the top (N, NW, NE, ...), running from the bottom (S, SW, SE, ...).
const REVIEW_ORDER = [0, 7, 1, 6, 2, 5, 3, 4];
const RUNNING_ORDER = [4, 5, 3, 6, 2, 7, 1, 0];

export function generateFaviconSvg({
	running = 0,
	review = 0,
	alert = 0,
}: FaviconBadgeOptions = {}): string {
	const safeRunning = Math.max(0, Math.floor(running));
	const safeReview = Math.max(0, Math.floor(review));
	const safeAlert = Math.max(0, Math.floor(alert));

	const totalTicks = 8;
	const rInner = 3.7;
	const rOuter = 6.6;
	let ticks = "";

	// 8 radial tick capsules at 45-degree intervals forming a uniform circle
	for (let i = 0; i < totalTicks; i++) {
		// Start from top (-90 deg / -0.5*PI) and rotate clockwise
		const rad = (i * 45 - 90) * (Math.PI / 180);

		// Segment coordinates: r_inner = 3.7, r_outer = 6.6
		const x1 = (8 + rInner * Math.cos(rad)).toFixed(2);
		const y1 = (8 + rInner * Math.sin(rad)).toFixed(2);
		const x2 = (8 + rOuter * Math.cos(rad)).toFixed(2);
		const y2 = (8 + rOuter * Math.sin(rad)).toFixed(2);

		// Color priority: Running segments -> Review segments -> Inactive
		let strokeColor = COLOR_INACTIVE;
		if (RUNNING_ORDER.indexOf(i) < safeRunning) {
			strokeColor = COLOR_RUNNING;
		} else if (
			REVIEW_ORDER.indexOf(i) < Math.min(safeReview, totalTicks - safeRunning)
		) {
			strokeColor = COLOR_REVIEW;
		}

		ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${strokeColor}" stroke-width="2.6" stroke-linecap="round" />`;
	}

	const reviewOverflow = safeReview > Math.max(0, totalTicks - safeRunning);

	// Central pip: prominent alert pip, prominent review overflow pip, or subtle idle core
	const centerPip =
		safeAlert > 0
			? `<circle cx="8" cy="8" r="2.4" fill="${COLOR_ALERT}" />`
			: reviewOverflow
				? `<circle cx="8" cy="8" r="2.4" fill="${COLOR_REVIEW}" />`
				: `<circle cx="8" cy="8" r="1.8" fill="${COLOR_IDLE_PIP}" />`;

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" shape-rendering="geometricPrecision">${ticks}${centerPip}</svg>`;
}

/**
 * Purpose: Render an SVG data URI displaying an 8-radial status badge with central alert/overflow pip.
 * Contract:
 * - Inputs: optional FaviconBadgeOptions ({ running, review, alert }).
 * - Outputs: SVG data URI string formatted as data:image/svg+xml,...
 * - Throws / Errors: Never throws.
 */
export function renderFaviconBadgeUri(
	options: FaviconBadgeOptions = {},
): string {
	const svg = generateFaviconSvg(options);
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
