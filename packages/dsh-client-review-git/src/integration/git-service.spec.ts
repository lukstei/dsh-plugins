import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMIT_PAGE_SIZE } from "@lukstei/util-review-ui/types";
import { afterAll, afterEach, test, vi } from "vitest";
import {
	compare,
	listCommits,
	readFileContents,
	readRepository,
	resolveReviewScope,
} from "../git-service.ts";

const config = vi.hoisted(() => {
	const stacks: {
		branches: {
			name: string;
			commits: {
				commitId: string;
				message: string;
				authorName: string;
				createdAt: string;
			}[];
		}[];
	}[] = [];
	const failure: { message: string | null } = { message: null };
	return { branch: "main", stacks, failure };
});
vi.mock("node:child_process", async (original) => {
	const child = await original<typeof import("node:child_process")>();
	const { promisify } = await import("node:util");
	const run = promisify(child.execFile);
	return {
		...child,
		execFile: Object.assign(child.execFile.bind(null), {
			[promisify.custom]: (
				file: string,
				args: string[],
				options: {
					cwd: string;
					signal: AbortSignal;
				},
			) =>
				file === "but"
					? config.failure.message !== null
						? Promise.reject(new Error(config.failure.message))
						: Promise.resolve({
								stdout: JSON.stringify(
									args.includes("status")
										? { stacks: config.stacks }
										: { branch: config.branch },
								),
								stderr: "",
							})
					: run(file, args, options),
		}),
	};
});
const temporary: string[] = [];
const templates: string[] = [];
afterEach(() => {
	for (const cwd of temporary.splice(0))
		rmSync(cwd, { recursive: true, force: true });
	config.branch = "main";
	config.stacks.length = 0;
	config.failure.message = null;
	vi.restoreAllMocks();
});
afterAll(() => {
	for (const dir of templates.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

/** Git identity through the environment so fixtures do not write to the repo config. */
function gitEnv(): NodeJS.ProcessEnv {
	return {
		...process.env,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_AUTHOR_NAME: "Diff Test",
		GIT_AUTHOR_EMAIL: "diff@example.test",
		GIT_COMMITTER_NAME: "Diff Test",
		GIT_COMMITTER_EMAIL: "diff@example.test",
	};
}

function gitIn(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
		env: gitEnv(),
	}).trim();
}

/**
 * Each test starts from the same committed repository, so the fixture copies a
 * per-file template instead of paying for `git init`, `git add`, and `git commit`
 * on every call (measured 96 ms → 7 ms per fixture).
 */
function template(): string {
	const existing = templates[0];
	if (existing !== undefined) return existing;
	const dir = mkdtempSync(join(tmpdir(), "dsh-git-diff-template-"));
	templates.push(dir);
	const git = (...args: string[]): string => gitIn(dir, ...args);
	git("init", "--initial-branch=main");
	mkdirSync(join(dir, ".git", "gitbutler"));
	writeFileSync(join(dir, "initial.txt"), "initial\n");
	git("add", ".");
	git("commit", "-m", "Initial");
	return dir;
}

function fixture(): {
	cwd: string;
	git: (...args: string[]) => string;
	signal: AbortSignal;
} {
	const parent = mkdtempSync(join(tmpdir(), "dsh-git-diff-test-"));
	temporary.push(parent);
	const cwd = join(parent, "repo");
	cpSync(template(), cwd, { recursive: true });
	return {
		cwd,
		git: (...args: string[]): string => gitIn(cwd, ...args),
		signal: new AbortController().signal,
	};
}
test("lists only local refs and retains GitButler's remote target", async () => {
	const { cwd, git, signal } = fixture();
	git("branch", "feature");
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
	config.branch = "origin/main";
	const repository = await readRepository(cwd, signal);
	const modifiedAt = Number(git("show", "-s", "--format=%ct", "HEAD")) * 1000;
	assert.deepEqual(
		{ target: repository.target, branches: repository.branches },
		{
			target: "refs/remotes/origin/main",
			branches: [
				{
					ref: "refs/heads/feature",
					label: "feature",
					modifiedAt,
					base: "refs/remotes/origin/main",
					kind: "git",
				},
			],
		},
	);
});

test.each(["empty workspace", "managed branches", "GitButler unavailable"])(
	"filters only GitButler review scopes: %s",
	async (mode) => {
		const { cwd, git, signal } = fixture();
		for (const name of [
			"feature",
			"gitbutler/workspace",
			"gitbutler/target",
			"gitbutler/user-branch",
			"main-feature",
		])
			git("branch", name);
		git("update-ref", "refs/remotes/origin/main", "HEAD");
		git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
		config.branch = "origin/main";
		if (mode === "managed branches")
			config.stacks.push({ branches: [{ name: "feature", commits: [] }] });
		if (mode === "GitButler unavailable")
			config.failure.message = "not a GitButler project";
		const repository = await readRepository(cwd, signal);
		assert.deepEqual(
			repository.branches.map((branch) => branch.label),
			mode === "GitButler unavailable"
				? [
						"feature",
						"gitbutler/target",
						"gitbutler/user-branch",
						"gitbutler/workspace",
						"main",
						"main-feature",
					]
				: ["feature", "gitbutler/user-branch", "main-feature"],
		);
		assert.equal(repository.target, "refs/remotes/origin/main");
		assert.deepEqual(
			repository.baselines.map((baseline) => baseline.ref),
			[
				"refs/heads/feature",
				"refs/heads/gitbutler/target",
				"refs/heads/gitbutler/user-branch",
				"refs/heads/gitbutler/workspace",
				"refs/heads/main",
				"refs/heads/main-feature",
				"refs/remotes/origin/main",
			],
		);
	},
);

test("orders plain and managed branches by tip committer time with alphabetical ties", async () => {
	vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-03-07T00:00:00Z"));
	const { cwd, git, signal } = fixture();
	for (const [branch, date] of [
		["main", "2026-01-01T00:00:00Z"],
		["z-new", "2026-03-05T00:00:00Z"],
		["z-tie", "2026-03-02T00:00:00Z"],
		["a-tie", "2026-03-02T00:00:00Z"],
	]) {
		const commit = execFileSync(
			"git",
			["commit-tree", "HEAD^{tree}", "-m", branch],
			{
				cwd,
				encoding: "utf8",
				env: {
					...gitEnv(),
					GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
					GIT_COMMITTER_DATE: date,
				},
			},
		).trim();
		git("update-ref", `refs/heads/${branch}`, commit);
	}
	config.stacks.push({ branches: [{ name: "z-new", commits: [] }] });
	const repository = await readRepository(cwd, signal);
	assert.deepEqual(
		repository.branches.map(({ label, modifiedAt, kind }) => ({
			label,
			modifiedAt: new Date(modifiedAt).toISOString(),
			kind,
		})),
		[
			{
				label: "z-new",
				modifiedAt: "2026-03-05T00:00:00.000Z",
				kind: "gitbutler",
			},
			{ label: "a-tie", modifiedAt: "2026-03-02T00:00:00.000Z", kind: "git" },
			{ label: "z-tie", modifiedAt: "2026-03-02T00:00:00.000Z", kind: "git" },
		],
	);
});

test("excludes branches older than 7 days from repository branches", async () => {
	vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-03-10T12:00:00Z"));
	const { cwd, git, signal } = fixture();
	for (const [branch, date] of [
		["fresh", "2026-03-08T12:00:00Z"],
		["boundary", "2026-03-03T12:00:00Z"],
		["stale", "2026-03-03T11:59:59Z"],
	]) {
		const commit = execFileSync(
			"git",
			["commit-tree", "HEAD^{tree}", "-m", branch],
			{
				cwd,
				encoding: "utf8",
				env: {
					...gitEnv(),
					GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
					GIT_COMMITTER_DATE: date,
				},
			},
		).trim();
		git("update-ref", `refs/heads/${branch}`, commit);
	}
	const repository = await readRepository(cwd, signal);
	const branchNames = repository.branches.map((b) => b.label);
	assert(branchNames.includes("fresh"));
	assert(branchNames.includes("boundary"));
	assert(!branchNames.includes("stale"));
});

test("plain Git uses the remote default without a working GitButler installation", async () => {
	const { cwd, git, signal } = fixture();
	config.failure.message = "but is not installed";
	git("branch", "-m", "trunk");
	git("update-ref", "refs/remotes/upstream/trunk", "HEAD");
	git(
		"symbolic-ref",
		"refs/remotes/upstream/HEAD",
		"refs/remotes/upstream/trunk",
	);
	git("switch", "-c", "feature");
	writeFileSync(join(cwd, "feature.txt"), "feature\n");
	git("add", ".");
	git("commit", "-m", "Feature");
	const repository = await readRepository(cwd, signal);
	assert.equal(repository.target, "refs/remotes/upstream/trunk");
	assert.equal(repository.gitbutlerError, null);
	const feature = repository.branches.find(
		(branch) => branch.label === "feature",
	);
	assert(feature && feature.base !== null);
	assert.equal(feature.kind, "git");
	assert.deepEqual(
		(
			await compare(
				cwd,
				{ kind: "branch", branch: feature.ref, base: feature.base },
				signal,
			)
		).diffs,
		[{ path: "feature.txt", status: "added", addedLines: 1, deletedLines: 0 }],
	);
	assert.deepEqual(
		(await listCommits(cwd, feature.ref, feature.base, 0, signal)).commits.map(
			(commit) => commit.subject,
		),
		["Feature"],
	);
});

test("plain Git suppresses GitButler setup required errors", async () => {
	const { cwd, signal } = fixture();
	config.failure.message =
		"Error: Setup required: No GitButler project found at . - run `but setup` to configure the project";
	const repository = await readRepository(cwd, signal);
	assert.equal(repository.gitbutlerError, null);
});

test("plain Git skips invoking GitButler when .git/gitbutler is absent", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "dsh-git-diff-test-"));
	temporary.push(cwd);
	execFileSync("git", ["init", "--initial-branch=main"], { cwd });
	config.failure.message = "should not be called";
	const repository = await readRepository(cwd, new AbortController().signal);
	assert.equal(repository.gitbutlerError, null);
});

