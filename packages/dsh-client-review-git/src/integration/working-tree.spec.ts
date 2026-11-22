import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { compare, readFileContents } from "../git-service.ts";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
function fixture() {
	const cwd = mkdtempSync(join(tmpdir(), "dsh-working-changes-"));
	directories.push(cwd);
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_NOSYSTEM: "1",
			},
		}).trim();
	git("init", "--initial-branch=trunk");
	git("config", "user.name", "Diff Test");
	git("config", "user.email", "diff@example.test");
	const signal = new AbortController().signal;
	return { cwd, git, signal };
}

test("valid UTF-8 containing NUL has an explicit unsupported-content notice and no untracked line count", async () => {
	const { cwd, signal } = fixture();
	writeFileSync(join(cwd, "nul.txt"), "before\0after\n");
	const view = await compare(cwd, { kind: "unstaged" }, signal);
	assert.deepEqual(view.diffs, [
		{ path: "nul.txt", status: "added", addedLines: 0, deletedLines: 0 },
	]);
	assert.deepEqual(
		await readFileContents(cwd, view.snapshot, "nul.txt", signal),
		{
			kind: "unavailable",
			message: "Files containing NUL bytes cannot be displayed or annotated.",
		},
	);
});

test("partially staged files use distinct full contents and reads leave the index unchanged", async () => {
	const { cwd, git, signal } = fixture();
	writeFileSync(join(cwd, "file.txt"), "head\n");
	git("add", ".");
	git("commit", "-m", "Initial");
	writeFileSync(join(cwd, "file.txt"), "index\n");
	git("add", ".");
	writeFileSync(join(cwd, "file.txt"), "worktree\n");
	const index = readFileSync(join(cwd, ".git/index"));
	const staged = await compare(cwd, { kind: "staged" }, signal);
	const unstaged = await compare(cwd, { kind: "unstaged" }, signal);
	expect({
		staged: await readFileContents(cwd, staged.snapshot, "file.txt", signal),
		unstaged: await readFileContents(
			cwd,
			unstaged.snapshot,
			"file.txt",
			signal,
		),
		stagedFiles: staged.diffs,
		unstagedFiles: unstaged.diffs,
	}).toMatchInlineSnapshot(`
		{
		  "staged": {
		    "after": "index
		",
		    "before": "head
		",
		    "kind": "text",
		  },
		  "stagedFiles": [
		    {
		      "addedLines": 1,
		      "deletedLines": 1,
		      "path": "file.txt",
		      "status": "modified",
		    },
		  ],
		  "unstaged": {
		    "after": "worktree
		",
		    "before": "index
		",
		    "kind": "text",
		  },
		  "unstagedFiles": [
		    {
		      "addedLines": 1,
		      "deletedLines": 1,
		      "path": "file.txt",
		      "status": "modified",
		    },
		  ],
		}
	`);
	assert.deepEqual(readFileSync(join(cwd, ".git/index")), index);
	writeFileSync(join(cwd, "file.txt"), "changed with the same line count\n");
	await assert.rejects(
		readFileContents(cwd, unstaged.snapshot, "file.txt", signal),
		/Contents changed; refresh/,
	);
	assert.deepEqual(
		await readFileContents(cwd, staged.snapshot, "file.txt", signal),
		{ kind: "text", before: "head\n", after: "index\n" },
	);
	git("add", ".");
	await assert.rejects(
		readFileContents(cwd, staged.snapshot, "file.txt", signal),
		/Contents changed; refresh/,
	);
});

test("unstaged includes non-ignored untracked text, empty, binary and unusual filenames", async () => {
	const { cwd, git, signal } = fixture();
	writeFileSync(join(cwd, ".gitignore"), "ignored/\n");
	writeFileSync(join(cwd, "deleted.txt"), "removed\n");
	git("add", ".");
	git("commit", "-m", "Initial");
	rmSync(join(cwd, "deleted.txt"));
	mkdirSync(join(cwd, "new"));
	mkdirSync(join(cwd, "ignored"));
	writeFileSync(join(cwd, "ignored/secret"), "ignore me\n");
	writeFileSync(join(cwd, "new/empty"), "");
	writeFileSync(join(cwd, "new/binary"), Buffer.from([0, 1, 2]));
	writeFileSync(join(cwd, "new/line\tbreak\n.txt"), "one\ntwo");
	const view = await compare(join(cwd, "new"), { kind: "unstaged" }, signal);
	expect({ diffs: view.diffs, summary: view.summary }).toMatchInlineSnapshot(`
		{
		  "diffs": [
		    {
		      "addedLines": 0,
		      "deletedLines": 1,
		      "path": "deleted.txt",
		      "status": "deleted",
		    },
		    {
		      "addedLines": 0,
		      "deletedLines": 0,
		      "path": "new/binary",
		      "status": "added",
		    },
		    {
		      "addedLines": 0,
		      "deletedLines": 0,
		      "path": "new/empty",
		      "status": "added",
		    },
		    {
		      "addedLines": 2,
		      "deletedLines": 0,
		      "path": "new/line	break
		.txt",
		      "status": "added",
		    },
		  ],
		  "summary": {
		    "added": 2,
		    "deleted": 1,
		    "files": 4,
		  },
		}
	`);
	assert.deepEqual(
		await readFileContents(cwd, view.snapshot, "deleted.txt", signal),
		{ kind: "text", before: "removed\n", after: null },
	);
	assert.deepEqual(
		await readFileContents(cwd, view.snapshot, "new/empty", signal),
		{ kind: "text", before: null, after: "" },
	);
	assert.deepEqual(
		await readFileContents(cwd, view.snapshot, "new/line\tbreak\n.txt", signal),
		{ kind: "text", before: null, after: "one\ntwo" },
	);
	assert.deepEqual(
		await readFileContents(cwd, view.snapshot, "new/binary", signal),
		{
			kind: "unavailable",
			message: "Files containing NUL bytes cannot be displayed or annotated.",
		},
	);
	await assert.rejects(
		readFileContents(cwd, view.snapshot, "ignored/secret", signal),
		/File must belong/,
	);
	await assert.rejects(
		readFileContents(cwd, view.snapshot, "../secret", signal),
		/File must belong/,
	);
	writeFileSync(join(cwd, "new/line\tbreak\n.txt"), "new\ntext");
	await assert.rejects(
		readFileContents(cwd, view.snapshot, "new/line\tbreak\n.txt", signal),
		/Contents changed; refresh/,
	);
});

