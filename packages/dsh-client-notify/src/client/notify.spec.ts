import assert from "node:assert/strict";
import { Context, Service } from "@deepseek-ai/cordis";
import type { SessionPendingInteraction } from "@deepseek-ai/dsh-client-ui-session/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apply, getSessionAlert, hasRecentMessage, inject } from "./index.ts";
import * as notifyModule from "./notify.ts";
import * as soundModule from "./sound.ts";

describe("dsh-client-notify status debouncing", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("debounces 'Agent stopped' notification during rapid workflow step transitions", async () => {
		const showSpy = vi
			.spyOn(notifyModule, "showBrowserNotification")
			.mockImplementation(() => {});

		const ctx = new Context();
		let statusListener:
			| ((sessionId: SessionId, running: boolean) => void)
			| undefined;

		ctx.provide("remote", {
			$on: (
				_event: string,
				listener: (sessionId: SessionId, running: boolean) => void,
			) => {
				statusListener = listener;
				return () => {
					statusListener = undefined;
				};
			},
			session: {
				events: vi.fn().mockResolvedValue({
					ok: true,
					value: {
						records: [
							{ event: { type: "assistant/message", time: Date.now() } },
						],
					},
				}),
			},
		});

		const sid = "session-1" as SessionId;

		ctx.provide("sessions", {
			list: {
				getSnapshot: () => ({
					byId: {
						[sid]: { updatedAt: Date.now() },
					},
				}),
			},
			subagentAddress: () => undefined,
		});

		ctx.provide("uiSession", {
			sessionStatus: {
				getSnapshot: () => new Map(),
				subscribe: () => () => {},
			},
		});

		apply(ctx);

		assert.ok(statusListener);
		const dispatchStatus = statusListener;

		// Step 1 starts
		dispatchStatus(sid, true);
		expect(showSpy).not.toHaveBeenCalled();

		// Step 1 finishes (settles to idle)
		dispatchStatus(sid, false);
		expect(showSpy).not.toHaveBeenCalled();

		// Advance 300ms (workflow runner advances to Step 2 before 1000ms debounce expires)
		await vi.advanceTimersByTimeAsync(300);
		expect(showSpy).not.toHaveBeenCalled();

		// Step 2 starts
		dispatchStatus(sid, true);

		// Advance past 1000ms from Step 1 finish
		await vi.advanceTimersByTimeAsync(1000);
		expect(showSpy).not.toHaveBeenCalled();

		// Step 2 finishes (workflow completes all steps)
		dispatchStatus(sid, false);
		expect(showSpy).not.toHaveBeenCalled();

		// 500ms elapsed: still debouncing
		await vi.advanceTimersByTimeAsync(500);
		expect(showSpy).not.toHaveBeenCalled();

		// Debounce time reaches 3000ms: fires exactly once
		await vi.advanceTimersByTimeAsync(2500);
		expect(showSpy).toHaveBeenCalledTimes(1);
		expect(showSpy).toHaveBeenCalledWith(
			"DeepSeek Harness",
			"Agent stopped",
			"stop",
		);
	});

	it("does not notify when subagents stop", async () => {
		const showSpy = vi
			.spyOn(notifyModule, "showBrowserNotification")
			.mockImplementation(() => {});

		const ctx = new Context();
		let statusListener:
			| ((sessionId: SessionId, running: boolean) => void)
			| undefined;

		ctx.provide("remote", {
			$on: (
				_event: string,
				listener: (sessionId: SessionId, running: boolean) => void,
			) => {
				statusListener = listener;
				return () => {
					statusListener = undefined;
				};
			},
		});

		ctx.provide("sessions", {
			list: {
				getSnapshot: () => ({
					byId: {
						"subagent-1": { origin: "subagent" },
					},
				}),
			},
			subagentAddress: () => undefined,
		});

		ctx.provide("uiSession", {
			sessionStatus: {
				getSnapshot: () => new Map(),
				subscribe: () => () => {},
			},
		});

		apply(ctx);

		assert.ok(statusListener);
		const dispatchStatus = statusListener;
		const sid = "subagent-1" as SessionId;
		dispatchStatus(sid, true);
		dispatchStatus(sid, false);

		vi.advanceTimersByTime(4000);
		expect(showSpy).not.toHaveBeenCalled();
	});

	it("suppresses parent notification while child subagents are running", async () => {
		const showSpy = vi
			.spyOn(notifyModule, "showBrowserNotification")
			.mockImplementation(() => {});

		const ctx = new Context();
		let statusListener:
			| ((sessionId: SessionId, running: boolean) => void)
			| undefined;

		ctx.provide("remote", {
			$on: (
				_event: string,
				listener: (sessionId: SessionId, running: boolean) => void,
			) => {
				statusListener = listener;
				return () => {
					statusListener = undefined;
				};
			},
			session: {
				events: vi.fn().mockResolvedValue({
					ok: true,
					value: {
						records: [
							{ event: { type: "assistant/message", time: Date.now() } },
						],
					},
				}),
			},
		});

		const sessionsSnapshot = {
			byId: {
				"parent-1": { running: false, updatedAt: Date.now() },
				"subagent-1": {
					origin: "subagent",
					parentId: "parent-1" as SessionId,
					running: true,
				},
			},
		};

		ctx.provide("sessions", {
			list: {
				getSnapshot: () => sessionsSnapshot,
			},
			subagentAddress: () => undefined,
		});

		ctx.provide("uiSession", {
			sessionStatus: {
				getSnapshot: () => new Map(),
				subscribe: () => () => {},
			},
		});

		apply(ctx);

		assert.ok(statusListener);
		const dispatchStatus = statusListener;

		// Parent step completes and settles to idle, but child subagent is actively running
		dispatchStatus("parent-1" as SessionId, true);
		dispatchStatus("parent-1" as SessionId, false);

		await vi.advanceTimersByTimeAsync(5000);
		expect(showSpy).not.toHaveBeenCalled();

		// Subagent finishes
		sessionsSnapshot.byId["subagent-1"].running = false;
		dispatchStatus("subagent-1" as SessionId, true);
		dispatchStatus("subagent-1" as SessionId, false);

		// Debounce arms on parent: still silent at 2000ms
		await vi.advanceTimersByTimeAsync(2000);
		expect(showSpy).not.toHaveBeenCalled();

		// At 3000ms, parent notification fires
		await vi.advanceTimersByTimeAsync(1000);
		expect(showSpy).toHaveBeenCalledTimes(1);
		expect(showSpy).toHaveBeenCalledWith(
			"DeepSeek Harness",
			"Agent stopped",
			"stop",
		);
	});

	it("cancels parent debounce if a subsequent subagent starts running", async () => {
		const showSpy = vi
			.spyOn(notifyModule, "showBrowserNotification")
			.mockImplementation(() => {});

		const ctx = new Context();
		let statusListener:
			| ((sessionId: SessionId, running: boolean) => void)
			| undefined;

		ctx.provide("remote", {
			$on: (
				_event: string,
				listener: (sessionId: SessionId, running: boolean) => void,
			) => {
				statusListener = listener;
				return () => {
					statusListener = undefined;
				};
			},
		});

		const sessionsSnapshot = {
			byId: {
				"parent-1": { running: false },
				"subagent-1": {
					origin: "subagent",
					parentId: "parent-1" as SessionId,
					running: false,
				},
				"subagent-2": {
					origin: "subagent",
					parentId: "parent-1" as SessionId,
					running: true,
				},
			},
		};

		ctx.provide("sessions", {
			list: {
				getSnapshot: () => sessionsSnapshot,
			},
			subagentAddress: () => undefined,
		});

		ctx.provide("uiSession", {
			sessionStatus: {
				getSnapshot: () => new Map(),
				subscribe: () => () => {},
			},
		});

		apply(ctx);

		assert.ok(statusListener);
		const dispatchStatus = statusListener;

		// Subagent-1 finishes, parent is idle
		dispatchStatus("subagent-1" as SessionId, true);
		dispatchStatus("subagent-1" as SessionId, false);

		// Advance 1000ms into debounce
		vi.advanceTimersByTime(1000);
		expect(showSpy).not.toHaveBeenCalled();

		// Subagent-2 starts running
		dispatchStatus("subagent-2" as SessionId, true);

		// Advance well past 3000ms
		vi.advanceTimersByTime(5000);
		expect(showSpy).not.toHaveBeenCalled();
	});
});