test("unexpected GitButler errors are retained", async () => {
	const { cwd, signal } = fixture();
	config.failure.message = "gitbutler daemon crashed unexpectedly";
	const repository = await readRepository(cwd, signal);
	assert.match(String(repository.gitbutlerError), /daemon crashed/);
});

test("missing or ambiguous remote defaults require an explicit baseline", async () => {
	const { cwd, git, signal } = fixture();
	assert.equal((await readRepository(cwd, signal)).target, null);
	for (const remote of ["one", "two"]) {
		git("update-ref", `refs/remotes/${remote}/trunk`, "HEAD");
		git(
			"symbolic-ref",
			`refs/remotes/${remote}/HEAD`,
			`refs/remotes/${remote}/trunk`,
		);
	}
	const repository = await readRepository(cwd, signal);
	assert.equal(repository.target, null);
	assert(repository.branches.every((branch) => branch.base === null));
	assert.deepEqual(
		repository.baselines.map((branch) => branch.label),
		["main", "one/trunk", "two/trunk"],
	);
});

test("managed GitButler branches use their stack base even when the Git default differs", async () => {
	const { cwd, git, signal } = fixture();
	git("update-ref", "refs/remotes/origin/default", "HEAD");
	git(
		"symbolic-ref",
		"refs/remotes/origin/HEAD",
		"refs/remotes/origin/default",
	);
	git("branch", "production");
	git("branch", "lower");
	git("branch", "upper");
	config.branch = "production";
	config.stacks.push({
		branches: [
			{ name: "upper", commits: [] },
			{ name: "lower", commits: [] },
		],
	});
	const repository = await readRepository(cwd, signal);
	assert.equal(repository.target, "refs/remotes/origin/default");
	assert.deepEqual(
		repository.branches.map(({ label, base, kind }) => ({ label, base, kind })),
		[
			{ label: "lower", base: "refs/heads/production", kind: "gitbutler" },
			{ label: "production", base: "refs/remotes/origin/default", kind: "git" },
			{ label: "upper", base: "refs/heads/lower", kind: "gitbutler" },
		],
	);
});

