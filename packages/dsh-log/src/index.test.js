import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test, { mock } from "node:test";
import {
	apply,
	createFileWriter,
	expandHome,
	formatMessage,
	name,
} from "./index.ts";

test("log plugin metadata", () => {
	assert.equal(name, "file-log");
});

test("formatMessage formats timestamp, level, name and variadic arguments", () => {
	assert.equal(
		formatMessage({
			ts: 1775808000000,
			type: "warn",
			level: 2,
			name: "test-logger",
			args: ["Value is %d for %s", 42, "item"],
		}),
		"2026-04-10T08:00:00.000Z [WARN ] [test-logger] Value is 42 for item\n",
	);
});

test("apply registers one exporter per output and routes by levels", (t) => {
	const tmpDir = mkdtempSync(path.join(tmpdir(), "log-test-"));
	const auditFile = path.join(tmpDir, "nested", "audit.log");
	const stdout = t.mock.method(process.stdout, "write", () => true);
	const exporters = [];
	const ctx = { logger: { exporter: (e) => exporters.push(e) } };

	try {
		apply(ctx, {
			outputs: [
				{ target: "stdout", levels: { default: 2, audit: -1 } },
				{
					target: "file",
					filePath: auditFile,
					levels: { default: -1, audit: 2 },
				},
			],
		});
		assert.deepEqual(
			exporters.map((e) => e.levels),
			[
				{ default: 2, audit: -1 },
				{ default: -1, audit: 2 },
			],
		);

		const message = (loggerName) => ({
			ts: 1775808000000,
			type: "info",
			level: 2,
			name: loggerName,
			args: ["hello"],
		});
		// Cordis applies exporter.levels before export(); mimic that filter here.
		const dispatch = (m) => {
			for (const e of exporters) {
				const target = e.levels[m.name] ?? e.levels.default;
				if (target >= m.level) e.export(m);
			}
		};
		dispatch(message("core"));
		dispatch(message("audit"));

		assert.deepEqual(
			stdout.mock.calls.map((c) => c.arguments[0]),
			["2026-04-10T08:00:00.000Z [INFO ] [core] hello\n"],
		);
		assert.equal(
			readFileSync(auditFile, "utf8"),
			"2026-04-10T08:00:00.000Z [INFO ] [audit] hello\n",
		);
	} finally {
		mock.restoreAll();
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("createFileWriter creates directory and appends to file", () => {
	const tmpDir = mkdtempSync(path.join(tmpdir(), "log-test-"));
	const logFile = path.join(tmpDir, "nested", "test-log.txt");

	try {
		const writer = createFileWriter(logFile);
		writer("first line\n");
		writer("second line\n");
		assert.equal(readFileSync(logFile, "utf8"), "first line\nsecond line\n");
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("expandHome expands a leading ~ only", () => {
	assert.equal(expandHome("~/a/b.log"), path.join(homedir(), "a/b.log"));
	assert.equal(expandHome("~"), homedir());
	assert.equal(expandHome("/x/~/y"), "/x/~/y");
	assert.equal(expandHome("~user/y"), "~user/y");
});