describe("showBrowserNotification", () => {
	const originalNavigator = globalThis.navigator;

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		delete (globalThis as unknown as { window?: unknown }).window;
		delete (globalThis as unknown as { document?: unknown }).document;
		Object.defineProperty(globalThis, "navigator", {
			value: originalNavigator,
			configurable: true,
			writable: true,
		});
	});

	it("prefers ServiceWorker showNotification when registered", async () => {
		const showNotificationMock = vi.fn().mockResolvedValue(undefined);
		const getRegistrationMock = vi.fn().mockResolvedValue({
			showNotification: showNotificationMock,
		});

		(globalThis as unknown as { document: unknown }).document = {
			hasFocus: () => false,
			hidden: true,
		};

		Object.defineProperty(globalThis, "navigator", {
			value: {
				serviceWorker: {
					getRegistration: getRegistrationMock,
				},
			},
			configurable: true,
			writable: true,
		});

		const mockNotification = vi.fn();
		(mockNotification as unknown as { permission: string }).permission =
			"granted";

		(globalThis as unknown as { window: unknown }).window = {
			Notification: mockNotification,
			focus: vi.fn(),
		};

		notifyModule.showBrowserNotification(
			"DeepSeek Harness",
			"Test message",
			"stop",
		);

		await Promise.resolve();
		await Promise.resolve();

		expect(showNotificationMock).toHaveBeenCalledWith("DeepSeek Harness", {
			body: "Test message",
			icon: "/favicon.svg",
		});
		expect(mockNotification).not.toHaveBeenCalled();
	});

	it("falls back to Notification constructor when ServiceWorker is unavailable", async () => {
		(globalThis as unknown as { document: unknown }).document = {
			hasFocus: () => false,
			hidden: true,
		};

		Object.defineProperty(globalThis, "navigator", {
			value: {},
			configurable: true,
			writable: true,
		});

		const mockNotification = vi.fn().mockReturnValue({
			onclick: null,
			close: vi.fn(),
		});
		(mockNotification as unknown as { permission: string }).permission =
			"granted";

		(globalThis as unknown as { window: unknown }).window = {
			Notification: mockNotification,
			focus: vi.fn(),
		};

		notifyModule.showBrowserNotification(
			"DeepSeek Harness",
			"Direct message",
			"stop",
		);

		expect(mockNotification).toHaveBeenCalledWith("DeepSeek Harness", {
			body: "Direct message",
			icon: "/favicon.svg",
		});
	});

	it("handles constructor exception safely on platforms forbidding new Notification()", async () => {
		(globalThis as unknown as { document: unknown }).document = {
			hasFocus: () => false,
			hidden: true,
		};

		Object.defineProperty(globalThis, "navigator", {
			value: {},
			configurable: true,
			writable: true,
		});

		const mockNotification = vi.fn().mockImplementation(() => {
			throw new TypeError("Illegal constructor");
		});
		(mockNotification as unknown as { permission: string }).permission =
			"granted";

		(globalThis as unknown as { window: unknown }).window = {
			Notification: mockNotification,
			focus: vi.fn(),
		};

		expect(() => {
			notifyModule.showBrowserNotification(
				"DeepSeek Harness",
				"Error test",
				"stop",
			);
		}).not.toThrow();
	});

	it("uses navigator.serviceWorker.ready when getRegistration returns undefined", async () => {
		const showNotificationMock = vi.fn().mockResolvedValue(undefined);
		const getRegistrationMock = vi.fn().mockResolvedValue(undefined);

		(globalThis as unknown as { document: unknown }).document = {
			hasFocus: () => false,
			hidden: true,
		};

		Object.defineProperty(globalThis, "navigator", {
			value: {
				serviceWorker: {
					getRegistration: getRegistrationMock,
					ready: Promise.resolve({
						showNotification: showNotificationMock,
					}),
				},
			},
			configurable: true,
			writable: true,
		});

		const mockNotification = vi.fn();
		(mockNotification as unknown as { permission: string }).permission =
			"granted";

		(globalThis as unknown as { window: unknown }).window = {
			Notification: mockNotification,
			focus: vi.fn(),
		};

		notifyModule.showBrowserNotification(
			"DeepSeek Harness",
			"Ready message",
			"stop",
		);

		await vi.waitFor(() => {
			expect(showNotificationMock).toHaveBeenCalledWith("DeepSeek Harness", {
				body: "Ready message",
				icon: "/favicon.svg",
			});
		});
		expect(mockNotification).not.toHaveBeenCalled();
	});

	it("does not suppress notifications on mobile devices even when document is focused and visible", () => {
		(globalThis as unknown as { document: unknown }).document = {
			hasFocus: () => true,
			hidden: false,
		};

		Object.defineProperty(globalThis, "navigator", {
			value: {
				maxTouchPoints: 5,
			},
			configurable: true,
			writable: true,
		});

		const mockNotification = vi.fn().mockReturnValue({
			onclick: null,
			close: vi.fn(),
		});
		(mockNotification as unknown as { permission: string }).permission =
			"granted";

		(globalThis as unknown as { window: unknown }).window = {
			Notification: mockNotification,
			matchMedia: () => ({ matches: true }),
			focus: vi.fn(),
		};

		notifyModule.showBrowserNotification(
			"DeepSeek Harness",
			"Mobile alert",
			"stop",
		);

		expect(mockNotification).toHaveBeenCalledWith("DeepSeek Harness", {
			body: "Mobile alert",
			icon: "/favicon.svg",
		});
	});
});

