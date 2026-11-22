import type { IncomingMessage, ServerResponse } from "node:http";
import { iconPng } from "./icons.ts";

export interface PwaManifestOptions {
	name?: string;
	shortName?: string;
	themeColor?: string;
	backgroundColor?: string;
	startUrl?: string;
	scope?: string;
	display?: string;
}

export const DEFAULT_PWA_OPTIONS: Required<PwaManifestOptions> = {
	name: "DeepSeek Harness",
	shortName: "DSH",
	themeColor: "#1f2430",
	backgroundColor: "#0f172a",
	startUrl: "/login",
	scope: "/",
	display: "standalone",
};

const TOUCH =
	'<link rel="apple-touch-icon" sizes="180x180" href="/icons/180.png" />';
const MANIFEST_RE = /<link\s+rel="manifest"\s+href="[^"]*"\s*\/?>/;

export function pwaManifest(config?: PwaManifestOptions): string {
	return JSON.stringify({
		id: "/",
		name: config?.name ?? DEFAULT_PWA_OPTIONS.name,
		short_name: config?.shortName ?? DEFAULT_PWA_OPTIONS.shortName,
		start_url: config?.startUrl ?? DEFAULT_PWA_OPTIONS.startUrl,
		scope: config?.scope ?? DEFAULT_PWA_OPTIONS.scope,
		display: config?.display ?? DEFAULT_PWA_OPTIONS.display,
		theme_color: config?.themeColor ?? DEFAULT_PWA_OPTIONS.themeColor,
		background_color:
			config?.backgroundColor ?? DEFAULT_PWA_OPTIONS.backgroundColor,
		icons: [
			{
				src: "/favicon.svg",
				sizes: "any",
				type: "image/svg+xml",
				purpose: "any",
			},
			{
				src: "/icons/192.png",
				sizes: "192x192",
				type: "image/png",
				purpose: "any maskable",
			},
			{
				src: "/icons/512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "any maskable",
			},
		],
	});
}

export function injectPwaHead(html: string): string {
	if (typeof html !== "string") return html;
	const injection = `${TOUCH}<link rel="manifest" href="/manifest.webmanifest" />`;
	if (MANIFEST_RE.test(html)) {
		return html.replace(MANIFEST_RE, injection);
	}
	if (html.includes("</head>")) {
		return html.replace("</head>", `${injection}</head>`);
	}
	return html;
}

export function handleIconRequest(
	req: IncomingMessage,
	res: ServerResponse,
): void {
	const url = req.url ?? "";
	const match = url.match(/(\d+)\.png$/);
	const size = match !== null ? Number(match[1]) : 0;
	const png = iconPng(size);
	if (png === undefined) {
		res.writeHead(404);
		res.end();
		return;
	}
	res.writeHead(200, {
		"content-type": "image/png",
		"cache-control": "public, max-age=86400",
	});
	res.end(png);
}
