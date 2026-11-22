import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { branchLabel, snapshotSchema } from "@lukstei/util-review-ui/review";
import {
	COMMIT_PAGE_SIZE,
	type GitCommit,
	type GitCommitPage,
	type GitComparison,
	type GitDiffView,
	type GitFileContents,
	type GitFileDiff,
	type GitRepository,
	type GitSnapshot,
	MAX_BRANCH_AGE_MS,
	type ResolvedReviewScope,
	type ReviewTarget,
} from "@lukstei/util-review-ui/types";
import { z } from "zod";

const execute = promisify(execFile);
const targetSchema = z.object({ branch: z.string().min(1) });
const statusSchema = z.object({
	stacks: z.array(
		z.object({
			branches: z.array(
				z.object({
					name: z.string(),
					commits: z.array(
						z.object({
							commitId: z.string(),
							message: z.string(),
							authorName: z.string(),
							createdAt: z.string(),
						}),
					),
				}),
			),
		}),
	),
});
const diffOptions = [
	"--no-ext-diff",
	"--no-textconv",
	"--no-color",
	"--no-renames",
	"--no-relative",
];

async function git(
	cwd: string,
	args: string[],
	signal: AbortSignal,
): Promise<string> {
	const { stdout } = await execute(
		"git",
		[
			"--no-optional-locks",
			"-c",
			"core.quotePath=false",
			"-c",
			"diff.autoRefreshIndex=false",
			...args,
		],
		{
			cwd,
			signal,
			maxBuffer: 10 * 1024 * 1024,
		},
	);
	return stdout;
}

export async function repositoryRoot(
	cwd: string,
	signal: AbortSignal,
): Promise<string | null> {
	try {
		const { stdout } = await execute("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			signal,
			env: { ...process.env, LC_ALL: "C" },
		});
		return stdout.trim();
	} catch (error) {
		signal.throwIfAborted();
		if (
			error instanceof Error &&
			"stderr" in error &&
			typeof error.stderr === "string" &&
			error.stderr.includes("fatal: not a git repository")
		)
			return null;
		throw error;
	}
}