test("a tag cannot replace the canonical lower stack branch", async () => {
	const { cwd, git, signal } = fixture();
	const root = git("rev-parse", "HEAD");
	git("switch", "-c", "lower");
	writeFileSync(join(cwd, "lower.txt"), "lower\n");
	git("add", ".");
	git("commit", "-m", "Lower");
	git("switch", "-c", "upper");
	writeFileSync(join(cwd, "upper.txt"), "upper\n");
	git("add", ".");
	git("commit", "-m", "Upper");
	git("tag", "lower", root);
	config.branch = "refs/heads/main";
	config.stacks.push({
		branches: [
			{ name: "upper", commits: [] },
			{ name: "lower", commits: [] },
		],
	});
	const repository = await readRepository(cwd, signal);
	const branch = repository.branches.find(
		(branch) => branch.ref === "refs/heads/upper",
	);
	assert(branch);
	assert.equal(branch.base, "refs/heads/lower");
	assert(branch.base);
	const diff = await compare(
		cwd,
		{ kind: "branch", branch: branch.ref, base: branch.base },
		signal,
	);
	assert.deepEqual(
		diff.diffs.map((file) => file.path),
		["upper.txt"],
	);
});

test("a local origin/main branch cannot replace the recorded remote default", async () => {
	const { cwd, git, signal } = fixture();
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
	git("switch", "-c", "feature");
	writeFileSync(join(cwd, "feature.txt"), "feature\n");
	git("add", ".");
	git("commit", "-m", "Feature");
	git("branch", "origin/main");
	const repository = await readRepository(cwd, signal);
	assert.equal(repository.target, "refs/remotes/origin/main");
	const branch = repository.branches.find(
		(branch) => branch.ref === "refs/heads/feature",
	);
	assert(branch);
	assert(branch.base);
	const diff = await compare(
		cwd,
		{ kind: "branch", branch: branch.ref, base: branch.base },
		signal,
	);
	assert.deepEqual(
		diff.diffs.map((file) => file.path),
		["feature.txt"],
	);
	assert.deepEqual(
		(await listCommits(cwd, branch.ref, branch.base, 0, signal)).commits.map(
			(commit) => commit.subject,
		),
		["Feature"],
	);
});

