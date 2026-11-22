import type { IncomingMessage, ServerResponse } from "node:http";
import { BlockList, isIP } from "node:net";
import type { Context } from "@deepseek-ai/cordis";
import type {
	ConnectionIndexRequest,
	ConnectionIndexResponse,
	ConnectionTrustRequest,
} from "@deepseek-ai/dsh-client-connection";
import type {} from "@deepseek-ai/dsh-host-webserver";
import Schema from "@deepseek-ai/schemastery";
import {
	DEFAULT_PWA_OPTIONS,
	handleIconRequest,
	injectPwaHead,
	type PwaManifestOptions,
	pwaManifest,
} from "./pwa.ts";

export const name = "dsh-client-pwa";
export const inject = ["webServer", "connection"];

export interface AuthConfig {
	userHeader?: string;
	allowedUsers?: string[];
	trustedCidrs?: string[];
	authRoutes?: string[];
	loginRedirectPath?: string;
	secureCookies?: boolean;
}

export const AuthConfig = Schema.object({
	userHeader: Schema.string().description(
		"Request header carrying verified user identity (e.g. tailscale-user-login, remote-user).",
	),
	allowedUsers: Schema.array(Schema.string()).description(
		"Allowed usernames permitted access.",
	),
	trustedCidrs: Schema.array(Schema.string()).description(
		"Trusted IPv4/IPv6 addresses or CIDR blocks.",
	),
	authRoutes: Schema.array(Schema.string())
		.default(["/login"])
		.description("Route paths triggering auto-login token exchange."),
	loginRedirectPath: Schema.string()
		.default("/login")
		.description(
			"Path to bounce unauthenticated clients to during HTML bounce.",
		),
	secureCookies: Schema.boolean()
		.default(true)
		.description("Enforce Secure attribute on cookies when HTTPS is detected."),
});

export interface PwaConfig extends PwaManifestOptions {
	pathPrefixes?: string[];
}

export const PwaConfig = Schema.object({
	name: Schema.string()
		.default(DEFAULT_PWA_OPTIONS.name)
		.description("Web application manifest name."),
	shortName: Schema.string()
		.default(DEFAULT_PWA_OPTIONS.shortName)
		.description("Web application manifest short name."),
	themeColor: Schema.string()
		.default(DEFAULT_PWA_OPTIONS.themeColor)
		.description("PWA theme color."),
	backgroundColor: Schema.string()
		.default(DEFAULT_PWA_OPTIONS.backgroundColor)
		.description("PWA background color."),
	startUrl: Schema.string()
		.default(DEFAULT_PWA_OPTIONS.startUrl)
		.description("PWA start URL."),
	scope: Schema.string()
		.default(DEFAULT_PWA_OPTIONS.scope)
		.description("PWA navigation scope."),
	display: Schema.string()
		.default(DEFAULT_PWA_OPTIONS.display)
		.description("PWA display mode."),
	pathPrefixes: Schema.array(Schema.string()).description(
		"Path prefixes where PWA assets and auth routes are also mounted.",
	),
});

export interface Config {
	auth?: AuthConfig;
	pwa?: PwaConfig;
}

export const Config = Schema.object({
	auth: AuthConfig.description("Proxy authentication configuration."),
	pwa: PwaConfig.description("PWA metadata and assets configuration."),
});

export function getHeader(
	headers: ConnectionTrustRequest["headers"] | IncomingMessage["headers"],
	name: string,
): string | undefined {
	if (headers instanceof Headers) return headers.get(name) ?? undefined;
	const value =
		(headers as Record<string, string | string[] | undefined>)[
			name.toLowerCase()
		] ?? (headers as Record<string, string | string[] | undefined>)[name];
	if (Array.isArray(value)) return value[0];
	return typeof value === "string" ? value : undefined;
}

export function normalizePrefixes(rawPrefixes?: readonly string[]): string[] {
	if (!rawPrefixes || rawPrefixes.length === 0) return [""];
	const cleaned = rawPrefixes
		.map((p) => p.trim().replace(/^\/+|\/+$/g, ""))
		.filter((p) => p.length > 0)
		.map((p) => `/${p}`);
	return Array.from(new Set(["", ...cleaned]));
}

