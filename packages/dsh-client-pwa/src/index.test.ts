import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import type { Context } from "@deepseek-ai/cordis";
import {
	apply,
	handleAuthRedirect,
	inject,
	isIpInCidrs,
	isTrustedRequest,
	name,
	normalizePrefixes,
	wrapAuthorizeIndex,
} from "./index.ts";

test("plugin metadata exports", () => {
	assert.equal(name, "dsh-client-pwa");
	assert.deepEqual(inject, ["webServer", "connection"]);
});

interface MockResponse {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
	writeHead(status: number, ...args: unknown[]): MockResponse;
	end(content?: string): MockResponse;
}

function createMockResponse(): MockResponse {
	return {
		statusCode: 0,
		headers: {},
		body: "",
		writeHead(status: number, ...args: unknown[]) {
			this.statusCode = status;
			for (const arg of args) {
				if (typeof arg === "object" && arg !== null) {
					this.headers = arg as Record<string, string>;
				}
			}
			return this;
		},
		end(content = "") {
			this.body = content;
			return this;
		},
	};
}

test("normalizePrefixes normalizes leading and trailing slashes and deduplicates", () => {
	assert.deepEqual(normalizePrefixes(undefined), [""]);
	assert.deepEqual(normalizePrefixes([]), [""]);
	assert.deepEqual(normalizePrefixes(["/", "  ", ""]), [""]);
	assert.deepEqual(
		normalizePrefixes(["tsctl", "/tsctl", "/tsctl/", "///api//"]),
		["", "/tsctl", "/api"],
	);
});

test("isIpInCidrs correctly identifies IPv4 exact, IPv4 CIDR, and IPv6", () => {
	const cidrs = ["127.0.0.1", "::1", "100.64.0.0/10", "fd7a:115c:a1e0::/48"];

	assert.equal(isIpInCidrs("127.0.0.1", cidrs), true);
	assert.equal(isIpInCidrs("::1", cidrs), true);
	assert.equal(isIpInCidrs("100.64.0.1", cidrs), true);
	assert.equal(isIpInCidrs("100.69.234.95", cidrs), true);
	assert.equal(isIpInCidrs("100.127.255.254", cidrs), true);
	assert.equal(isIpInCidrs("fd7a:115c:a1e0::1", cidrs), true);
	assert.equal(isIpInCidrs("::ffff:100.69.234.95", cidrs), true);

	assert.equal(isIpInCidrs("100.63.255.255", cidrs), false);
	assert.equal(isIpInCidrs("100.128.0.1", cidrs), false);
	assert.equal(isIpInCidrs("192.168.1.1", cidrs), false);
	assert.equal(isIpInCidrs("8.8.8.8", cidrs), false);
	assert.equal(isIpInCidrs("invalid-ip", cidrs), false);
	assert.equal(isIpInCidrs("127.0.0.1", []), false);
});

test("isIpInCidrs rejects malformed prefix formats without authorizing all IPs", () => {
	assert.equal(isIpInCidrs("8.8.8.8", ["100.64.0.0/"]), false);
	assert.equal(isIpInCidrs("8.8.8.8", ["100.64.0.0/ "]), false);
	assert.equal(isIpInCidrs("8.8.8.8", ["100.64.0.0/abc"]), false);
	assert.equal(isIpInCidrs("8.8.8.8", ["100.64.0.0/99"]), false);
	assert.equal(isIpInCidrs("2001:db8::1", ["fd7a:115c:a1e0::/"]), false);
});

test("isTrustedRequest evaluates custom userHeader and trustedCidrs", () => {
	const authConfig = {
		userHeader: "tailscale-user-login",
		trustedCidrs: ["100.64.0.0/10"],
	};

	assert.equal(
		isTrustedRequest(
			{ "tailscale-user-login": "alice@example.com" },
			authConfig,
		),
		true,
	);
	assert.equal(
		isTrustedRequest({ "x-forwarded-for": "100.69.234.95" }, authConfig),
		true,
	);
	assert.equal(
		isTrustedRequest(
			{ "x-forwarded-for": "100.69.234.95, 127.0.0.1" },
			authConfig,
		),
		true,
	);
	assert.equal(
		isTrustedRequest({ "x-forwarded-for": "1.2.3.4" }, authConfig),
		false,
	);
	assert.equal(isTrustedRequest({}, authConfig), false);
});

test("isTrustedRequest respects allowedUsers", () => {
	const authConfig = {
		userHeader: "tailscale-user-login",
		allowedUsers: ["alice@example.com"],
		trustedCidrs: ["100.64.0.0/10"],
	};
	assert.equal(
		isTrustedRequest(
			{ "tailscale-user-login": "alice@example.com" },
			authConfig,
		),
		true,
	);
	assert.equal(
		isTrustedRequest({ "tailscale-user-login": "bob@example.com" }, authConfig),
		false,
	);
	assert.equal(
		isTrustedRequest({ "x-forwarded-for": "100.69.234.95" }, authConfig),
		false,
	);
});