test("configured GitButler targets require a unique ref identity while stack bases remain usable", async () => {
	const { cwd, git, signal } = fixture();
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
	git("branch", "origin/main");
	git("branch", "lower");
	git("branch", "upper");
	config.stacks.push({
		branches: [
			{ name: "upper", commits: [] },
			{ name: "lower", commits: [] },
		],
	});
	config.branch = "origin/main";
	const repository = await readRepository(cwd, signal);
	assert.match(String(repository.gitbutlerError), /target.*ambiguous/);
	assert.equal(repository.target, "refs/remotes/origin/main");
	const lower = repository.branches.find((branch) => branch.label === "lower");
	assert(lower);
	assert.equal(lower.base, null);
	const upper = repository.branches.find((branch) => branch.label === "upper");
	assert(upper);
	assert.equal(upper.base, "refs/heads/lower");
	for (const ref of [
		"refs/heads/origin/main",
		"refs/remotes/origin/main",
		"main",
	]) {
		config.branch = ref;
		const resolved = await readRepository(cwd, signal);
		const expected = ref === "main" ? "refs/heads/main" : ref;
		assert.equal(resolved.gitbutlerError, null);
		const lower = resolved.branches.find((branch) => branch.label === "lower");
		assert(lower);
		assert.equal(lower.base, expected);
	}
	config.branch = "missing";
	const missing = await readRepository(cwd, signal);
	assert.match(String(missing.gitbutlerError), /target.*was not found/);
	const missingBase = missing.branches.find(
		(branch) => branch.label === "lower",
	);
	assert(missingBase);
	assert.equal(missingBase.base, null);
});

