export interface DiffHunkLine {
	type: " " | "-" | "+";
	line: string;
}

export function createUnifiedDiff(
	path: string,
	before: string | null,
	after: string | null,
): string {
	if (before === null && after === null) return "";
	if (before === null) {
		const lines = (after ?? "").split("\n");
		return [
			`--- /dev/null`,
			`+++ b/${path}`,
			`@@ -0,0 +1,${lines.length} @@`,
			...lines.map((l) => `+${l}`),
		].join("\n");
	}
	if (after === null) {
		const lines = (before ?? "").split("\n");
		return [
			`--- a/${path}`,
			`+++ /dev/null`,
			`@@ -1,${lines.length} +0,0 @@`,
			...lines.map((l) => `-${l}`),
		].join("\n");
	}

	const a = before.split("\n");
	const b = after.split("\n");

	if (before === after) return "";

	// Trim common prefix
	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
		prefix++;
	}

	// Trim common suffix
	let aEnd = a.length - 1;
	let bEnd = b.length - 1;
	while (aEnd >= prefix && bEnd >= prefix && a[aEnd] === b[bEnd]) {
		aEnd--;
		bEnd--;
	}

	const aMid = a.slice(prefix, aEnd + 1);
	const bMid = b.slice(prefix, bEnd + 1);

	let ops: { type: " " | "-" | "+"; line: string }[];

	if (aMid.length * bMid.length > 500000) {
		// Large replacement fallback
		ops = [
			...a.slice(0, prefix).map((l) => ({ type: " " as const, line: l })),
			...aMid.map((l) => ({ type: "-" as const, line: l })),
			...bMid.map((l) => ({ type: "+" as const, line: l })),
			...a.slice(aEnd + 1).map((l) => ({ type: " " as const, line: l })),
		];
	} else {
		const m = aMid.length;
		const n = bMid.length;
		const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
		for (let i = 0; i < m; i++) {
			for (let j = 0; j < n; j++) {
				dp[i + 1][j + 1] =
					aMid[i] === bMid[j]
						? dp[i][j] + 1
						: Math.max(dp[i + 1][j], dp[i][j + 1]);
			}
		}

		let i = m;
		let j = n;
		const midOps: { type: " " | "-" | "+"; line: string }[] = [];
		while (i > 0 || j > 0) {
			if (i > 0 && j > 0 && aMid[i - 1] === bMid[j - 1]) {
				midOps.push({ type: " ", line: aMid[i - 1] });
				i--;
				j--;
			} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
				midOps.push({ type: "+", line: bMid[j - 1] });
				j--;
			} else {
				midOps.push({ type: "-", line: aMid[i - 1] });
				i--;
			}
		}
		midOps.reverse();

		ops = [
			...a.slice(0, prefix).map((l) => ({ type: " " as const, line: l })),
			...midOps,
			...a.slice(aEnd + 1).map((l) => ({ type: " " as const, line: l })),
		];
	}

	const context = 3;
	// Find hunks (regions containing changes with up to 3 lines of context)
	const changeIndices: number[] = [];
	for (let idx = 0; idx < ops.length; idx++) {
		if (ops[idx].type !== " ") changeIndices.push(idx);
	}

	if (changeIndices.length === 0) return "";

	interface HunkRange {
		start: number;
		end: number;
	}

	const ranges: HunkRange[] = [];
	let currentRange: HunkRange = {
		start: Math.max(0, changeIndices[0] - context),
		end: Math.min(ops.length - 1, changeIndices[0] + context),
	};

	for (let k = 1; k < changeIndices.length; k++) {
		const nextChange = changeIndices[k];
		const nextStart = Math.max(0, nextChange - context);
		const nextEnd = Math.min(ops.length - 1, nextChange + context);

		if (nextStart <= currentRange.end + 1) {
			currentRange.end = nextEnd;
		} else {
			ranges.push(currentRange);
			currentRange = { start: nextStart, end: nextEnd };
		}
	}
	ranges.push(currentRange);

	const result: string[] = [`--- a/${path}`, `+++ b/${path}`];

	let oldLineNum = 1;
	let newLineNum = 1;
	let opIdx = 0;

	for (const range of ranges) {
		// Advance line numbers to range.start
		while (opIdx < range.start) {
			if (ops[opIdx].type === "-") oldLineNum++;
			else if (ops[opIdx].type === "+") newLineNum++;
			else {
				oldLineNum++;
				newLineNum++;
			}
			opIdx++;
		}

		const hunkOldStart = oldLineNum;
		const hunkNewStart = newLineNum;
		let hunkOldCount = 0;
		let hunkNewCount = 0;
		const hunkLines: string[] = [];

		while (opIdx <= range.end) {
			const op = ops[opIdx];
			hunkLines.push(`${op.type}${op.line}`);
			if (op.type === "-") {
				oldLineNum++;
				hunkOldCount++;
			} else if (op.type === "+") {
				newLineNum++;
				hunkNewCount++;
			} else {
				oldLineNum++;
				newLineNum++;
				hunkOldCount++;
				hunkNewCount++;
			}
			opIdx++;
		}

		result.push(
			`@@ -${hunkOldStart},${hunkOldCount} +${hunkNewStart},${hunkNewCount} @@`,
		);
		result.push(...hunkLines);
	}

	return result.join("\n");
}