test("isTrustedRequest is safe by default when no header or cidrs configured", () => {
	assert.equal(isTrustedRequest({ "x-forwarded-for": "127.0.0.1" }, {}), false);
	assert.equal(
		isTrustedRequest({ "tailscale-user-login": "alice" }, {}),
		false,
	);
	assert.equal(isTrustedRequest({}, undefined), false);
});

test("handleAuthRedirect returns 400 when host header is missing", () => {
	const mockCtx = {
		connection: {
			authenticatedUrl: (url: string) => `${url}/?token=secret`,
		},
	};
	const req = { headers: { "tailscale-user-login": "user@example.com" } };
	const res = createMockResponse();

	handleAuthRedirect(
		mockCtx as unknown as Context,
		req as unknown as IncomingMessage,
		res as unknown as ServerResponse,
		{ userHeader: "tailscale-user-login" },
	);

	assert.equal(res.statusCode, 400);
	assert.match(res.body as string, /Missing Host header/);
});

test("handleAuthRedirect returns 403 when verification fails", () => {
	const mockCtx = {
		connection: {
			authenticatedUrl: (url: string) => `${url}/?token=secret`,
		},
	};
	const req = { headers: { host: "dsh.example.com" } };
	const res = createMockResponse();

	handleAuthRedirect(
		mockCtx as unknown as Context,
		req as unknown as IncomingMessage,
		res as unknown as ServerResponse,
		{ userHeader: "tailscale-user-login" },
	);

	assert.equal(res.statusCode, 403);
	assert.match(
		res.body as string,
		/Client identity or network verification failed/,
	);
});

test("handleAuthRedirect returns 303 redirect with authenticatedUrl for valid trusted request", () => {
	const mockCtx = {
		connection: {
			authenticatedUrl: (url: string) => `${url}/?token=launch-token-xyz`,
		},
	};
	const req = {
		headers: {
			"x-forwarded-for": "100.69.234.95",
			host: "dsh.example.com",
		},
	};
	const res = createMockResponse();

	handleAuthRedirect(
		mockCtx as unknown as Context,
		req as unknown as IncomingMessage,
		res as unknown as ServerResponse,
		{ trustedCidrs: ["100.64.0.0/10"] },
	);

	assert.equal(res.statusCode, 303);
	assert.equal(
		res.headers.location,
		"https://dsh.example.com/?token=launch-token-xyz",
	);
	assert.equal(res.headers["cache-control"], "no-store");
	assert.equal(res.headers["referrer-policy"], "no-referrer");
});

test("handleAuthRedirect preserves reverse proxy subpath prefix in targetUrl", () => {
	let authenticatedUrlInput = "";
	const mockCtx = {
		connection: {
			authenticatedUrl: (url: string) => {
				authenticatedUrlInput = url;
				return `${url}/?token=subpath-launch`;
			},
		},
	};
	const req = {
		url: "/tsctl/auto-login",
		headers: {
			"x-forwarded-for": "100.69.234.95",
			host: "dsh.example.com",
		},
	};
	const res = createMockResponse();

	handleAuthRedirect(
		mockCtx as unknown as Context,
		req as unknown as IncomingMessage,
		res as unknown as ServerResponse,
		{ trustedCidrs: ["100.64.0.0/10"] },
		{ pathPrefixes: ["/tsctl"] },
	);

	assert.equal(authenticatedUrlInput, "https://dsh.example.com/tsctl");
	assert.equal(
		res.headers.location,
		"https://dsh.example.com/tsctl/?token=subpath-launch",
	);
});

test("wrapAuthorizeIndex appends Secure to Set-Cookie when x-forwarded-proto is https", () => {
	let calledOriginal = false;
	const mockCtx = {
		connection: {
			authorizeIndex(_req: IncomingMessage, res: ServerResponse) {
				calledOriginal = true;
				res.writeHead(303, {
					"set-cookie": "dsh-auth=secret123; Path=/; SameSite=Strict",
				});
				res.end();
				return false;
			},
			admit: () => ({ rejection: 401 }),
		},
	};

	const dispose = wrapAuthorizeIndex(mockCtx as unknown as Context);
	const req = {
		url: "/?token=valid-token",
		headers: {
			"x-forwarded-proto": "https",
		},
	};
	const res = createMockResponse();

	const result = mockCtx.connection.authorizeIndex(
		req as unknown as IncomingMessage,
		res as unknown as ServerResponse,
	);
	assert.equal(result, false);
	assert.equal(calledOriginal, true);
	assert.equal(res.statusCode, 303);
	assert.match(res.headers["set-cookie"], /; Secure/);

	dispose();
});