test("an unborn HEAD supports staged additions and empty comparisons", async () => {
	const { cwd, git, signal } = fixture();
	assert.deepEqual((await compare(cwd, { kind: "staged" }, signal)).summary, {
		files: 0,
		added: 0,
		deleted: 0,
	});
	assert.deepEqual((await compare(cwd, { kind: "unstaged" }, signal)).summary, {
		files: 0,
		added: 0,
		deleted: 0,
	});
	writeFileSync(join(cwd, "first.txt"), "first\n");
	git("add", ".");
	const staged = await compare(cwd, { kind: "staged" }, signal);
	assert.equal(staged.snapshot.before, null);
	assert.deepEqual(
		await readFileContents(cwd, staged.snapshot, "first.txt", signal),
		{ kind: "text", before: null, after: "first\n" },
	);
});

test("staged deletion and mode-only metadata survive without a patch", async () => {
	const { cwd, git, signal } = fixture();
	writeFileSync(join(cwd, "deleted.txt"), "gone\n");
	writeFileSync(join(cwd, "script"), "echo hi\n");
	git("add", ".");
	git("commit", "-m", "Initial");
	rmSync(join(cwd, "deleted.txt"));
	chmodSync(join(cwd, "script"), 0o755);
	git("add", ".");
	const view = await compare(cwd, { kind: "staged" }, signal);
	assert.deepEqual(view.diffs, [
		{ path: "deleted.txt", status: "deleted", addedLines: 0, deletedLines: 1 },
		{ path: "script", status: "modified", addedLines: 0, deletedLines: 0 },
	]);
	assert.deepEqual(
		await readFileContents(cwd, view.snapshot, "deleted.txt", signal),
		{ kind: "text", before: "gone\n", after: null },
	);
});

test("symlinks display their stored target without reading outside the repository", async () => {
	const { cwd, signal } = fixture();
	const outside = mkdtempSync(join(tmpdir(), "dsh-diff-outside-"));
	directories.push(outside);
	const secret = join(outside, "secret");
	writeFileSync(secret, "must not be read");
	symlinkSync(secret, join(cwd, "link"));
	const view = await compare(cwd, { kind: "unstaged" }, signal);
	assert.deepEqual(await readFileContents(cwd, view.snapshot, "link", signal), {
		kind: "text",
		before: null,
		after: secret,
	});
	await assert.rejects(
		readFileContents(
			cwd,
			{ ...view.snapshot, repository: outside },
			"link",
			signal,
		),
		/another repository/,
	);
});

test("unresolved index conflicts produce an explicit error", async () => {
	const { cwd, git, signal } = fixture();
	writeFileSync(join(cwd, "conflict.txt"), "base\n");
	git("add", ".");
	git("commit", "-m", "Base");
	git("switch", "-c", "side");
	writeFileSync(join(cwd, "conflict.txt"), "side\n");
	git("commit", "-am", "Side");
	git("switch", "trunk");
	writeFileSync(join(cwd, "conflict.txt"), "trunk\n");
	git("commit", "-am", "Trunk");
	assert.throws(() => git("merge", "side"));
	await assert.rejects(
		compare(cwd, { kind: "staged" }, signal),
		/Unresolved index conflicts/,
	);
	await assert.rejects(
		compare(cwd, { kind: "unstaged" }, signal),
		/Unresolved index conflicts/,
	);
});

test("stat-only changes are excluded without refreshing the index", async () => {
	const { cwd, git, signal } = fixture();
	const path = join(cwd, "unchanged.txt");
	writeFileSync(path, "same contents\n");
	git("add", ".");
	git("commit", "-m", "Initial");
	const future = new Date(Date.now() + 5000);
	utimesSync(path, future, future);
	const index = readFileSync(join(cwd, ".git/index"));
	assert.deepEqual(
		(await compare(cwd, { kind: "unstaged" }, signal)).diffs,
		[],
	);
	assert.deepEqual(readFileSync(join(cwd, ".git/index")), index);
});
