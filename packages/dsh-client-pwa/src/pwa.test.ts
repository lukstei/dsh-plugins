import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import { handleIconRequest, injectPwaHead, pwaManifest } from "./pwa.ts";

interface MockResponse {
	statusCode: number;
	headers: Record<string, string>;
	body: string | Buffer;
	writeHead(status: number, headers?: Record<string, string>): MockResponse;
	end(content?: string | Buffer): MockResponse;
}

function createMockResponse(): MockResponse {
	return {
		statusCode: 0,
		headers: {},
		body: "",
		writeHead(status: number, headers?: Record<string, string>) {
			this.statusCode = status;
			this.headers = headers ?? {};
			return this;
		},
		end(content: string | Buffer = "") {
			this.body = content;
			return this;
		},
	};
}

test("pwaManifest returns valid JSON with defaults", () => {
	const json = pwaManifest();
	const manifest = JSON.parse(json);
	assert.equal(manifest.start_url, "/login");
	assert.equal(manifest.display, "standalone");
	assert.equal(manifest.name, "DeepSeek Harness");
	assert.equal(manifest.short_name, "DSH");
	assert.equal(manifest.theme_color, "#1f2430");
	assert.equal(manifest.background_color, "#0f172a");
	assert.ok(Array.isArray(manifest.icons));
	const icons = manifest.icons as Array<{ src: string }>;
	assert.ok(icons.some((i) => i.src === "/icons/192.png"));
	assert.ok(icons.some((i) => i.src === "/icons/512.png"));
});

test("pwaManifest respects custom configuration", () => {
	const json = pwaManifest({
		name: "Custom Harness",
		shortName: "Custom",
		themeColor: "#ff0000",
		backgroundColor: "#00ff00",
		startUrl: "/app",
	});
	const manifest = JSON.parse(json);
	assert.equal(manifest.name, "Custom Harness");
	assert.equal(manifest.short_name, "Custom");
	assert.equal(manifest.theme_color, "#ff0000");
	assert.equal(manifest.background_color, "#00ff00");
	assert.equal(manifest.start_url, "/app");
});

test("injectPwaHead replaces existing manifest link and adds apple-touch-icon", () => {
	const original =
		'<html><head><link rel="manifest" href="./manifest.webmanifest" /></head><body></body></html>';
	const transformed = injectPwaHead(original);
	assert.match(
		transformed,
		/<link rel="apple-touch-icon" sizes="180x180" href="\/icons\/180\.png" \/>/,
	);
	assert.match(
		transformed,
		/<link rel="manifest" href="\/manifest\.webmanifest" \/>/,
	);
	assert.ok(!transformed.includes("./manifest.webmanifest"));
});

test("injectPwaHead injects tags before head close tag if manifest tag is missing", () => {
	const original = "<html><head><title>Test</title></head><body></body></html>";
	const transformed = injectPwaHead(original);
	assert.match(transformed, /<link rel="apple-touch-icon"/);
	assert.match(transformed, /<link rel="manifest"/);
});

test("handleIconRequest returns 200 with PNG image for valid sizes", () => {
	for (const size of [180, 192, 512]) {
		const req = { url: `/icons/${size}.png` } as unknown as IncomingMessage;
		const res = createMockResponse();
		handleIconRequest(req, res as unknown as ServerResponse);
		assert.equal(res.statusCode, 200);
		assert.equal(res.headers["content-type"], "image/png");
		assert.ok(Buffer.isBuffer(res.body));
	}
});

test("handleIconRequest returns 404 for unknown icon sizes", () => {
	const req = { url: "/icons/999.png" } as unknown as IncomingMessage;
	const res = createMockResponse();
	handleIconRequest(req, res as unknown as ServerResponse);
	assert.equal(res.statusCode, 404);
});
