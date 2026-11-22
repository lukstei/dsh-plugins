import { describe, expect, it } from "vitest";
import {
	generateFaviconSvg,
	renderFaviconBadgeUri,
} from "../src/client/favicon.ts";

describe("generateFaviconSvg & renderFaviconBadgeUri", () => {
	it("renders transparent background with 8 inactive ticks and subtle idle core when counts are 0", () => {
		const svg = generateFaviconSvg({});
		expect(svg).not.toContain("<rect");
		const inactives = svg.match(/stroke="rgba\(128, 128, 128, 0\.25\)"/g);
		expect(inactives).toHaveLength(8);
		expect(svg).toContain(
			'<circle cx="8" cy="8" r="1.8" fill="rgba(128, 128, 128, 0.25)" />',
		);
		expect(svg).not.toContain("#00C853");
		expect(svg).not.toContain("#FF9800");
		expect(svg).not.toContain("#EF4444");

		// Cardinal tick (e.g. top tick at 12 o'clock)
		expect(svg).toContain(
			'<line x1="8.00" y1="4.30" x2="8.00" y2="1.40" stroke="rgba(128, 128, 128, 0.25)" stroke-width="2.6" stroke-linecap="round" />',
		);
		// Diagonal tick (e.g. top-right tick forming a uniform circle)
		expect(svg).toContain(
			'<line x1="10.62" y1="5.38" x2="12.67" y2="3.33" stroke="rgba(128, 128, 128, 0.25)" stroke-width="2.6" stroke-linecap="round" />',
		);

		const uri = renderFaviconBadgeUri({});
		expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
	});

	it("fills review from the top and running from the bottom", () => {
		const svg = generateFaviconSvg({ running: 3, review: 3 });
		const colors = [...svg.matchAll(/<line [^>]*stroke="([^"]+)"/g)].map(
			(m) => m[1],
		);
		// clockwise from N: review N, running SE/S/SW... review NW/NE
		expect(colors).toEqual([
			"#FF9800",
			"#FF9800",
			"rgba(128, 128, 128, 0.25)",
			"#00C853",
			"#00C853",
			"#00C853",
			"rgba(128, 128, 128, 0.25)",
			"#FF9800",
		]);
	});

	it("renders running and review tick counts", () => {
		const svg = generateFaviconSvg({ running: 3, review: 2 });
		const greenTicks = svg.match(/stroke="#00C853"/g);
		expect(greenTicks).toHaveLength(3);
		const amberTicks = svg.match(/stroke="#FF9800"/g);
		expect(amberTicks).toHaveLength(2);
		const inactiveTicks = svg.match(/stroke="rgba\(128, 128, 128, 0\.25\)"/g);
		expect(inactiveTicks).toHaveLength(3);
		// Center pip remains subtle idle core when all review sessions fit
		expect(svg).toContain(
			'<circle cx="8" cy="8" r="1.8" fill="rgba(128, 128, 128, 0.25)" />',
		);
	});

	it("does not fill the middle circle in orange when 10 sessions are active and none in review", () => {
		const svg = generateFaviconSvg({ running: 10, review: 0 });
		const greenTicks = svg.match(/stroke="#00C853"/g);
		expect(greenTicks).toHaveLength(8);
		expect(svg).not.toContain('stroke="#FF9800"');
		// Middle circle is strictly reserved for missing review space: must remain idle core
		expect(svg).toContain(
			'<circle cx="8" cy="8" r="1.8" fill="rgba(128, 128, 128, 0.25)" />',
		);
		expect(svg).not.toContain('fill="#FF9800"');
	});

	it("fills the middle circle in orange when running takes all slots and review is awaiting space", () => {
		const svg = generateFaviconSvg({ running: 8, review: 1 });
		const greenTicks = svg.match(/stroke="#00C853"/g);
		expect(greenTicks).toHaveLength(8);
		expect(svg).not.toContain('stroke="#FF9800"');
		// Not enough space for review -> prominent orange pip
		expect(svg).toContain('<circle cx="8" cy="8" r="2.4" fill="#FF9800" />');
	});

	it("fills the middle circle in orange when partial review fits but at least one does not fit", () => {
		// 5 running + 4 review = 9 > 8. 5 running ticks + 3 review ticks. 1 review missing space.
		const svg = generateFaviconSvg({ running: 5, review: 4 });
		const greenTicks = svg.match(/stroke="#00C853"/g);
		expect(greenTicks).toHaveLength(5);
		const amberTicks = svg.match(/stroke="#FF9800"/g);
		expect(amberTicks).toHaveLength(3);
		expect(svg).toContain('<circle cx="8" cy="8" r="2.4" fill="#FF9800" />');
	});

	it("fills the middle circle in orange when 0 running and review exceeds 8", () => {
		const svg = generateFaviconSvg({ running: 0, review: 9 });
		const amberTicks = svg.match(/stroke="#FF9800"/g);
		expect(amberTicks).toHaveLength(8);
		expect(svg).toContain('<circle cx="8" cy="8" r="2.4" fill="#FF9800" />');
	});

	it("shows a red circle when alert > 0 taking priority over review overflow", () => {
		const svg = generateFaviconSvg({ running: 8, review: 2, alert: 1 });
		const greenTicks = svg.match(/stroke="#00C853"/g);
		expect(greenTicks).toHaveLength(8);
		expect(svg).toContain('<circle cx="8" cy="8" r="2.4" fill="#EF4444" />');
		expect(svg).not.toContain('fill="#FF9800"');
	});
});