test("branch diff uses merge base; commit diff includes only that commit; root commit works", async () => {
	const { cwd, git, signal } = fixture();
	const root = git("rev-parse", "HEAD");
	git("switch", "-c", "feature");
	writeFileSync(join(cwd, "one.txt"), "one\n");
	git("add", ".");
	git("commit", "-m", "One");
	writeFileSync(join(cwd, "two.txt"), "two\n");
	git("add", ".");
	git("commit", "-m", "Two");
	const tip = git("rev-parse", "HEAD");
	git("switch", "main");
	writeFileSync(join(cwd, "base-only.txt"), "base\n");
	git("add", ".");
	git("commit", "-m", "Base advanced");
	const branch = await compare(
		cwd,
		{ kind: "branch", branch: "feature", base: config.branch },
		signal,
	);
	const commit = await compare(
		cwd,
		{ kind: "commit", branch: "feature", commit: tip },
		signal,
	);
	const initial = await compare(
		cwd,
		{ kind: "commit", branch: "feature", commit: root },
		signal,
	);
	assert.deepEqual(
		[branch, commit, initial].map((view) => ({
			paths: view.diffs.map((file) => file.path),
			summary: view.summary,
		})),
		[
			{
				paths: ["one.txt", "two.txt"],
				summary: { files: 2, added: 2, deleted: 0 },
			},
			{ paths: ["two.txt"], summary: { files: 1, added: 1, deleted: 0 } },
			{ paths: ["initial.txt"], summary: { files: 1, added: 1, deleted: 0 } },
		],
	);
	assert.equal(git("branch", "--show-current"), "main");
});
test("merge commit compares to first parent and rejects commits outside the branch", async () => {
	const { cwd, git, signal } = fixture();
	git("switch", "-c", "side");
	writeFileSync(join(cwd, "side.txt"), "side\n");
	git("add", ".");
	git("commit", "-m", "Side");
	git("switch", "-c", "feature", "main");
	writeFileSync(join(cwd, "feature.txt"), "feature\n");
	git("add", ".");
	git("commit", "-m", "Feature");
	git("merge", "--no-ff", "side", "-m", "Merge");
	const merge = git("rev-parse", "HEAD");
	const view = await compare(
		cwd,
		{ kind: "commit", branch: "feature", commit: merge },
		signal,
	);
	assert.deepEqual(
		view.diffs.map((file) => file.path),
		["side.txt"],
	);
	await assert.rejects(
		compare(cwd, { kind: "commit", branch: "main", commit: merge }, signal),
	);
});
test("paginates history and rejects invalid offsets and Git option injection", async () => {
	const { cwd, git, signal } = fixture();
	git("switch", "-c", "feature");
	for (let index = 0; index < COMMIT_PAGE_SIZE + 1; index++)
		git("commit", "--allow-empty", "-m", `Commit ${index}`);
	const first = await listCommits(cwd, "feature", config.branch, 0, signal);
	const second = await listCommits(
		cwd,
		"feature",
		config.branch,
		COMMIT_PAGE_SIZE,
		signal,
	);
	assert.deepEqual(
		[
			first.commits.length,
			first.hasMore,
			second.commits.length,
			second.hasMore,
		],
		[COMMIT_PAGE_SIZE, true, 1, false],
	);
	assert.equal(first.commits[0].subject, `Commit ${COMMIT_PAGE_SIZE}`);
	await assert.rejects(
		listCommits(cwd, "main", config.branch, -1, signal),
		/Invalid commit offset/,
	);
	await assert.rejects(
		compare(
			cwd,
			{ kind: "branch", branch: "--output=oops", base: config.branch },
			signal,
		),
	);
});
test("commit history excludes target ancestry after the target advances and is merged", async () => {
	const { cwd, git, signal } = fixture();
	git("switch", "-c", "feature");
	git("commit", "--allow-empty", "-m", "Feature work");
	git("switch", "main");
	git("commit", "--allow-empty", "-m", "Target work");
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	config.branch = "origin/main";
	git("switch", "feature");
	git("merge", "--no-ff", "main", "-m", "Merge target");
	const page = await listCommits(cwd, "feature", config.branch, 0, signal);
	assert.deepEqual(page.commits.map((commit) => commit.subject).sort(), [
		"Feature work",
		"Merge target",
	]);
	assert.equal(page.hasMore, false);
	assert.deepEqual(await listCommits(cwd, "main", config.branch, 0, signal), {
		commits: [],
		hasMore: false,
	});
	git("update-ref", "refs/remotes/origin/main", "feature");
	assert.deepEqual(
		await listCommits(cwd, "feature", config.branch, 0, signal),
		{
			commits: [],
			hasMore: false,
		},
	);
});
test("reports missing merge bases instead of changing comparison semantics", async () => {
	const { cwd, git, signal } = fixture();
	git("switch", "--orphan", "unrelated");
	git("commit", "--allow-empty", "-m", "Unrelated root");
	await assert.rejects(
		compare(
			cwd,
			{ kind: "branch", branch: "unrelated", base: config.branch },
			signal,
		),
		/merge-base/,
	);
});
test("managed commit pagination includes only the selected GitButler branch", async () => {
	const { cwd, signal } = fixture();
	const commits = Array.from({ length: COMMIT_PAGE_SIZE + 1 }, (_, index) => ({
		commitId: index.toString(16).padStart(40, "0"),
		message: `Own ${index}\n\nBody`,
		authorName: "Author",
		createdAt: "2026-10-25T12:00:00Z",
	}));
	config.stacks.push({
		branches: [
			{ name: "feature", commits },
			{ name: "lower", commits: [{ ...commits[0], message: "Lower branch" }] },
			{ name: "empty", commits: [] },
		],
	});
	const first = await listCommits(
		cwd,
		"refs/heads/feature",
		config.branch,
		0,
		signal,
	);
	const second = await listCommits(
		cwd,
		"feature",
		config.branch,
		COMMIT_PAGE_SIZE,
		signal,
	);
	assert.deepEqual(
		[
			first.commits.length,
			first.hasMore,
			second.commits.length,
			second.hasMore,
		],
		[COMMIT_PAGE_SIZE, true, 1, false],
	);
	assert.equal(first.commits[0].subject, "Own 0");
	assert.equal(second.commits[0].subject, `Own ${COMMIT_PAGE_SIZE}`);
	assert.deepEqual(await listCommits(cwd, "empty", config.branch, 0, signal), {
		commits: [],
		hasMore: false,
	});
});
test("stacked branch diff excludes lower branch additions and retains its own deletions", async () => {
	const { cwd, git, signal } = fixture();
	git("switch", "-c", "lower");
	writeFileSync(join(cwd, "introduced.txt"), "keep\nremove\n");
	writeFileSync(join(cwd, "lower-only.txt"), "lower only\n");
	git("add", ".");
	git("commit", "-m", "Lower adds files");
	git("switch", "-c", "upper");
	writeFileSync(join(cwd, "introduced.txt"), "keep\n");
	git("add", ".");
	git("commit", "-m", "Upper removes a line");
	git("switch", "-c", "empty");
	config.stacks.push({
		branches: [
			{ name: "empty", commits: [] },
			{ name: "upper", commits: [] },
			{ name: "lower", commits: [] },
		],
	});
	assert.deepEqual(
		(await readRepository(cwd, signal)).branches
			.map(({ label, base }) => ({ label, base }))
			.sort((a, b) => a.label.localeCompare(b.label)),
		[
			{ label: "empty", base: "refs/heads/upper" },
			{ label: "lower", base: "refs/heads/main" },
			{ label: "upper", base: "refs/heads/lower" },
		],
	);
	const view = await compare(
		cwd,
		{ kind: "branch", branch: "refs/heads/upper", base: "refs/heads/lower" },
		signal,
	);
	assert.deepEqual(
		{
			target: view.target,
			summary: view.summary,
			files: view.diffs.map((file) => ({
				path: file.path,
				status: file.status,
				addedLines: file.addedLines,
				deletedLines: file.deletedLines,
			})),
		},
		{
			target: "refs/heads/lower",
			summary: { files: 1, added: 0, deleted: 1 },
			files: [
				{
					path: "introduced.txt",
					status: "modified",
					addedLines: 0,
					deletedLines: 1,
				},
			],
		},
	);
	assert.deepEqual(
		(
			await compare(
				cwd,
				{ kind: "branch", branch: "empty", base: "upper" },
				signal,
			)
		).summary,
		{ files: 0, added: 0, deleted: 0 },
	);
	assert.deepEqual(
		(
			await compare(
				cwd,
				{ kind: "branch", branch: "lower", base: config.branch },
				signal,
			)
		).summary,
		{ files: 2, added: 3, deleted: 0 },
	);
});
test("repository comparisons ignore relative and prefix configuration from nested cwd", async () => {
	const { cwd, git, signal } = fixture();
	const initial = git("rev-parse", "HEAD");
	git("switch", "-c", "feature");
	mkdirSync(join(cwd, "nested"));
	writeFileSync(join(cwd, "initial.txt"), "changed\n");
	writeFileSync(join(cwd, "nested", "inside.txt"), "inside\n");
	git("add", ".");
	git("commit", "-m", "Inside and outside");
	const tip = git("rev-parse", "HEAD");
	const read = () =>
		Promise.all([
			compare(
				join(cwd, "nested"),
				{ kind: "branch", branch: "feature", base: config.branch },
				signal,
			),
			compare(
				join(cwd, "nested"),
				{ kind: "commit", branch: "feature", commit: tip },
				signal,
			),
			compare(
				join(cwd, "nested"),
				{ kind: "commit", branch: "feature", commit: initial },
				signal,
			),
		]);
	const expected = await read();
	assert.deepEqual(
		expected.map((view) => view.diffs.map((file) => file.path)),
		[
			["initial.txt", "nested/inside.txt"],
			["initial.txt", "nested/inside.txt"],
			["initial.txt"],
		],
	);
	git("config", "diff.relative", "true");
	git("config", "diff.noprefix", "true");
	assert.deepEqual(await read(), expected);
	git("config", "diff.noprefix", "false");
	git("config", "diff.srcPrefix", "old/");
	git("config", "diff.dstPrefix", "new/");
	assert.deepEqual(await read(), expected);
});
test("Git newline-only commits preserve which side has no final newline", async () => {
	const { cwd, git, signal } = fixture();
	git("switch", "-c", "feature");
	writeFileSync(join(cwd, "initial.txt"), "initial");
	git("add", ".");
	git("commit", "-m", "Remove newline");
	const removed = await compare(
		cwd,
		{ kind: "branch", branch: "feature", base: config.branch },
		signal,
	);
	writeFileSync(join(cwd, "initial.txt"), "initial\n");
	git("add", ".");
	git("commit", "-m", "Restore newline");
	const added = await compare(
		cwd,
		{ kind: "commit", branch: "feature", commit: git("rev-parse", "HEAD") },
		signal,
	);
	assert.deepEqual(
		await Promise.all(
			[removed, added].map(async (view) => {
				const contents = await readFileContents(
					cwd,
					view.snapshot,
					"initial.txt",
					signal,
				);
				assert(contents.kind === "text");
				return {
					summary: view.summary,
					before: contents.before !== null && !contents.before.endsWith("\n"),
					after: contents.after !== null && !contents.after.endsWith("\n"),
				};
			}),
		),
		[
			{
				summary: { files: 1, added: 1, deleted: 1 },
				before: false,
				after: true,
			},
			{
				summary: { files: 1, added: 1, deleted: 1 },
				before: true,
				after: false,
			},
		],
	);
});
test("full source uses pinned merge-base and tip revisions, even after the branch and working tree move", async () => {
	const { cwd, git, signal } = fixture();
	const original = Array.from(
		{ length: 30 },
		(_, index) => `line ${index + 1}\n`,
	).join("");
	writeFileSync(join(cwd, "initial.txt"), original);
	git("add", ".");
	git("commit", "-m", "Full source baseline");
	const base = git("rev-parse", "HEAD");
	git("switch", "-c", "feature");
	const changed = original.replace("line 15", "changed 15");
	writeFileSync(join(cwd, "initial.txt"), changed);
	git("add", ".");
	git("commit", "-m", "Middle change");
	const tip = git("rev-parse", "HEAD");
	const view = await compare(
		cwd,
		{ kind: "branch", branch: "feature", base: config.branch },
		signal,
	);
	assert.deepEqual(view.snapshot, {
		kind: "revision",
		repository: git("rev-parse", "--show-toplevel"),
		before: base,
		after: tip,
	});
	writeFileSync(join(cwd, "initial.txt"), "new branch tip\n");
	git("add", ".");
	git("commit", "-m", "Branch moved");
	writeFileSync(join(cwd, "initial.txt"), "uncommitted\n");
	assert.deepEqual(
		await readFileContents(cwd, view.snapshot, "initial.txt", signal),
		{ kind: "text", before: original, after: changed },
	);
	await assert.rejects(
		readFileContents(cwd, view.snapshot, "untracked.txt", signal),
		/belong to this comparison/,
	);
	await assert.rejects(
		readFileContents(
			cwd,
			{ ...view.snapshot, repository: "/another" },
			"initial.txt",
			signal,
		),
		/another repository/,
	);
	await assert.rejects(
		readFileContents(
			cwd,
			{ ...view.snapshot, after: "--output=oops" },
			"initial.txt",
			signal,
		),
	);
});
test("full source distinguishes absent, empty, binary, invalid UTF-8, and root files", async () => {
	const { cwd, git, signal } = fixture();
	const root = git("rev-parse", "HEAD");
	const initial = await compare(
		cwd,
		{ kind: "commit", branch: "main", commit: root },
		signal,
	);
	assert.equal(initial.snapshot.before, null);
	assert.deepEqual(
		await readFileContents(cwd, initial.snapshot, "initial.txt", signal),
		{ kind: "text", before: null, after: "initial\n" },
	);
	git("switch", "-c", "feature");
	git("rm", "initial.txt");
	writeFileSync(join(cwd, "empty.txt"), "");
	writeFileSync(join(cwd, "binary.dat"), Buffer.from([1, 0, 2]));
	writeFileSync(join(cwd, "invalid.txt"), Buffer.from([0xff]));
	writeFileSync(join(cwd, "bom.txt"), "\ufefftext\n");
	git("add", ".");
	git("commit", "-m", "File kinds");
	const view = await compare(
		cwd,
		{ kind: "branch", branch: "feature", base: config.branch },
		signal,
	);
	assert.deepEqual(
		await readFileContents(cwd, view.snapshot, "initial.txt", signal),
		{ kind: "text", before: "initial\n", after: null },
	);
	assert.deepEqual(
		await readFileContents(cwd, view.snapshot, "empty.txt", signal),
		{ kind: "text", before: null, after: "" },
	);
	assert.deepEqual(
		await readFileContents(cwd, view.snapshot, "bom.txt", signal),
		{ kind: "text", before: null, after: "\ufefftext\n" },
	);
	assert.deepEqual(
		await readFileContents(cwd, view.snapshot, "binary.dat", signal),
		{
			kind: "unavailable",
			message: "Files containing NUL bytes cannot be displayed or annotated.",
		},
	);
	assert.deepEqual(
		await readFileContents(cwd, view.snapshot, "invalid.txt", signal),
		{ kind: "unavailable", message: "Only UTF-8 text files can be displayed." },
	);
});

