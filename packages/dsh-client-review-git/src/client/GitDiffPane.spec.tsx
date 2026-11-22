// @vitest-environment happy-dom
import assert from "node:assert/strict";
import type {
	Button,
	CodeBlock,
	Menu,
	MenuSurface,
	PathLabel,
	Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";

import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { TypertRemoteNamespace } from "@deepseek-ai/dsh-typert-protocol";
import styles from "@lukstei/util-review-ui/client/GitDiffPane.module.css";
import {
	type BranchReviewScope,
	COMMIT_PAGE_SIZE,
	type GitDiffView,
	type GitRepository,
	type ReviewCatalog,
} from "@lukstei/util-review-ui/types";
import { act, type ComponentProps, type RefObject, useEffect } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GitDiffPane } from "./GitDiffPane.tsx";

vi.mock("@deepseek-ai/dsh-client-ui-primitives", async () => {
	return {
		relativeTime: vi.fn(() => ({ unit: "minutes", n: 5 })),
		languageForPath: (path: string) => {
			const ext = path.split(".").pop();
			return ext === "ts" ? "typescript" : ext;
		},
		useAnchoredPosition: () => ({ left: 0, top: 0 }),
		useDismissOnOutsidePointer: (
			root: RefObject<HTMLElement | null>,
			open: boolean,
			setOpen: (value: boolean) => void,
			panel: RefObject<HTMLElement | null>,
		) => {
			useEffect(() => {
				if (!open) return;
				const dismiss = (event: PointerEvent) => {
					if (
						event.target instanceof Node &&
						root.current !== null &&
						panel.current !== null &&
						!root.current.contains(event.target) &&
						!panel.current.contains(event.target)
					)
						setOpen(false);
				};
				document.addEventListener("pointerdown", dismiss);
				return () => document.removeEventListener("pointerdown", dismiss);
			}, [root, open, setOpen, panel]);
		},
		MenuSurface: ({
			compact: _compact,
			...props
		}: ComponentProps<typeof MenuSurface>) => <div {...props} />,
		Button: ({
			size: _size,
			variant,
			icon,
			children,
			...props
		}: ComponentProps<typeof Button>) => (
			<button {...props} data-variant={variant}>
				{icon}
				{children}
			</button>
		),
		PathLabel: ({ path, ...props }: ComponentProps<typeof PathLabel>) => (
			<span {...props} title={path}>
				{path}
			</span>
		),
		CodeBlock: ({
			code,
			lang,
			lineNumbers,
			diff,
		}: ComponentProps<typeof CodeBlock>) => (
			<div
				data-testid="diff"
				data-lang={lang}
				data-diff={String(diff)}
				data-line-numbers={String(lineNumbers)}
			>
				<pre>{code}</pre>
			</div>
		),
		Tooltip: ({ children }: ComponentProps<typeof Tooltip>) => children,
		IconRefreshOutlineRegular: () => <svg aria-hidden="true" />,
		IconListPenOutlineRegular: () => <svg aria-hidden="true" />,
		IconRightUpOutlineRegular: () => <svg aria-hidden="true" />,
		IconNewChatOutlineRegular: () => <svg aria-hidden="true" />,
		IconChevronUpOutlineRegular: () => <svg aria-hidden="true" />,
		IconWrapLinesOutlineRegular: () => <svg aria-hidden="true" />,
		IconCompareSplitOutlineRegular: () => <svg aria-hidden="true" />,
		IconEditOutlineRegular: () => <svg aria-hidden="true" />,
		IconTrashOutlineRegular: () => <svg aria-hidden="true" />,
		IconChevronDownOutlineRegular: () => <svg aria-hidden="true" />,
		IconCheckOutlineRegular: () => <svg aria-hidden="true" />,
		IconCopyOutlineRegular: () => <svg aria-hidden="true" />,
		writeClipboard: vi.fn(async () => true),
		Menu: ({
			open,
			anchor,
			items,
			footer,
			onSelect,
		}: ComponentProps<typeof Menu>) => {
			assert(items);
			assert(onSelect);
			return (
				<>
					{anchor}
					{open &&
						createPortal(
							<div role="menu">
								{[...items, ...(footer === undefined ? [] : footer)].map(
									(item) =>
										"type" in item ? (
											<span key={item.id}>
												{item.type === "label" ? item.text : null}
											</span>
										) : (
											<button
												type="button"
												role="menuitem"
												key={item.id}
												disabled={item.disabled}
												onClick={() => onSelect(item.id)}
											>
												{item.label}
											</button>
										),
								)}
							</div>,
							document.body,
						)}
				</>
			);
		},
	};
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	localStorage.clear();
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-01-01T12:00:00Z"));
});
afterEach(async () => {
	const stylesheet = container.querySelector("style");
	if (stylesheet) stylesheet.remove();
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

const repository: GitRepository = {
	cwd: "/repo",
	target: "refs/remotes/origin/develop",
	baselines: [{ ref: "refs/remotes/origin/develop", label: "origin/develop" }],
	gitbutlerError: null,
	branches: [
		{
			ref: "refs/heads/one",
			label: "one",
			modifiedAt: Date.parse("2026-01-01T11:55:00Z"),
			base: "refs/remotes/origin/develop",
			kind: "git",
		},
		{
			ref: "refs/heads/two",
			label: "two",
			modifiedAt: Date.parse("2026-01-01T10:00:00Z"),
			base: "refs/remotes/origin/develop",
			kind: "git",
		},
	],
};
function gitCatalog(
	repo: GitRepository = repository,
	repositories: GitRepository[] = [repo],
): Extract<ReviewCatalog, { kind: "git" }> {
	return { kind: "git", repository: repo, repositories };
}
type Api = TypertRemoteNamespace<"workspaceReview">;
function last<T>(items: readonly T[]): T {
	const item = items.at(-1);
	assert(item);
	return item;
}
function text(selector: string): string {
	const element = container.querySelector(selector);
	assert(element);
	const content = element.textContent;
	assert(content !== null);
	return content;
}
function view(path: string): GitDiffView {
	return {
		target: "refs/remotes/origin/develop",
		snapshot: {
			kind: "revision",
			repository: "/repo",
			before: "a".repeat(40),
			after: "b".repeat(40),
		},
		summary: { files: 1, added: 1, deleted: 0 },
		diffs: [
			{
				path,
				status: "added",
				addedLines: 1,
				deletedLines: 0,
			},
		],
	};
}
function apiFixture(): TypertRemoteNamespace<"workspaceReview"> {
	const api: TypertRemoteNamespace<"workspaceReview"> = {
		catalog: vi.fn<Api["catalog"]>(async () => ({
			ok: true,
			value: gitCatalog(),
		})),
		commits: vi.fn<Api["commits"]>(async () => ({
			ok: true,
			value: {
				commits: [
					{
						sha: "abc123",
						subject: "Commit title",
						author: "Author",
						date: "2026-10-25",
					},
				],
				hasMore: false,
			},
		})),
		resolve: vi.fn<Api["resolve"]>(async (_session, target) => ({
			ok: true,
			value: {
				kind: "branch",
				repository: "/repo",
				ref: target.branch.startsWith("refs/heads/")
					? target.branch
					: `refs/heads/${target.branch}`,
				base: { kind: "manual", ref: "refs/remotes/origin/develop" },
				revision: { kind: "all-commits" },
			},
		})),
		view: vi.fn<Api["view"]>(async (_session, selection) => {
			const path =
				selection.kind === "uncommitted"
					? `${selection.stage}.txt`
					: selection.revision.kind === "commit"
						? "commit.txt"
						: `${selection.ref.split("/").at(-1)}.txt`;
			return { ok: true, value: { kind: "diff", view: view(path) } };
		}),
		file: vi.fn<Api["file"]>(async (_session, _snapshot, path) => {
			const response: Awaited<ReturnType<Api["view"]>> = await last(
				vi.mocked(api.view).mock.results,
			).value;
			assert(response.ok);
			assert(response.value.kind === "diff");
			const file = response.value.view.diffs.find((item) => item.path === path);
			assert(file);
			if (file.path === "image.png")
				return {
					ok: true,
					value: {
						kind: "unavailable",
						message: "Binary or metadata-only change; no text diff.",
					},
				};
			return {
				ok: true,
				value: {
					kind: "text",
					before: file.status === "added" ? null : "old\n",
					after: file.status === "deleted" ? null : "new\n",
				},
			};
		}),
	};
	return api;
}

async function render(
	api: TypertRemoteNamespace<"workspaceReview">,
	session = "owning-session",
	scope?: BranchReviewScope,
): Promise<void> {
	await act(async () =>
		root.render(
			<GitDiffPane sessionId={SessionId(session)} api={api} scope={scope} />,
		),
	);
}
async function selectScope(value: string): Promise<void> {
	await click("Scope");
	const name = value.startsWith("special:")
		? value === "special:staged"
			? "Staged changes"
			: "Unstaged changes"
		: value.replace("refs/heads/", "");
	const item = [
		...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
	].find((item) => {
		const label = item.querySelector(`.${styles.truncate}`);
		return (label === null ? item.textContent : label.textContent) === name;
	});
	assert(item);
	await act(async () => item.click());
}
async function expandFiles(): Promise<void> {
	for (const button of container.querySelectorAll<HTMLButtonElement>(
		'nav button[aria-expanded="false"][aria-controls]',
	)) {
		await act(async () => button.click());
	}
}
async function click(text: string): Promise<void> {
	const buttons = [...document.querySelectorAll("button")];
	const button =
		buttons.find((element) => element.getAttribute("aria-label") === text) ||
		buttons.find(
			(element) =>
				element.textContent.includes(text) ||
				element.getAttribute("aria-label") === text,
		);
	assert(button, `Missing button: ${text}`);
	await act(async () => button.click());
}

test("browses branch and commit diffs, lists one file, and resets selections", async () => {
	const api = apiFixture();
	await render(api);
	assert.match(container.textContent, /origin\/develop/);
	assert.deepEqual(vi.mocked(api.catalog).mock.calls[0].slice(0, 1), [
		"owning-session",
	]);
	await selectScope("refs/heads/one");
	await expandFiles();
	assert.doesNotMatch(container.textContent, /Files \d+/);
	assert.match(text('[data-testid="diff"]'), /one.txt/);
	assert.match(text('button[aria-label="Commit"]'), /All commits/);
	await click("Commit");
	await click("Commit title");
	await expandFiles();
	assert.match(container.textContent, /commit.txt/);
	assert.deepEqual(last(vi.mocked(api.view).mock.calls).slice(0, 2), [
		"owning-session",
		{
			kind: "branch",
			repository: "/repo",
			ref: "refs/heads/one",
			base: "refs/remotes/origin/develop",
			revision: {
				kind: "commit",
				commit: {
					sha: "abc123",
					subject: "Commit title",
					author: "Author",
					date: "2026-10-25",
				},
			},
		},
	]);
});

test("displays commit page controls, paginates history, and handles fast commit switches", async () => {
	const api = apiFixture();
	const commits = vi.mocked(api.commits);
	commits.mockResolvedValueOnce({
		ok: true,
		value: {
			commits: [
				{
					sha: "abc123",
					subject: "Commit title",
					author: "Author",
					date: "2026-10-25",
				},
			],
			hasMore: true,
		},
	});
	await render(api);
	await selectScope("refs/heads/one");
	await click("Commit");
	await click("Commit title");
	await click("Commit");
	await click("More commits");
	assert.equal(last(commits.mock.calls)[4], COMMIT_PAGE_SIZE);
	const obsolete = Promise.withResolvers<Awaited<ReturnType<Api["commits"]>>>();
	commits.mockImplementationOnce(() => obsolete.promise);
	await click("Refresh");
	const signal = last(commits.mock.calls)[5];
	assert(signal);
	commits.mockResolvedValue({
		ok: true,
		value: {
			commits: [
				{
					sha: "new",
					subject: "New commit",
					author: "Author",
					date: "2026-10-26",
				},
			],
			hasMore: false,
		},
	});
	await click("Refresh");
	assert(signal.aborted);
	assert.equal(last(commits.mock.calls)[4], COMMIT_PAGE_SIZE);
	assert.match(text('[aria-label="Commit"]'), /Commit title/);
	const selected = last(vi.mocked(api.view).mock.calls)[1];
	assert(selected.kind === "branch" && selected.revision.kind === "commit");
	assert.equal(selected.revision.commit.sha, "abc123");
	assert.match(document.body.textContent, /New commit/);
	await act(async () =>
		obsolete.resolve({
			ok: true,
			value: {
				commits: [
					{
						sha: "old",
						subject: "Obsolete commit",
						author: "Author",
						date: "2026-10-24",
					},
				],
				hasMore: false,
			},
		}),
	);
	assert.doesNotMatch(document.body.textContent, /Obsolete commit/);
	await click("All commits");
	await click("Refresh");
	assert.equal(text('[aria-label="Commit"]'), "All commits");
	await click("Commit");
	assert.match(document.body.textContent, /New commit/);
});

test("late diff responses cannot overwrite a newly selected branch", async () => {
	const api = apiFixture();
	const late = Promise.withResolvers<Awaited<ReturnType<typeof api.view>>>();
	vi.mocked(api.view).mockImplementationOnce(() => late.promise);
	await render(api);
	await selectScope("refs/heads/one");
	await expandFiles();
	const signal = vi.mocked(api.view).mock.calls[0][2];
	await selectScope("refs/heads/two");
	await expandFiles();
	assert(signal);
	assert(signal.aborted);
	await act(async () =>
		late.resolve({
			ok: true,
			value: { kind: "diff", view: view("stale.txt") },
		}),
	);
	assert.match(container.textContent, /two.txt/);
	assert.doesNotMatch(container.textContent, /stale.txt/);
});

test("Uncommitted offers stages separately from branches and has no commit picker", async () => {
	const api = apiFixture();
	vi.mocked(api.catalog).mockResolvedValueOnce({
		ok: true,
		value: gitCatalog({
			...repository,
			branches: [
				...repository.branches,
				{
					ref: "refs/heads/staged",
					label: "staged",
					modifiedAt: Date.parse("2026-01-01T00:00:00Z"),
					base: "refs/remotes/origin/develop",
					kind: "git",
				},
			],
		}),
	});
	await render(api);
	await selectScope("special:staged");
	await expandFiles();
	assert.deepEqual(last(vi.mocked(api.view).mock.calls).slice(0, 2), [
		"owning-session",
		{ kind: "uncommitted", repository: "/repo", stage: "staged" },
	]);
	assert.match(container.textContent, /HEAD → Index/);
	assert.match(container.textContent, /staged.txt/);
	assert.equal(container.querySelector('[aria-label="Compare"]'), null);
	assert.equal(container.querySelector('[aria-label="Commit"]'), null);
	await selectScope("special:unstaged");
	await expandFiles();
	assert.deepEqual(last(vi.mocked(api.view).mock.calls).slice(0, 2), [
		"owning-session",
		{ kind: "uncommitted", repository: "/repo", stage: "unstaged" },
	]);
	assert.match(container.textContent, /Index → Working tree/);
	assert.match(container.textContent, /unstaged.txt/);
	await selectScope("refs/heads/staged");
	await expandFiles();
	assert.deepEqual(last(vi.mocked(api.view).mock.calls).slice(0, 2), [
		"owning-session",
		{
			kind: "branch",
			repository: "/repo",
			ref: "refs/heads/staged",
			base: "refs/remotes/origin/develop",
			revision: { kind: "all-commits" },
		},
	]);
	assert.equal(vi.mocked(api.commits).mock.calls.length, 1);
});

test("an unknown default requires a baseline while working changes remain available", async () => {
	const api = apiFixture();
	vi.mocked(api.catalog).mockResolvedValueOnce({
		ok: true,
		value: gitCatalog({
			...repository,
			target: null,
			branches: repository.branches.map((branch) => ({
				...branch,
				base: null,
			})),
		}),
	});
	await render(api);
	await selectScope("refs/heads/one");
	await expandFiles();
	assert.equal(vi.mocked(api.view).mock.calls.length, 0);
	await click("Baseline");
	const item = [
		...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
	].find((item) => item.textContent === "origin/develop");
	assert(item);
	await act(async () => item.click());
	assert.deepEqual(last(vi.mocked(api.view).mock.calls).slice(0, 2), [
		"owning-session",
		{
			kind: "branch",
			repository: "/repo",
			ref: "refs/heads/one",
			base: "refs/remotes/origin/develop",
			revision: { kind: "all-commits" },
		},
	]);
	await selectScope("special:unstaged");
	await expandFiles();
	assert.match(container.textContent, /unstaged.txt/);
	assert.equal(container.querySelector('[aria-label="Baseline"]'), null);
});

test("a late branch diff cannot replace a selected special entry", async () => {
	const api = apiFixture();
	const late = Promise.withResolvers<Awaited<ReturnType<Api["view"]>>>();
	vi.mocked(api.view).mockImplementationOnce(() => late.promise);
	await render(api);
	await selectScope("refs/heads/one");
	await expandFiles();
	const signal = vi.mocked(api.view).mock.calls[0][2];
	await selectScope("special:unstaged");
	await expandFiles();
	assert(signal);
	assert(signal.aborted);
	await act(async () =>
		late.resolve({ ok: true, value: { kind: "diff", view: view("late.txt") } }),
	);
	assert.match(container.textContent, /unstaged.txt/);
	assert.doesNotMatch(container.textContent, /late.txt/);
});

test("file rows start collapsed, load independently, and invalidate closed caches on refresh", async () => {
	const api = apiFixture();
	const result = view("src/one.ts");
	result.diffs.push({
		path: "src/two.ts",
		status: "modified",
		addedLines: 14,
		deletedLines: 2,
	});
	vi.mocked(api.view).mockResolvedValue({
		ok: true,
		value: { kind: "diff", view: result },
	});
	await render(api);
	await selectScope("refs/heads/one");
	assert.equal(vi.mocked(api.file).mock.calls.length, 0);
	assert.equal(container.querySelectorAll('[data-testid="diff"]').length, 0);
	const rows = [
		...container.querySelectorAll<HTMLButtonElement>(
			"nav button[aria-controls]",
		),
	];
	expect(
		rows.map((row) => ({
			label: row.getAttribute("aria-label"),
			expanded: row.getAttribute("aria-expanded"),
			description: document.getElementById(
				String(row.getAttribute("aria-describedby")),
			)?.textContent,
		})),
	).toMatchInlineSnapshot(`
  [
    {
      "description": "1 additions, 0 deletions",
      "expanded": "false",
      "label": "src/one.ts · added",
    },
    {
      "description": "14 additions, 2 deletions",
      "expanded": "false",
      "label": "src/two.ts · modified",
    },
  ]
 `);
	await click("src/one.ts · added");
	assert.equal(vi.mocked(api.file).mock.calls.length, 1);
	await click("src/two.ts · modified");
	assert.equal(container.querySelectorAll('[data-testid="diff"]').length, 2);
	await click("src/one.ts · added");
	assert.equal(container.querySelectorAll('[data-testid="diff"]').length, 1);
	await click("src/one.ts · added");
	assert.equal(vi.mocked(api.file).mock.calls.length, 2);
	await click("src/two.ts · modified");
	await click("Refresh");
	assert.equal(vi.mocked(api.file).mock.calls.length, 3);
	assert.equal(rows[0].getAttribute("aria-expanded"), "true");
	assert.equal(rows[1].getAttribute("aria-expanded"), "false");
	await click("src/two.ts · modified");
	assert.equal(vi.mocked(api.file).mock.calls.length, 4);
});