async function resolveCommit(
	cwd: string,
	ref: string,
	signal: AbortSignal,
): Promise<string> {
	return (
		await git(
			cwd,
			["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
			signal,
		)
	).trim();
}

async function head(cwd: string, signal: AbortSignal): Promise<string | null> {
	try {
		return (
			await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"], signal)
		).trim();
	} catch (error) {
		// edge case: an unborn branch has an index but no HEAD commit.
		if (error instanceof Error && "code" in error && error.code === 1)
			return null;
		throw error;
	}
}

async function targetBranch(cwd: string, signal: AbortSignal): Promise<string> {
	const { stdout } = await execute("but", ["--json", "config", "target"], {
		cwd,
		signal,
	});
	const value: unknown = JSON.parse(stdout);
	return targetSchema.parse(value).branch;
}

async function readStacks(cwd: string, signal: AbortSignal) {
	const { stdout } = await execute("but", ["--json", "status"], {
		cwd,
		signal,
		maxBuffer: 10 * 1024 * 1024,
	});
	const value: unknown = JSON.parse(stdout);
	return statusSchema.parse(value).stacks;
}

async function readButler(cwd: string, signal: AbortSignal) {
	try {
		const commonDir = (
			await git(cwd, ["rev-parse", "--git-common-dir"], signal)
		).trim();
		const marker = resolve(cwd, commonDir, "gitbutler");
		const info = await stat(marker);
		if (!info.isDirectory()) return { kind: "unconfigured" as const };
	} catch {
		signal.throwIfAborted();
		return { kind: "unconfigured" as const };
	}
	try {
		const [target, stacks] = await Promise.all([
			targetBranch(cwd, signal),
			readStacks(cwd, signal),
		]);
		return { kind: "ready" as const, target, stacks };
	} catch (error) {
		signal.throwIfAborted();
		const output =
			error instanceof Error
				? `${error.message} ${"stdout" in error ? String(error.stdout) : ""} ${"stderr" in error ? String(error.stderr) : ""}`
				: String(error);
		const code =
			error instanceof Error && "code" in error ? String(error.code) : "";
		const unconfigured =
			code === "ENOENT" ||
			output.includes("ENOENT") ||
			output.includes("not installed") ||
			output.includes("setup_required") ||
			output.includes("No GitButler project found") ||
			output.includes("not a GitButler project");
		if (unconfigured) return { kind: "unconfigured" as const };
		return {
			kind: "unavailable" as const,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

function branchBase(
	stacks: z.infer<typeof statusSchema>["stacks"],
	ref: string,
	target: string | null,
): string | null {
	const name = ref.startsWith("refs/heads/")
		? ref.slice("refs/heads/".length)
		: ref;
	for (const { branches } of stacks) {
		const index = branches.findIndex((branch) => branch.name === name);
		// edge case: GitButler orders branches top-first; exclude all changes below the selected branch.
		if (index !== -1 && index + 1 < branches.length)
			return `refs/heads/${branches[index + 1].name}`;
	}
	return target;
}

export async function readRepository(
	cwd: string,
	signal: AbortSignal,
): Promise<GitRepository> {
	const [refs, butler] = await Promise.all([
		git(
			cwd,
			[
				"for-each-ref",
				"--sort=refname",
				"--format=%(refname)%09%(symref)%09%(committerdate:unix)",
				"refs/heads",
				"refs/remotes",
			],
			signal,
		),
		readButler(cwd, signal),
	]);
	const entries = refs
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [ref, symbolic, committed] = line.split("\t");
			return { ref, symbolic, modifiedAt: Number(committed) * 1000 };
		});
	const defaults = [
		...new Set(
			entries
				.filter(
					(item) =>
						item.ref.startsWith("refs/remotes/") &&
						item.ref.endsWith("/HEAD") &&
						item.symbolic !== "",
				)
				.map((item) => item.symbolic),
		),
	];
	const label = (ref: string) => ref.replace(/^refs\/(?:heads|remotes)\//, "");
	const target = defaults.length === 1 ? defaults[0] : null;
	const baselines = entries
		.filter((item) => item.symbolic === "")
		.map(({ ref }) => ({ ref, label: label(ref) }));
	let managedTarget: string | null = null;
	let gitbutlerError: string | null = null;
	if (butler.kind === "unavailable") {
		gitbutlerError = butler.message;
	} else if (butler.kind === "ready") {
		const exact = baselines.find((entry) => entry.ref === butler.target);
		const matches =
			exact === undefined
				? baselines.filter((entry) => entry.label === butler.target)
				: [exact];
		if (matches.length === 1) managedTarget = matches[0].ref;
		else
			gitbutlerError = `GitButler target "${butler.target}" ${matches.length === 0 ? "was not found" : "is ambiguous"}; configure an explicit branch ref.`;
	}

	const branches = entries
		.filter(
			(item) =>
				item.ref.startsWith("refs/heads/") &&
				item.symbolic === "" &&
				Date.now() - item.modifiedAt <= MAX_BRANCH_AGE_MS &&
				(butler.kind !== "ready" ||
					![
						"refs/heads/gitbutler/workspace",
						"refs/heads/gitbutler/target",
						"refs/heads/main",
					].includes(item.ref)),
		)
		.sort((a, b) => b.modifiedAt - a.modifiedAt)
		.map(({ ref, modifiedAt }) => {
			const name = label(ref);
			const managed =
				butler.kind === "ready" &&
				butler.stacks.some((stack) =>
					stack.branches.some((branch) => branch.name === name),
				);
			return {
				ref,
				label: name,
				modifiedAt,
				base:
					managed && butler.kind === "ready"
						? branchBase(butler.stacks, ref, managedTarget)
						: target,
				kind: managed ? ("gitbutler" as const) : ("git" as const),
			};
		});
	return {
		cwd,
		target,
		baselines,
		branches,
		gitbutlerError,
	};
}

const commitFormat = "%H%x00%s%x00%an%x00%aI";

function parseCommitRecord(entry: string): GitCommit {
	const [sha, subject, author, date] = entry.split("\0");
	assert(sha !== undefined && subject !== undefined);
	assert(author !== undefined && date !== undefined);
	return { sha, subject, author, date };
}

export async function readCommit(
	cwd: string,
	rev: string,
	signal: AbortSignal,
): Promise<GitCommit> {
	const entry = (
		await git(cwd, ["show", "-s", `--format=${commitFormat}`, rev], signal)
	).trimEnd();
	return parseCommitRecord(entry);
}

async function isAncestor(
	cwd: string,
	ancestor: string,
	descendant: string,
	signal: AbortSignal,
): Promise<boolean> {
	try {
		await git(
			cwd,
			["merge-base", "--is-ancestor", ancestor, descendant],
			signal,
		);
		return true;
	} catch (error) {
		signal.throwIfAborted();
		// edge case: `merge-base --is-ancestor` exits 1 for a rejected pair and uses other codes for real failures.
		if (error instanceof Error && "code" in error && error.code === 1)
			return false;
		throw error;
	}
}

/**
 * Turn a repository path and branch/commit request into the scope the review pane renders.
 * @param cwd - repository root, or a directory inside it.
 * @param target - requested repository, branch, and optional commit.
 * @param signal - cancellation for every Git read.
 * @returns the branch scope with a resolved baseline and commit page entry.
 */
export async function resolveReviewScope(
	cwd: string,
	target: ReviewTarget,
	signal: AbortSignal,
): Promise<ResolvedReviewScope> {
	const repository = (
		await git(cwd, ["rev-parse", "--show-toplevel"], signal)
	).trim();
	const repo = await readRepository(repository, signal);
	const known = repo.branches.find(
		(item) => item.ref === target.branch || item.label === target.branch,
	);
	let ref: string;
	let label: string;
	let base: string;
	if (known === undefined) {
		// edge case: branches hidden by the review list's age or GitButler filters still exist in Git.
		ref = target.branch.startsWith("refs/heads/")
			? target.branch
			: `refs/heads/${target.branch}`;
		label = branchLabel(ref);
		try {
			await resolveCommit(repository, ref, signal);
		} catch {
			signal.throwIfAborted();
			const names = repo.branches.slice(0, 20).map((item) => item.label);
			throw new Error(
				`Unknown branch "${target.branch}" in ${repository}. Available: ${names.length === 0 ? "none" : names.join(", ")}`,
			);
		}
		base = repo.target ?? "";
	} else {
		ref = known.ref;
		label = known.label;
		base = known.base ?? repo.target ?? "";
	}
	if (base === "")
		throw new Error(
			`Cannot compare "${label}" without a baseline; set a remote HEAD or choose a baseline in the review toolbar`,
		);
	const scope = {
		kind: "branch" as const,
		repository,
		ref,
		base: { kind: "manual" as const, ref: base },
	};
	if (target.commit === undefined)
		return { ...scope, revision: { kind: "all-commits" } };
	const sha = await resolveCommit(repository, target.commit, signal);
	if (!(await isAncestor(repository, sha, ref, signal)))
		throw new Error(
			`Commit "${target.commit}" is not an ancestor of "${label}"`,
		);
	return {
		...scope,
		revision: {
			kind: "commit",
			commit: await readCommit(repository, sha, signal),
		},
	};
}

export async function listCommits(
	cwd: string,
	branch: string,
	base: string,
	offset: number,
	signal: AbortSignal,
): Promise<GitCommitPage> {
	assert(Number.isSafeInteger(offset) && offset >= 0, "Invalid commit offset");
	const butler = await readButler(cwd, signal);
	const name = branch.startsWith("refs/heads/")
		? branch.slice("refs/heads/".length)
		: branch;
	if (butler.kind === "ready") {
		const owned = butler.stacks
			.flatMap((stack) => stack.branches)
			.find((item) => item.name === name);
		if (owned !== undefined)
			return {
				commits: owned.commits
					.slice(offset, offset + COMMIT_PAGE_SIZE)
					.map((commit) => ({
						sha: commit.commitId,
						subject: commit.message.split("\n")[0],
						author: commit.authorName,
						date: commit.createdAt,
					})),
				hasMore: owned.commits.length > offset + COMMIT_PAGE_SIZE,
			};
	}
	const [sha, baseline] = await Promise.all([
		resolveCommit(cwd, branch, signal),
		resolveCommit(cwd, base, signal),
	]);
	const log = await git(
		cwd,
		[
			"log",
			`--format=${commitFormat}`,
			`--skip=${offset}`,
			`--max-count=${COMMIT_PAGE_SIZE + 1}`,
			`${baseline}..${sha}`,
			"--",
		],
		signal,
	);
	const entries = log.trimEnd().split("\n").filter(Boolean);
	return {
		commits: entries.slice(0, COMMIT_PAGE_SIZE).map(parseCommitRecord),
		hasMore: entries.length > COMMIT_PAGE_SIZE,
	};
}

function revisionArgs(snapshot: GitSnapshot): string[] {
	return snapshot.before === null
		? ["diff-tree", "--root", "--no-commit-id", "-r", snapshot.after]
		: ["diff", snapshot.before, snapshot.after];
}

async function fileMetadata(
	cwd: string,
	args: string[],
	signal: AbortSignal,
): Promise<GitFileDiff[]> {
	const [names, stats] = await Promise.all([
		git(cwd, [...args, ...diffOptions, "--name-status", "-z", "--"], signal),
		git(cwd, [...args, ...diffOptions, "--numstat", "-z", "--"], signal),
	]);
	const counts = new Map(
		stats
			.split("\0")
			.filter(Boolean)
			.map((record) => {
				const first = record.indexOf("\t");
				const second = record.indexOf("\t", first + 1);
				assert(first > 0 && second > first, "Invalid Git numstat record");
				const added = record.slice(0, first);
				const deleted = record.slice(first + 1, second);
				return [
					record.slice(second + 1),
					{
						addedLines: added === "-" ? 0 : Number(added),
						deletedLines: deleted === "-" ? 0 : Number(deleted),
					},
				];
			}),
	);
	const records = names.split("\0");
	assert.equal(records.pop(), "", "Git filenames must be NUL-terminated");
	const diffs: GitFileDiff[] = [];
	for (let i = 0; i < records.length; i += 2) {
		const status = records[i];
		const path = records[i + 1];
		assert.notEqual(
			status,
			"U",
			"Unresolved index conflicts cannot be displayed as a two-sided diff",
		);
		assert(
			["A", "D", "M", "T"].includes(status),
			`Unsupported Git change: ${status}`,
		);
		const count = counts.get(path);
		// edge case: name-status can report stat-only modifications; numstat confirms actual differences without refreshing the index.
		if (count === undefined && status === "M") continue;
		assert(count, "Git change is missing its numstat record");
		diffs.push({
			path,
			status:
				status === "A" ? "added" : status === "D" ? "deleted" : "modified",
			...count,
		});
	}
	return diffs;
}

function summary(diffs: GitFileDiff[]) {
	return {
		files: diffs.length,
		added: diffs.reduce((sum, file) => sum + file.addedLines, 0),
		deleted: diffs.reduce((sum, file) => sum + file.deletedLines, 0),
	};
}

function digest(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

async function worktreeFile(repository: string, path: string) {
	const filename = resolve(repository, path);
	const inside = relative(repository, filename);
	assert(
		inside !== "" &&
			!isAbsolute(inside) &&
			inside !== ".." &&
			!inside.startsWith(`..${sep}`),
		"File must stay inside the repository",
	);
	const parent = relative(
		await realpath(repository),
		await realpath(dirname(filename)),
	);
	assert(
		!isAbsolute(parent) && parent !== ".." && !parent.startsWith(`..${sep}`),
		"File parent must stay inside the repository",
	);
	const stat = await lstat(filename);
	// edge case: display a symlink's stored target text, never the target file's contents.
	if (stat.isSymbolicLink())
		return {
			contents: await readlink(filename, { encoding: "buffer" }),
			mode: stat.mode,
		};
	if (!stat.isFile()) return { contents: null, mode: stat.mode };
	return { contents: await readFile(filename), mode: stat.mode };
}

async function workingChanges(
	repository: string,
	kind: "staged" | "unstaged",
	signal: AbortSignal,
) {
	const index = await git(repository, ["ls-files", "--stage", "-z"], signal);
	const conflicts = await git(
		repository,
		["ls-files", "--unmerged", "-z"],
		signal,
	);
	assert.equal(
		conflicts,
		"",
		"Unresolved index conflicts cannot be displayed as a two-sided diff",
	);
	const before =
		kind === "staged" ? await head(repository, signal) : digest(index);
	const args =
		kind === "staged"
			? ["diff", "--cached", ...(before === null ? [] : [before])]
			: ["diff"];
	const diffs = await fileMetadata(repository, args, signal);
	const contents = new Map<string, Buffer | null>();
	const identities: [string, number, string | null][] = [];
	if (kind === "unstaged") {
		const untracked = (
			await git(
				repository,
				["ls-files", "--others", "--exclude-standard", "-z"],
				signal,
			)
		)
			.split("\0")
			.filter(Boolean);
		const untrackedPaths = new Set(untracked);
		for (const path of untracked)
			diffs.push({ path, status: "added", addedLines: 0, deletedLines: 0 });
		await Promise.all(
			diffs.map(async (file) => {
				if (file.status === "deleted") {
					contents.set(file.path, null);
					return;
				}
				const value = await worktreeFile(repository, file.path);
				contents.set(file.path, value.contents);
				identities.push([
					file.path,
					value.mode,
					value.contents === null ? null : digest(value.contents),
				]);
				const supportsLineCounting =
					value.contents !== null && !value.contents.includes(0);
				if (untrackedPaths.has(file.path) && supportsLineCounting) {
					file.addedLines =
						value.contents.length === 0
							? 0
							: value.contents.toString("utf8").split("\n").length -
								(value.contents.at(-1) === 10 ? 1 : 0);
				}
			}),
		);
	}
	assert.equal(
		await git(repository, ["ls-files", "--stage", "-z"], signal),
		index,
		"Index changed; refresh the comparison",
	);
	const snapshot: GitSnapshot = {
		kind,
		repository,
		before,
		after:
			kind === "staged"
				? digest(index)
				: digest(
						JSON.stringify([
							diffs,
							identities.sort(([a], [b]) => a.localeCompare(b)),
						]),
					),
	};
	return { snapshot, diffs, index, contents };
}

export async function compare(
	cwd: string,
	comparison: GitComparison,
	signal: AbortSignal,
): Promise<GitDiffView> {
	const repository = (
		await git(cwd, ["rev-parse", "--show-toplevel"], signal)
	).trim();
	if (comparison.kind === "staged" || comparison.kind === "unstaged") {
		const { snapshot, diffs } = await workingChanges(
			repository,
			comparison.kind,
			signal,
		);
		return {
			target:
				comparison.kind === "staged" ? "HEAD → Index" : "Index → Working tree",
			snapshot,
			diffs,
			summary: summary(diffs),
		};
	}
	const branch = await resolveCommit(repository, comparison.branch, signal);
	let before: string | null;
	let after: string;
	let target: string;
	if (comparison.kind === "branch") {
		const base = await resolveCommit(repository, comparison.base, signal);
		before = (
			await git(repository, ["merge-base", base, branch], signal)
		).trim();
		after = branch;
		target = comparison.base;
	} else {
		after = await resolveCommit(repository, comparison.commit, signal);
		await git(
			repository,
			["merge-base", "--is-ancestor", after, branch],
			signal,
		);
		const parents = (
			await git(
				repository,
				["rev-list", "--parents", "-n", "1", after, "--"],
				signal,
			)
		)
			.trim()
			.split(" ");
		// edge case: root commits have no parent; merge commits compare to their first parent.
		before = parents.length === 1 ? null : parents[1];
		target = before === null ? "Initial commit" : before;
	}
	const snapshot: GitSnapshot = { kind: "revision", repository, before, after };
	const diffs = await fileMetadata(repository, revisionArgs(snapshot), signal);
	return { target, snapshot, diffs, summary: summary(diffs) };
}

async function blob(
	repository: string,
	object: string,
	signal: AbortSignal,
): Promise<Buffer> {
	const { stdout } = await execute("git", ["cat-file", "blob", object], {
		cwd: repository,
		signal,
		encoding: "buffer",
		maxBuffer: 10 * 1024 * 1024,
	});
	return stdout;
}

async function revisionFile(
	repository: string,
	revision: string | null,
	path: string,
	signal: AbortSignal,
): Promise<Buffer | null> {
	if (revision === null) return null;
	const entry = await git(
		repository,
		["--literal-pathspecs", "ls-tree", "-z", revision, "--", path],
		signal,
	);
	if (entry === "") return null;
	const separator = entry.indexOf("\t");
	const [, type, object] = entry.slice(0, separator).split(" ");
	assert.equal(
		entry.slice(separator + 1, -1),
		path,
		"Expected an exact file path",
	);
	assert.equal(type, "blob", "Only file blobs can be displayed");
	return blob(repository, object, signal);
}

export async function readFileContents(
	cwd: string,
	snapshot: GitSnapshot,
	path: string,
	signal: AbortSignal,
): Promise<GitFileContents> {
	snapshotSchema.parse(snapshot);
	const repository = (
		await git(cwd, ["rev-parse", "--show-toplevel"], signal)
	).trim();
	assert.equal(
		snapshot.repository,
		repository,
		"Comparison belongs to another repository",
	);
	let before: Buffer | null;
	let after: Buffer | null;
	if (snapshot.kind === "revision") {
		const diffs = await fileMetadata(
			repository,
			revisionArgs(snapshot),
			signal,
		);
		assert(
			diffs.some((file) => file.path === path),
			"File must belong to this comparison",
		);
		[before, after] = await Promise.all([
			revisionFile(repository, snapshot.before, path, signal),
			revisionFile(repository, snapshot.after, path, signal),
		]);
	} else {
		// smell: stateless fingerprints rescan changed files per read; per-file identities would reduce work for large reviews.
		const current = await workingChanges(repository, snapshot.kind, signal);
		assert.deepEqual(
			current.snapshot,
			snapshot,
			"Contents changed; refresh the comparison",
		);
		const file = current.diffs.find((file) => file.path === path);
		assert(file, "File must belong to this comparison");
		const entry = current.index
			.split("\0")
			.find((entry) => entry.slice(entry.indexOf("\t") + 1) === path);
		let staged: Buffer | null = null;
		if (entry !== undefined) {
			const [mode, object] = entry.slice(0, entry.indexOf("\t")).split(" ");
			if (mode === "160000")
				return {
					kind: "unavailable",
					message: "Submodule change; no text display or line comments.",
				};
			staged = await blob(repository, object, signal);
		}
		if (snapshot.kind === "staged") {
			before = await revisionFile(repository, snapshot.before, path, signal);
			after = staged;
		} else {
			before = staged;
			const content = current.contents.get(path);
			assert(
				content !== undefined,
				"Working-tree content must belong to this comparison",
			);
			if (content === null && file.status !== "deleted")
				return {
					kind: "unavailable",
					message: "Only files and symlinks can be displayed.",
				};
			after = content;
		}
	}
	if (
		[before, after]
			.filter((content) => content !== null)
			.some((content) => content.includes(0))
	)
		return {
			kind: "unavailable",
			message: "Files containing NUL bytes cannot be displayed or annotated.",
		};
	try {
		const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
		return {
			kind: "text",
			before: before === null ? null : decoder.decode(before),
			after: after === null ? null : decoder.decode(after),
		};
	} catch {
		return {
			kind: "unavailable",
			message: "Only UTF-8 text files can be displayed.",
		};
	}
}