function remoteHead(git: (...args: string[]) => string): void {
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
}

test("resolves a branch scope against the remote default branch", async () => {
	const { cwd, git, signal } = fixture();
	git("branch", "feature");
	remoteHead(git);
	config.branch = "origin/main";
	const scope = await resolveReviewScope(
		cwd,
		{ repository: "", branch: "feature" },
		signal,
	);
	assert.deepEqual(scope, {
		kind: "branch",
		repository: realpathSync(cwd),
		ref: "refs/heads/feature",
		base: { kind: "manual", ref: "refs/remotes/origin/main" },
		revision: { kind: "all-commits" },
	});
});

test("resolves a commit scope with its subject and author", async () => {
	const { cwd, git, signal } = fixture();
	git("checkout", "-q", "-b", "feature");
	writeFileSync(join(cwd, "feature.txt"), "feature\n");
	git("add", ".");
	git("commit", "-m", "Add feature");
	const sha = git("rev-parse", "HEAD");
	const date = git("show", "-s", "--format=%aI", sha);
	git("checkout", "-q", "main");
	remoteHead(git);
	config.branch = "origin/main";
	const scope = await resolveReviewScope(
		cwd,
		{ repository: "", branch: "feature", commit: sha },
		signal,
	);
	assert.deepEqual(scope, {
		kind: "branch",
		repository: realpathSync(cwd),
		ref: "refs/heads/feature",
		base: { kind: "manual", ref: "refs/remotes/origin/main" },
		revision: {
			kind: "commit",
			commit: { sha, subject: "Add feature", author: "Diff Test", date },
		},
	});
});