describe("registerServiceWorker", () => {
	const originalNavigator = globalThis.navigator;

	afterEach(() => {
		Object.defineProperty(globalThis, "navigator", {
			value: originalNavigator,
			configurable: true,
			writable: true,
		});
	});

	it("calls navigator.serviceWorker.register with /sw.js", () => {
		const registerMock = vi.fn().mockReturnValue(Promise.resolve());
		Object.defineProperty(globalThis, "navigator", {
			value: {
				serviceWorker: {
					register: registerMock,
				},
			},
			configurable: true,
			writable: true,
		});

		notifyModule.registerServiceWorker();

		expect(registerMock).toHaveBeenCalledWith("/sw.js", { scope: "/" });
	});
});

describe("getSessionAlert", () => {
	it("returns question for standard questions", () => {
		const interaction: SessionPendingInteraction = {
			key: "q-1",
			kind: "question",
			sessionId: "s1" as SessionId,
		};
		expect(getSessionAlert(interaction)).toBe("question");
	});

	it("returns permission for approval interactions", () => {
		const interaction: SessionPendingInteraction = {
			key: "app-1",
			kind: "approval",
			sessionId: "s1" as SessionId,
		};
		expect(getSessionAlert(interaction)).toBe("permission");
	});

	it("returns permission for acp-permission key prefixes", () => {
		const interaction: SessionPendingInteraction = {
			key: "acp-permission:fs-1",
			kind: "question",
			sessionId: "s1" as SessionId,
		};
		expect(getSessionAlert(interaction)).toBe("permission");
	});

	it("returns permission for question interactions containing acp-permission question IDs", () => {
		const interaction = {
			key: "interaction-1",
			kind: "question",
			sessionId: "s1" as SessionId,
			questions: [{ id: "acp-permission:cmd-1" }],
		} as unknown as SessionPendingInteraction;
		expect(getSessionAlert(interaction)).toBe("permission");
	});

	it("handles non-object questions safely without throwing", () => {
		const interaction = {
			key: "interaction-null",
			kind: "question",
			sessionId: "s1" as SessionId,
			questions: [null, undefined, "not an object"],
		} as unknown as SessionPendingInteraction;
		expect(getSessionAlert(interaction)).toBe("question");
	});

	it("returns error for other non-plan-review interactions", () => {
		const interaction: SessionPendingInteraction = {
			key: "err-1",
			kind: "error",
			sessionId: "s1" as SessionId,
		};
		expect(getSessionAlert(interaction)).toBe("error");
	});

	it("returns undefined for plan-review interactions", () => {
		const interaction: SessionPendingInteraction = {
			key: "plan-1",
			kind: "plan-review",
			sessionId: "s1" as SessionId,
		};
		expect(getSessionAlert(interaction)).toBeUndefined();
	});
});