export function isIpInCidrs(ip: string, cidrs: readonly string[]): boolean {
	if (cidrs.length === 0) return false;
	const rawIp = ip.split("%")[0].trim();
	const cleanIp =
		rawIp.startsWith("::ffff:") && rawIp.includes(".") ? rawIp.slice(7) : rawIp;
	const ipType = isIP(cleanIp);
	if (ipType === 0) return false;

	const blockList = new BlockList();
	for (const cidr of cidrs) {
		const trimmed = cidr.trim();
		const slash = trimmed.indexOf("/");
		const addr = slash === -1 ? trimmed : trimmed.slice(0, slash);
		const prefixStr =
			slash === -1 ? undefined : trimmed.slice(slash + 1).trim();
		const addrType = isIP(addr);
		if (addrType === 0) continue;
		const family = addrType === 4 ? "ipv4" : "ipv6";
		if (prefixStr === undefined) {
			blockList.addAddress(addr, family);
		} else if (/^\d+$/.test(prefixStr)) {
			const prefix = Number(prefixStr);
			if (prefix >= 0 && prefix <= (addrType === 4 ? 32 : 128)) {
				blockList.addSubnet(addr, prefix, family);
			}
		}
	}
	return blockList.check(cleanIp, ipType === 4 ? "ipv4" : "ipv6");
}

export function isTrustedRequest(
	headers: ConnectionTrustRequest["headers"] | IncomingMessage["headers"],
	config?: AuthConfig,
	remoteAddress?: string,
): boolean {
	const userHeader = config?.userHeader;
	if (typeof userHeader === "string" && userHeader.trim().length > 0) {
		const user = getHeader(headers, userHeader);
		if (typeof user === "string" && user.trim().length > 0) {
			const normalizedUser = user.trim();
			if (
				config?.allowedUsers !== undefined &&
				config.allowedUsers.length > 0
			) {
				return config.allowedUsers.includes(normalizedUser);
			}
			return true;
		}

		if (config?.allowedUsers !== undefined && config.allowedUsers.length > 0) {
			return false;
		}
	}

	if (config?.trustedCidrs !== undefined && config.trustedCidrs.length > 0) {
		const forwardedFor = getHeader(headers, "x-forwarded-for");
		const clientIp =
			(typeof forwardedFor === "string" && forwardedFor.trim().length > 0
				? forwardedFor.split(",")[0].trim()
				: undefined) ?? remoteAddress;
		if (clientIp && isIpInCidrs(clientIp, config.trustedCidrs)) {
			return true;
		}
	}

	return false;
}

export function handleAuthRedirect(
	ctx: Context,
	req: IncomingMessage,
	res: ServerResponse,
	authConfig?: AuthConfig,
	pwaConfig?: PwaConfig,
): void {
	const host = getHeader(req.headers, "host");
	if (typeof host !== "string" || host.trim().length === 0) {
		res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
		res.end("Missing Host header");
		return;
	}

	if (!isTrustedRequest(req.headers, authConfig, req.socket?.remoteAddress)) {
		res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
		res.end("Access denied: Client identity or network verification failed");
		return;
	}

	const normalizedHost = host.trim();
	const prefixes = normalizePrefixes(pwaConfig?.pathPrefixes);
	const reqUrl = req.url ?? "";
	const matchedPrefix =
		prefixes.find((p) => p.length > 0 && reqUrl.startsWith(p)) ?? "";
	const targetUrl = ctx.connection.authenticatedUrl(
		`https://${normalizedHost}${matchedPrefix}`,
	);
	res.writeHead(303, {
		"cache-control": "no-store",
		location: targetUrl,
		"referrer-policy": "no-referrer",
	});
	res.end();
}

