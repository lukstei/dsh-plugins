import type { IncomingMessage, ServerResponse } from "node:http";
import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import { apply, SERVICE_WORKER_SCRIPT, type WebRoute } from "./index.ts";

describe("dsh-client-notify host service worker route", () => {
	it("registers /sw.js and /tsctl/sw.js exact routes on webServer", () => {
		const ctx = new Context();
		const registeredRoutes: WebRoute[] = [];

		ctx.provide("webServer", {
			register: (route: WebRoute) => {
				registeredRoutes.push(route);
				return () => {};
			},
		});

		apply(ctx);

		expect(registeredRoutes).toHaveLength(2);
		expect(registeredRoutes[0]?.path).toBe("/sw.js");
		expect(registeredRoutes[0]?.kind).toBe("exact");
		expect(registeredRoutes[1]?.path).toBe("/tsctl/sw.js");
		expect(registeredRoutes[1]?.kind).toBe("exact");

		// Test handler response
		const headers: Record<string, string> = {};
		let responseBody = "";
		let responseStatus = 0;

		const mockReq = {} as unknown as IncomingMessage;
		const mockRes = {
			writeHead: vi.fn((status: number, hdrs: Record<string, string>) => {
				responseStatus = status;
				Object.assign(headers, hdrs);
			}),
			end: vi.fn((body: string) => {
				responseBody = body;
			}),
		} as unknown as ServerResponse;

		registeredRoutes[0]?.handler(mockReq, mockRes);

		expect(responseStatus).toBe(200);
		expect(headers["content-type"]).toBe(
			"application/javascript; charset=utf-8",
		);
		expect(headers["service-worker-allowed"]).toBe("/");
		expect(responseBody).toBe(SERVICE_WORKER_SCRIPT);
		expect(responseBody).toContain("notificationclick");
	});

	it("throws if webServer is not available", () => {
		const ctx = new Context();
		expect(() => apply(ctx)).toThrow();
	});
});