describe("showBrowserNotification sound routing", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		delete (globalThis as unknown as { window?: unknown }).window;
		delete (globalThis as unknown as { document?: unknown }).document;
	});

	it("plays pop chime when sound is stop", () => {
		const popSpy = vi
			.spyOn(soundModule, "playPopChime")
			.mockImplementation(() => {});
		const alertSpy = vi
			.spyOn(soundModule, "playAlertChime")
			.mockImplementation(() => {});

		(globalThis as unknown as { document: unknown }).document = {
			hasFocus: () => false,
			hidden: true,
		};
		(globalThis as unknown as { window: unknown }).window = {
			Notification: { permission: "denied" },
		};

		notifyModule.showBrowserNotification("Title", "Message", "stop");
		expect(popSpy).toHaveBeenCalledTimes(1);
		expect(alertSpy).not.toHaveBeenCalled();
	});

	it("plays alert chime when sound is alert", () => {
		const popSpy = vi
			.spyOn(soundModule, "playPopChime")
			.mockImplementation(() => {});
		const alertSpy = vi
			.spyOn(soundModule, "playAlertChime")
			.mockImplementation(() => {});

		(globalThis as unknown as { document: unknown }).document = {
			hasFocus: () => false,
			hidden: true,
		};
		(globalThis as unknown as { window: unknown }).window = {
			Notification: { permission: "denied" },
		};

		notifyModule.showBrowserNotification("Title", "Message", "alert");
		expect(alertSpy).toHaveBeenCalledTimes(1);
		expect(popSpy).not.toHaveBeenCalled();
	});
});