export function wrapAuthorizeIndex(ctx: Context, config?: Config): () => void {
	const originalAuthorizeIndex = ctx.connection.authorizeIndex.bind(
		ctx.connection,
	);
	const secureCookies = config?.auth?.secureCookies ?? true;
	const loginRedirect = config?.auth?.loginRedirectPath ?? "/login";

	ctx.connection.authorizeIndex = (
		req: ConnectionIndexRequest,
		res: ConnectionIndexResponse,
	): boolean => {
		const isHttps = getHeader(req.headers, "x-forwarded-proto") === "https";

		if (isHttps && secureCookies) {
			const originalWriteHead = res.writeHead.bind(res);
			res.writeHead = function (
				this: ConnectionIndexResponse,
				statusCode: number,
				headers?: Readonly<Record<string, string>>,
			) {
				if (headers !== undefined) {
					const cookieKey = Object.keys(headers).find(
						(k) => k.toLowerCase() === "set-cookie",
					);
					if (cookieKey !== undefined) {
						const cookieVal = headers[cookieKey];
						const secureVal =
							typeof cookieVal === "string"
								? /;\s*secure/i.test(cookieVal)
									? cookieVal
									: `${cookieVal}; Secure`
								: Array.isArray(cookieVal)
									? (cookieVal as string[]).map((c: string) =>
											/;\s*secure/i.test(c) ? c : `${c}; Secure`,
										)
									: cookieVal;
						const updatedHeaders: Record<string, string> = {
							...headers,
							[cookieKey]: secureVal as string,
						};
						return originalWriteHead.call(this, statusCode, updatedHeaders);
					}
				}
				return originalWriteHead.call(this, statusCode, headers);
			};
		}

		const url = new URL(req.url ?? "/", "http://dsh.invalid");
		if (url.searchParams.has("token")) {
			return originalAuthorizeIndex(req, res);
		}

		const admission = ctx.connection.admit(req);
		if (!("rejection" in admission)) {
			return originalAuthorizeIndex(req, res);
		}

		if (isTrustedRequest(req.headers, config?.auth)) {
			const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><script>location.replace(${JSON.stringify(
				loginRedirect,
			)})</script></head><body>Redirecting to login...</body></html>`;
			res.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
			});
			res.end(html);
			return false;
		}

		return originalAuthorizeIndex(req, res);
	};

	return () => {
		ctx.connection.authorizeIndex = originalAuthorizeIndex;
	};
}

export function apply(ctx: Context, config?: Config): void {
	ctx.effect(
		() => wrapAuthorizeIndex(ctx, config),
		"dsh-client-pwa: authorizeIndex wrap",
	);

	const prefixes = normalizePrefixes(config?.pwa?.pathPrefixes);
	const configuredAuthRoutes = config?.auth?.authRoutes ?? ["/login"];

	for (const prefix of prefixes) {
		for (const route of configuredAuthRoutes) {
			const normalizedRoute = route.startsWith("/") ? route : `/${route}`;
			const fullPath = `${prefix}${normalizedRoute}`;
			ctx.effect(
				() =>
					ctx.webServer.register({
						kind: "prefix",
						path: fullPath,
						handler: (req, res) => {
							handleAuthRedirect(ctx, req, res, config?.auth, config?.pwa);
						},
					}),
				`dsh-client-pwa: ${fullPath} route`,
			);
		}

		const manifestPath = `${prefix}/manifest.webmanifest`;
		ctx.effect(
			() =>
				ctx.webServer.register({
					kind: "prefix",
					path: manifestPath,
					handler: (_req, res) => {
						res.writeHead(200, {
							"content-type": "application/manifest+json; charset=utf-8",
							"cache-control": "no-store",
						});
						res.end(pwaManifest(config?.pwa));
					},
				}),
			`dsh-client-pwa: ${manifestPath} route`,
		);

		const iconPath = `${prefix}/icons`;
		ctx.effect(
			() =>
				ctx.webServer.register({
					kind: "prefix",
					path: iconPath,
					handler: handleIconRequest,
				}),
			`dsh-client-pwa: ${iconPath} route`,
		);
	}

	ctx.effect(
		() => ctx.webServer.tapIndex((html) => injectPwaHead(html)),
		"dsh-client-pwa: pwa head injection",
	);
}
