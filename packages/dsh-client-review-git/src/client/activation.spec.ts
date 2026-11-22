import assert from "node:assert/strict";
import { Context, type Plugin } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SplitOverlay } from "@lukstei/dsh-client-split-view/client-contract";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import * as zod from "zod";

afterEach(() => vi.unstubAllGlobals());

function isClientPlugin(value: unknown): value is Plugin.Object<void> {
	return (
		typeof value === "object" &&
		value !== null &&
		"apply" in value &&
		typeof value.apply === "function" &&
		"inject" in value &&
		Array.isArray(value.inject) &&
		value.inject.every((service: unknown) => typeof service === "string")
	);
}

test.each(["absent", "before", "after"])(
	"dsh-client-review client activation with SplitView arriving: %s",
	async (splitTiming) => {
		const withSplit = splitTiming !== "absent";
		vi.resetModules();
		let clientPlugin: unknown;
		vi.stubGlobal("window", {
			__ModuleLoader__: {
				load: ({
					factory,
				}: {
					id: string;
					factory: (require: (mod: string) => unknown) => unknown;
				}) => {
					clientPlugin = factory((mod: string) => {
						if (mod === "react-dom") return ReactDOM;
						if (mod === "zod") return zod;
						if (mod === "react") {
							return React;
						}
						if (mod === "react/jsx-runtime") {
							return jsxRuntime;
						}
						if (mod === "@deepseek-ai/dsh-client-ui-primitives") {
							return {
								DiffBlock: () => null,
								Tooltip: ({ children }: { children: React.ReactNode }) =>
									children,
								Button: ({
									icon,
									...props
								}: React.ComponentProps<"button"> & {
									icon: React.ReactNode;
								}) =>
									React.createElement(
										"button",
										{ type: "button", ...props },
										icon,
									),
								IconBranchOutlineRegular: ({ size }: { size: number }) =>
									React.createElement("svg", { width: size, height: size }),
							};
						}
						return {};
					});
				},
			},
		});

		// @ts-expect-error Bundle output has no generated declaration file
		await import("../../dist/client.js");
		assert(isClientPlugin(clientPlugin));

		const ctx = new Context();
		const registeredTabs: Array<{ id: string; kind: string }> = [];
		const registeredSlots: Array<{ name: string; key?: string; id?: string }> =
			[];
		const registeredFactories: Array<{ name: string }> = [];
		const openResource = vi.fn();
		const openSlotOverlay = vi.fn();
		const closeOverlay = vi.fn();
		const disposeHeader = vi.fn();
		let toggle: (() => void) | undefined;
		let renderHeader: (() => string) | undefined;
		const overlays = new Map<SessionId, SplitOverlay>();
		const provideSplit = () =>
			ctx.provide("splitView", {
				getSnapshot: () => ({ overlays }),
				subscribe: () => () => {},
				openSlotOverlay,
				closeOverlay,
			});
		if (splitTiming === "before") provideSplit();

		const registeredEvents: unknown[] = [];
		ctx.provide("documentPreviews", { candidates: () => [] });
		ctx.provide("uiConversation", {
			events: {
				register: (definition: unknown) => {
					registeredEvents.push(definition);
					return () => {};
				},
			},
		});
		ctx.provide("remote.workspaceFiles", { readBytes: vi.fn() });
		ctx.provide("sidebarRight", { openResource });
		ctx.provide("sidebarRightTabs", {
			register: (tab: { id: string; kind: string }) => {
				registeredTabs.push(tab);
				return () => {};
			},
		});

		ctx.provide("slots", {
			inject: (_key: string, cb: () => () => void) => cb(),
			register: (
				def: {
					name: string;
					key?: string;
					id?: string;
					order?: number;
					inject?: (sessionId: SessionId) => { toggle: () => void };
				},
				component?: React.ComponentType<{
					sessionId: SessionId;
					useSplit: (
						selector: (state: {
							overlays: Map<SessionId, SplitOverlay>;
						}) => boolean,
					) => boolean;
					toggle: () => void;
				}>,
			) => {
				const validSlots = new Set([
					"sidebar.right.pane.tab",
					"split.pane.header.actions",
					"conversation.chat.turnTail",
					"tool.call.toolview",
				]);
				if (!validSlots.has(def.name)) {
					throw new Error(`Undeclared slot registration: ${def.name}`);
				}
				registeredSlots.push(def);
				if (
					def.name === "split.pane.header.actions" &&
					component &&
					def.inject
				) {
					const injected = def.inject(SessionId("owning-session"));
					toggle = injected.toggle;
					renderHeader = () =>
						renderToStaticMarkup(
							React.createElement(component, {
								sessionId: SessionId("owning-session"),
								useSplit: (selector) => selector({ overlays }),
								toggle: injected.toggle,
							}),
						);
					return disposeHeader;
				}
				return () => {};
			},
			registerFactory: (def: {
				name: string;
				inject: (sessionId: string) => { api: object };
			}) => {
				if (def.name !== "gitdiff.review") {
					throw new Error(`Undeclared factory registration: ${def.name}`);
				}
				registeredFactories.push(def);
				return () => {};
			},
		});

		ctx.provide("remote", {
			$mount: async () => {
				ctx.provide("remote.workspaceReview", {});
				return () => {};
			},
		});

		const fiber = ctx.plugin(clientPlugin);
		try {
			await fiber.await();
			if (splitTiming === "after") {
				provideSplit();
				await vi.waitFor(() => expect(toggle).toBeTypeOf("function"));
			}

			// 2 is FiberState.ACTIVE
			expect(fiber.state).toBe(2);

			expect(registeredTabs).toEqual([
				expect.objectContaining({
					id: "dsh-client-git-diff",
					kind: "gitbutler",
				}),
			]);

			const tabSlots = registeredSlots
				.filter((s) => s.name === "sidebar.right.pane.tab")
				.map((s) => s.key);
			expect(tabSlots).toEqual(["dsh-client-git-diff"]);
			expect(registeredFactories.map((factory) => factory.name)).toEqual([
				"gitdiff.review",
			]);

			const reviewCards = registeredSlots.filter(
				(slot) => slot.name === "conversation.chat.turnTail",
			);
			expect(reviewCards).toHaveLength(1);
			expect(registeredEvents).toHaveLength(1);

			const toolViews = registeredSlots.filter(
				(slot) => slot.name === "tool.call.toolview",
			);
			expect(toolViews).toHaveLength(1);
			expect(toolViews[0].key).toBe("git_review_present");

			const headerActions = registeredSlots.filter(
				(slot) => slot.name === "split.pane.header.actions",
			);
			expect(headerActions).toHaveLength(withSplit ? 1 : 0);
			if (withSplit) {
				expect(headerActions[0].id).toBe("git-review");
				assert(toggle);
				assert(renderHeader);
				expect(renderHeader()).toContain('class="dsh-split-icon-btn"');
				expect(renderHeader()).toContain('<svg width="14" height="14"');
				toggle();
				expect(openSlotOverlay).toHaveBeenCalledExactlyOnceWith(
					"owning-session",
					"gitdiff.review",
					"Review",
					{},
				);
				overlays.set(SessionId("owning-session"), {
					kind: "slot",
					slotName: "gitdiff.review",
					props: {},
					title: "Review",
				});
				expect(renderHeader()).toContain(
					'class="dsh-split-icon-btn is-pressed"',
				);
				expect(renderHeader()).toContain('aria-pressed="true"');
				toggle();
				expect(closeOverlay).toHaveBeenCalledExactlyOnceWith("owning-session");
			}
		} finally {
			await fiber.dispose();
			expect(disposeHeader).toHaveBeenCalledTimes(withSplit ? 1 : 0);
		}
	},
);