describe("dsh-client-notify pending interaction alerts", () => {
	let showSpy: ReturnType<typeof vi.spyOn>;
	let snapshotMap: Map<
		SessionId,
		{ pendingInteraction?: SessionPendingInteraction }
	>;
	let statusListeners: Array<() => void>;

	beforeEach(() => {
		showSpy = vi
			.spyOn(notifyModule, "showBrowserNotification")
			.mockImplementation(() => {});
		snapshotMap = new Map();
		statusListeners = [];
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function setupPlugin() {
		const ctx = new Context();
		ctx.provide("remote", {
			$on: () => () => {},
		});
		ctx.provide("sessions", {
			list: {
				getSnapshot: () => ({
					byId: {
						"session-1": { running: true },
						"subagent-1": { origin: "subagent", parentId: "session-1" },
					},
				}),
			},
			subagentAddress: (id: SessionId) =>
				id === "subagent-1" ? ("subagent-addr" as never) : undefined,
		});
		ctx.provide("uiSession", {
			sessionStatus: {
				getSnapshot: () => snapshotMap,
				subscribe: (listener: () => void) => {
					statusListeners.push(listener);
					return () => {
						const idx = statusListeners.indexOf(listener);
						if (idx >= 0) statusListeners.splice(idx, 1);
					};
				},
			},
		});

		apply(ctx);
	}

	it("dispatches alert sound for questions", () => {
		setupPlugin();
		snapshotMap.set("session-1" as SessionId, {
			pendingInteraction: {
				key: "q-1",
				kind: "question",
				sessionId: "session-1" as SessionId,
				questions: [{ question: "Which file?" }],
			} as unknown as SessionPendingInteraction,
		});

		for (const l of statusListeners) l();

		expect(showSpy).toHaveBeenCalledWith(
			"DeepSeek Harness",
			"Question: Which file?",
			"alert",
		);
	});

	it("dispatches alert sound for approvals", () => {
		setupPlugin();
		snapshotMap.set("session-1" as SessionId, {
			pendingInteraction: {
				key: "app-1",
				kind: "approval",
				sessionId: "session-1" as SessionId,
				toolName: "bash",
			} as unknown as SessionPendingInteraction,
		});

		for (const l of statusListeners) l();

		expect(showSpy).toHaveBeenCalledWith(
			"DeepSeek Harness",
			"Tool approval requested: bash",
			"alert",
		);
	});

	it("dispatches alert sound for ACP permissions using question text when available", () => {
		setupPlugin();
		snapshotMap.set("session-1" as SessionId, {
			pendingInteraction: {
				key: "acp-permission:read_file",
				kind: "question",
				sessionId: "session-1" as SessionId,
				questions: [{ question: "Read file .env?" }],
			} as unknown as SessionPendingInteraction,
		});

		for (const l of statusListeners) l();

		expect(showSpy).toHaveBeenCalledWith(
			"DeepSeek Harness",
			"Tool approval requested: Read file .env?",
			"alert",
		);
	});

	it("falls back to tool when ACP permission has no question text", () => {
		setupPlugin();
		snapshotMap.set("session-1" as SessionId, {
			pendingInteraction: {
				key: "acp-permission:read_file",
				kind: "question",
				sessionId: "session-1" as SessionId,
			} as SessionPendingInteraction,
		});

		for (const l of statusListeners) l();

		expect(showSpy).toHaveBeenCalledWith(
			"DeepSeek Harness",
			"Tool approval requested: tool",
			"alert",
		);
	});

	it("dispatches alert sound for other non-stop reasons / errors", () => {
		setupPlugin();
		snapshotMap.set("session-1" as SessionId, {
			pendingInteraction: {
				key: "err-1",
				kind: "execution-error",
				sessionId: "session-1" as SessionId,
			} as SessionPendingInteraction,
		});

		for (const l of statusListeners) l();

		expect(showSpy).toHaveBeenCalledWith(
			"DeepSeek Harness",
			"Action required: execution-error",
			"alert",
		);
	});

	it("ignores plan-review and subagents", () => {
		setupPlugin();
		snapshotMap.set("session-1" as SessionId, {
			pendingInteraction: {
				key: "plan-1",
				kind: "plan-review",
				sessionId: "session-1" as SessionId,
			} as SessionPendingInteraction,
		});
		snapshotMap.set("subagent-1" as SessionId, {
			pendingInteraction: {
				key: "q-sub",
				kind: "question",
				sessionId: "subagent-1" as SessionId,
			} as SessionPendingInteraction,
		});

		for (const l of statusListeners) l();

		expect(showSpy).not.toHaveBeenCalled();
	});
});

describe("hasRecentMessage", () => {
	const page = (time: number) => ({
		ok: true,
		value: { records: [{ event: { type: "assistant/message", time } }] },
	});

	it("returns true when the last message is within the window", async () => {
		const ctx = new Context();
		ctx.provide("sessions", { list: { getSnapshot: () => ({ byId: {} }) } });
		ctx.provide("remote", {
			session: {
				events: vi.fn().mockResolvedValue(page(Date.now() - 5_000)),
			},
		});

		const result = await hasRecentMessage(ctx, "sess-1" as SessionId);
		expect(result).toBe(true);
	});

	it("returns false when the last message is older than the window", async () => {
		const ctx = new Context();
		ctx.provide("sessions", { list: { getSnapshot: () => ({ byId: {} }) } });
		ctx.provide("remote", {
			session: {
				events: vi.fn().mockResolvedValue(page(Date.now() - 90_000)),
			},
		});

		const result = await hasRecentMessage(ctx, "sess-1" as SessionId);
		expect(result).toBe(false);
	});

	it("ignores summary.updatedAt and reads the message log", async () => {
		const events = vi.fn().mockResolvedValue(page(Date.now() - 90_000));
		const ctx = new Context();
		ctx.provide("sessions", {
			list: {
				getSnapshot: () => ({
					byId: { "sess-1": { updatedAt: Date.now() } },
				}),
			},
		});
		ctx.provide("remote", { session: { events } });

		const result = await hasRecentMessage(ctx, "sess-1" as SessionId);
		expect(result).toBe(false);
		expect(events).toHaveBeenCalledTimes(1);
	});

	it("returns false when session has no messages", async () => {
		const ctx = new Context();
		ctx.provide("sessions", { list: { getSnapshot: () => ({ byId: {} }) } });
		ctx.provide("remote", {
			session: {
				events: vi.fn().mockResolvedValue({ ok: true, value: { records: [] } }),
			},
		});

		const result = await hasRecentMessage(ctx, "sess-empty" as SessionId);
		expect(result).toBe(false);
	});

	it("returns true when remote.session.events rejects", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const ctx = new Context();
		ctx.provide("sessions", { list: { getSnapshot: () => ({ byId: {} }) } });
		ctx.provide("remote", {
			session: {
				events: vi.fn().mockRejectedValue(new Error("RPC failure")),
			},
		});

		const result = await hasRecentMessage(ctx, "sess-error" as SessionId);
		expect(result).toBe(true);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("returns true when remote.session.events resolves with an error", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const ctx = new Context();
		ctx.provide("sessions", { list: { getSnapshot: () => ({ byId: {} }) } });
		ctx.provide("remote", {
			session: {
				events: vi
					.fn()
					.mockResolvedValue({ ok: false, error: new Error("denied") }),
			},
		});

		const result = await hasRecentMessage(ctx, "sess-denied" as SessionId);
		expect(result).toBe(true);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("reads one message page and skips trailing non-message records", async () => {
		const events = vi.fn().mockResolvedValue({
			ok: true,
			value: {
				records: [
					{ event: { type: "command/done", time: Date.now() } },
					{ event: { type: "tool/result", time: Date.now() } },
					{ event: { type: "assistant/message", time: Date.now() - 90_000 } },
				],
			},
		});
		const ctx = new Context();
		ctx.provide("sessions", { list: { getSnapshot: () => ({ byId: {} }) } });
		ctx.provide("remote", { session: { events } });

		const result = await hasRecentMessage(ctx, "sess-tail" as SessionId);

		expect(result).toBe(false);
		expect(events).toHaveBeenCalledWith(
			expect.objectContaining({ maxMessages: 1 }),
		);
	});

	it("reports a recent message even when non-message records trail it", async () => {
		const ctx = new Context();
		ctx.provide("sessions", { list: { getSnapshot: () => ({ byId: {} }) } });
		ctx.provide("remote", {
			session: {
				events: vi.fn().mockResolvedValue({
					ok: true,
					value: {
						records: [
							{ event: { type: "assistant/message", time: Date.now() } },
							{ event: { type: "command/done", time: Date.now() } },
						],
					},
				}),
			},
		});

		const result = await hasRecentMessage(ctx, "sess-trailing" as SessionId);

		expect(result).toBe(true);
	});
});

describe("background script notification suppression", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("suppresses stop notification when a background script runs silently without messages", async () => {
		const showSpy = vi
			.spyOn(notifyModule, "showBrowserNotification")
			.mockImplementation(() => {});

		const ctx = new Context();
		let statusListener:
			| ((sessionId: SessionId, running: boolean) => void)
			| undefined;

		ctx.provide("remote", {
			$on: (
				_event: string,
				listener: (sessionId: SessionId, running: boolean) => void,
			) => {
				statusListener = listener;
				return () => {
					statusListener = undefined;
				};
			},
			session: {
				events: vi.fn().mockResolvedValue({
					ok: true,
					value: {
						records: [
							{
								event: {
									type: "assistant/message",
									time: Date.now() - 300_000,
								},
							},
						],
					},
				}),
			},
		});

		ctx.provide("sessions", {
			list: {
				getSnapshot: () => ({
					byId: {
						"sess-bg": {
							running: false,
							updatedAt: Date.now() - 300_000,
						},
					},
				}),
			},
			subagentAddress: () => undefined,
		});

		ctx.provide("uiSession", {
			sessionStatus: {
				getSnapshot: () => new Map(),
				subscribe: () => () => {},
			},
		});

		apply(ctx);

		assert.ok(statusListener);
		const sid = "sess-bg" as SessionId;

		// Background script starts
		statusListener(sid, true);
		// Background script finishes silent poll
		statusListener(sid, false);

		// Advance past 3000ms debounce
		await vi.advanceTimersByTimeAsync(3500);

		// Stop notification should be suppressed!
		expect(showSpy).not.toHaveBeenCalled();
	});

	it("fires stop notification when a background script emits waking prompt and assistant messages", async () => {
		const showSpy = vi
			.spyOn(notifyModule, "showBrowserNotification")
			.mockImplementation(() => {});

		const ctx = new Context();
		let statusListener:
			| ((sessionId: SessionId, running: boolean) => void)
			| undefined;

		ctx.provide("remote", {
			$on: (
				_event: string,
				listener: (sessionId: SessionId, running: boolean) => void,
			) => {
				statusListener = listener;
				return () => {
					statusListener = undefined;
				};
			},
			session: {
				events: vi.fn().mockResolvedValue({
					ok: true,
					value: {
						records: [
							{
								event: {
									type: "assistant/message",
									time: Date.now(),
								},
							},
						],
					},
				}),
			},
		});

		ctx.provide("sessions", {
			list: {
				getSnapshot: () => ({
					byId: {
						"sess-bg": {
							running: false,
							updatedAt: Date.now() - 300_000,
						},
					},
				}),
			},
			subagentAddress: () => undefined,
		});

		ctx.provide("uiSession", {
			sessionStatus: {
				getSnapshot: () => new Map(),
				subscribe: () => () => {},
			},
		});

		apply(ctx);

		assert.ok(statusListener);
		const sid = "sess-bg" as SessionId;

		// Script woke agent with prompt -> agent runs -> model produced assistant message
		statusListener(sid, true);
		statusListener(sid, false);

		await vi.advanceTimersByTimeAsync(3500);

		// Stop notification fires because assistant message was committed in the last minute
		expect(showSpy).toHaveBeenCalledTimes(1);
		expect(showSpy).toHaveBeenCalledWith(
			"DeepSeek Harness",
			"Agent stopped",
			"stop",
		);
	});

	it("stays silent when a long run appended no chat message", async () => {
		const showSpy = vi
			.spyOn(notifyModule, "showBrowserNotification")
			.mockImplementation(() => {});

		const ctx = new Context();
		let statusListener:
			| ((sessionId: SessionId, running: boolean) => void)
			| undefined;

		ctx.provide("remote", {
			$on: (
				_event: string,
				listener: (sessionId: SessionId, running: boolean) => void,
			) => {
				statusListener = listener;
				return () => {
					statusListener = undefined;
				};
			},
			session: {
				events: vi.fn().mockResolvedValue({
					ok: true,
					value: {
						records: [
							{
								event: {
									type: "assistant/message",
									time: Date.now() - 300_000,
								},
							},
						],
					},
				}),
			},
		});

		ctx.provide("sessions", {
			list: {
				getSnapshot: () => ({
					byId: {
						"sess-long": {
							running: false,
							updatedAt: Date.now() - 300_000,
						},
					},
				}),
			},
			subagentAddress: () => undefined,
		});

		ctx.provide("uiSession", {
			sessionStatus: {
				getSnapshot: () => new Map(),
				subscribe: () => () => {},
			},
		});

		apply(ctx);

		assert.ok(statusListener);
		const sid = "sess-long" as SessionId;

		statusListener(sid, true);
		// Only the message window counts: subagent, print and gate steps append no chat message.
		await vi.advanceTimersByTimeAsync(120_000);
		expect(showSpy).not.toHaveBeenCalled();

		statusListener(sid, false);
		await vi.advanceTimersByTimeAsync(3500);

		expect(showSpy).not.toHaveBeenCalled();
	});
});

describe("dsh-client-notify remote injection", () => {
	it("reads session events through the traced remote.session service", async () => {
		const events = vi
			.fn()
			.mockResolvedValue({ ok: true, value: { records: [] } });
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const ctx = new Context();
		const sessionService = { events };

		// The gateway installs each remote namespace as its own traced service
		// from a sibling fiber, so `ctx.remote.session` resolves through
		// "remote.session" and needs that name in `inject`.
		class RemoteService extends Service {
			readonly session = sessionService;
			constructor(gatewayCtx: Context) {
				super(gatewayCtx, "remote");
			}
			$on(): () => void {
				return () => {};
			}
		}

		await ctx.plugin({
			name: "api-gateway",
			apply: (gatewayCtx) => {
				new RemoteService(gatewayCtx);
			},
		});
		await ctx.plugin({
			name: "api-session",
			apply: (sessionCtx) => {
				sessionCtx.provide("remote.session", sessionService);
			},
		});
		ctx.provide("sessions", {
			list: { getSnapshot: () => ({ byId: {} }) },
			subagentAddress: () => undefined,
		});
		ctx.provide("uiSession", {
			sessionStatus: {
				getSnapshot: () => new Map(),
				subscribe: () => () => {},
			},
		});

		let pluginCtx: Context | undefined;
		await ctx.plugin({
			name: "dsh-client-notify",
			inject,
			apply: (child) => {
				pluginCtx = child;
				apply(child);
			},
		});

		const result = await hasRecentMessage(
			pluginCtx as Context,
			"sess-1" as SessionId,
		);
		expect(events).toHaveBeenCalledTimes(1);
		expect(warn).not.toHaveBeenCalled();
		expect(result).toBe(false);
	});
});
