import { expect, test } from "vitest";
import { createUnifiedDiff } from "./diff.ts";

test("createUnifiedDiff: creates diff for added file", () => {
	const diff = createUnifiedDiff("test.txt", null, "line 1\nline 2");
	expect(diff).toContain("--- /dev/null");
	expect(diff).toContain("+++ b/test.txt");
	expect(diff).toContain("+line 1");
	expect(diff).toContain("+line 2");
});

test("createUnifiedDiff: creates diff for deleted file", () => {
	const diff = createUnifiedDiff("test.txt", "line 1\nline 2", null);
	expect(diff).toContain("--- a/test.txt");
	expect(diff).toContain("+++ /dev/null");
	expect(diff).toContain("-line 1");
	expect(diff).toContain("-line 2");
});

test("createUnifiedDiff: creates diff for modified file with context", () => {
	const before = "1\n2\n3\n4\n5";
	const after = "1\n2\nchanged\n4\n5";
	const diff = createUnifiedDiff("test.txt", before, after);
	expect(diff).toContain("--- a/test.txt");
	expect(diff).toContain("+++ b/test.txt");
	expect(diff).toContain("-3");
	expect(diff).toContain("+changed");
	expect(diff).toContain(" 1");
	expect(diff).toContain(" 5");
});

test("createUnifiedDiff: returns empty string for identical content", () => {
	const diff = createUnifiedDiff("test.txt", "same", "same");
	expect(diff).toBe("");
});