test("rejects an unknown branch", async () => {
	const { cwd, git, signal } = fixture();
	remoteHead(git);
	config.branch = "origin/main";
	await assert.rejects(
		resolveReviewScope(cwd, { repository: "", branch: "missing" }, signal),
		/Unknown branch "missing"/,
	);
});

test("rejects a commit that is not an ancestor of the branch", async () => {
	const { cwd, git, signal } = fixture();
	git("branch", "feature");
	writeFileSync(join(cwd, "main.txt"), "main\n");
	git("add", ".");
	git("commit", "-m", "Main only");
	const main = git("rev-parse", "HEAD");
	remoteHead(git);
	config.branch = "origin/main";
	await assert.rejects(
		resolveReviewScope(
			cwd,
			{ repository: "", branch: "feature", commit: main },
			signal,
		),
		/not an ancestor/,
	);
});

test("rejects a branch without a baseline", async () => {
	const { cwd, git, signal } = fixture();
	git("branch", "feature");
	config.branch = "origin/main";
	await assert.rejects(
		resolveReviewScope(cwd, { repository: "", branch: "feature" }, signal),
		/without a baseline/,
	);
});

test("resolves a branch hidden by the review list's age filter", async () => {
	const { cwd, git, signal } = fixture();
	git("checkout", "-q", "-b", "legacy");
	writeFileSync(join(cwd, "legacy.txt"), "legacy\n");
	git("add", ".");
	execFileSync("git", ["commit", "-m", "Legacy"], {
		cwd,
		env: { ...gitEnv(), GIT_COMMITTER_DATE: "2020-01-01T00:00:00" },
	});
	git("checkout", "-q", "main");
	remoteHead(git);
	config.branch = "origin/main";
	const scope = await resolveReviewScope(
		cwd,
		{ repository: "", branch: "legacy" },
		signal,
	);
	assert.deepEqual(scope, {
		kind: "branch",
		repository: realpathSync(cwd),
		ref: "refs/heads/legacy",
		base: { kind: "manual", ref: "refs/remotes/origin/main" },
		revision: { kind: "all-commits" },
	});
});

test("resolves a branch hidden by the GitButler review filter", async () => {
	const { cwd, git, signal } = fixture();
	remoteHead(git);
	config.branch = "origin/main";
	const scope = await resolveReviewScope(
		cwd,
		{ repository: "", branch: "main" },
		signal,
	);
	assert.deepEqual(scope, {
		kind: "branch",
		repository: realpathSync(cwd),
		ref: "refs/heads/main",
		base: { kind: "manual", ref: "refs/remotes/origin/main" },
		revision: { kind: "all-commits" },
	});
});