test("wrapAuthorizeIndex serves 200 HTML bounce with custom loginRedirectPath when unauthenticated client is trusted", () => {
	let calledOriginal = false;
	const mockCtx = {
		connection: {
			authorizeIndex(_req: IncomingMessage, _res: ServerResponse) {
				calledOriginal = true;
				return false;
			},
			admit: () => ({ rejection: 401 }),
		},
	};

	const dispose = wrapAuthorizeIndex(mockCtx as unknown as Context, {
		auth: {
			trustedCidrs: ["100.64.0.0/10"],
			loginRedirectPath: "/custom-login",
		},
	});
	const req = {
		url: "/",
		headers: {
			"x-forwarded-for": "100.69.234.95",
			host: "dsh.example.com",
		},
	};
	const res = createMockResponse();

	const result = mockCtx.connection.authorizeIndex(
		req as unknown as IncomingMessage,
		res as unknown as ServerResponse,
	);
	assert.equal(result, false);
	assert.equal(calledOriginal, false);
	assert.equal(res.statusCode, 200);
	assert.match(res.body as string, /location\.replace\("\/custom-login"\)/);

	dispose();
});

test("wrapAuthorizeIndex passes through when user is authenticated", () => {
	let calledOriginal = false;
	const mockCtx = {
		connection: {
			authorizeIndex(_req: IncomingMessage, _res: ServerResponse) {
				calledOriginal = true;
				return true;
			},
			admit: () => ({ peer: { id: "peer-1" } }),
		},
	};

	const dispose = wrapAuthorizeIndex(mockCtx as unknown as Context);
	const req = {
		url: "/",
		headers: {
			cookie: "dsh-auth=valid",
			host: "dsh.example.com",
		},
	};
	const res = createMockResponse();

	const result = mockCtx.connection.authorizeIndex(
		req as unknown as IncomingMessage,
		res as unknown as ServerResponse,
	);
	assert.equal(result, true);
	assert.equal(calledOriginal, true);

	dispose();
});

test("wrapAuthorizeIndex falls back to original when unauthenticated from untrusted origin", () => {
	let calledOriginal = false;
	const mockCtx = {
		connection: {
			authorizeIndex(_req: IncomingMessage, res: ServerResponse) {
				calledOriginal = true;
				res.writeHead(401);
				res.end("unauthorized");
				return false;
			},
			admit: () => ({ rejection: 401 }),
		},
	};

	const dispose = wrapAuthorizeIndex(mockCtx as unknown as Context, {
		auth: {
			trustedCidrs: ["100.64.0.0/10"],
		},
	});
	const req = {
		url: "/",
		headers: {
			"x-forwarded-for": "198.51.100.1",
			host: "dsh.example.com",
		},
	};
	const res = createMockResponse();

	const result = mockCtx.connection.authorizeIndex(
		req as unknown as IncomingMessage,
		res as unknown as ServerResponse,
	);
	assert.equal(result, false);
	assert.equal(calledOriginal, true);
	assert.equal(res.statusCode, 401);

	dispose();
});

test("apply registers routes and mounts pathPrefixes", () => {
	const registeredRoutes: Array<{ path: string }> = [];
	let tapped = false;
	let effectCount = 0;
	const mockCtx = {
		webServer: {
			register(route: { path: string }) {
				registeredRoutes.push(route);
				return () => true;
			},
			tapIndex(_fn: (html: string) => string) {
				tapped = true;
				return () => true;
			},
		},
		connection: {
			authorizeIndex: () => true,
			admit: () => ({ peer: {} }),
		},
		effect(fn: () => unknown) {
			effectCount++;
			return fn();
		},
	};

	apply(mockCtx as unknown as Context, {
		auth: {
			authRoutes: ["/login", "/auth/tailscale", "/auto-login"],
		},
		pwa: {
			pathPrefixes: ["tsctl", "/tsctl/"],
		},
	});

	const paths = registeredRoutes.map((r) => r.path);
	assert.ok(paths.includes("/login"));
	assert.ok(paths.includes("/auth/tailscale"));
	assert.ok(paths.includes("/auto-login"));
	assert.ok(paths.includes("/tsctl/login"));
	assert.ok(paths.includes("/tsctl/auth/tailscale"));
	assert.ok(paths.includes("/tsctl/auto-login"));
	assert.ok(paths.includes("/manifest.webmanifest"));
	assert.ok(paths.includes("/icons"));
	assert.ok(paths.includes("/tsctl/manifest.webmanifest"));
	assert.ok(paths.includes("/tsctl/icons"));
	assert.equal(tapped, true);
	assert.ok(effectCount > 0);
});
