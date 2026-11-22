import assert from "node:assert/strict";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkspaceTypertGenerator } from "@deepseek-ai/dsh-typert-generator";
import { z } from "zod";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = z
	.object({
		name: z.string(),
		exports: z.record(z.string(), z.unknown()),
		files: z.array(z.string()),
	})
	.parse(JSON.parse(readFileSync(join(root, "package.json"), "utf8")));
// smell: Typert requires a packages/ workspace; stage the host closure until it supports standalone packages.
const stage = mkdtempSync(join(tmpdir(), "dsh-git-diff-typert-"));
const options = {
	target: "ES2024",
	module: "NodeNext",
	moduleResolution: "NodeNext",
	strict: true,
	skipLibCheck: true,
	allowImportingTsExtensions: true,
	noEmit: true,
	types: ["node"],
};
function json(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value));
}

try {
	symlinkSync(join(root, "node_modules"), join(stage, "node_modules"), "dir");
	const protocol = join(stage, "packages", "protocol");
	const protocolManifest = fileURLToPath(
		import.meta.resolve("@deepseek-ai/dsh-typert-protocol/package.json"),
	);
	const protocolPackage = z
		.object({ types: z.string(), version: z.string() })
		.parse(JSON.parse(readFileSync(protocolManifest, "utf8")));
	cpSync(
		dirname(resolve(dirname(protocolManifest), protocolPackage.types)),
		join(protocol, "src"),
		{ recursive: true },
	);
	// Analyze the required base class without publishing the protocol's unrelated merged registries.
	writeFileSync(
		join(protocol, "src", "public.ts"),
		'export type { TypertRemoteService } from "./index.d.ts";\n',
	);
	json(join(protocol, "package.json"), {
		name: "@deepseek-ai/dsh-typert-protocol",
		version: protocolPackage.version,
		type: "module",
		exports: { ".": "./src/public.ts" },
	});
	json(join(protocol, "tsconfig.json"), {
		compilerOptions: options,
		include: ["src"],
	});
	const shared = join(stage, "packages", "review-ui");
	mkdirSync(join(shared, "src"), { recursive: true });
	cpSync(
		join(root, "../util-review-ui/src/types.ts"),
		join(shared, "src/types.ts"),
	);
	cpSync(
		join(root, "../util-review-ui/src/review.ts"),
		join(shared, "src/review.ts"),
	);
	json(join(shared, "package.json"), {
		name: "@lukstei/util-review-ui",
		version: "0.1.0",
		type: "module",
		exports: { "./types": "./src/types.ts", "./review": "./src/review.ts" },
	});
	json(join(shared, "tsconfig.json"), {
		compilerOptions: options,
		include: ["src"],
	});
	const pkg = join(stage, "packages", "git-diff");
	json(join(pkg, "package.json"), {
		...manifest,
		type: "module",
		exports: {
			".": "./src/index.ts",
			"./typert": manifest.exports["./typert"],
			"./remote": manifest.exports["./remote"],
		},
	});
	json(join(pkg, "tsconfig.json"), {
		compilerOptions: {
			...options,
			paths: {
				"@deepseek-ai/dsh-typert-protocol": ["../protocol/src/index.d.ts"],
				"@lukstei/util-review-ui/types": ["../review-ui/src/types.ts"],
				"@lukstei/util-review-ui/review": ["../review-ui/src/review.ts"],
			},
		},
		include: ["src"],
	});
	mkdirSync(join(pkg, "src"), { recursive: true });
	for (const file of ["workspace-review-service.ts", "git-service.ts"]) {
		cpSync(join(root, "src", file), join(pkg, "src", file));
	}
	writeFileSync(
		join(pkg, "src", "index.ts"),
		'export { WorkspaceReviewService } from "./workspace-review-service.ts";\n',
	);
	json(join(stage, "tsconfig.host.json"), {
		compilerOptions: {
			...options,
			paths: {
				"@deepseek-ai/dsh-typert-protocol": [
					"packages/protocol/src/index.d.ts",
				],
				"@lukstei/util-review-ui/types": ["packages/review-ui/src/types.ts"],
				"@lukstei/util-review-ui/review": ["packages/review-ui/src/review.ts"],
			},
		},
		files: [],
		references: [
			{ path: "packages/git-diff" },
			{ path: "packages/protocol" },
			{ path: "packages/review-ui" },
		],
	});
	const artifacts = new WorkspaceTypertGenerator(stage).generate(
		[manifest.name],
		["host"],
	);
	const artifact = artifacts.find(
		(entry) => entry.package === manifest.name && entry.face === "host",
	);
	assert(artifact, "Expected host artifact");
	assert(artifact.remote, "Expected Remote artifact");
	mkdirSync(join(root, "lib"), { recursive: true });
	for (const [file, content] of Object.entries({
		"typert.host.js": artifact.js,
		"typert.host.d.ts": artifact.dts,
		"typert.remote-client.js": artifact.remote.js,
		"typert.remote-client.d.ts": artifact.remote.dts,
		"typert.remote-client.d.ts.map": artifact.remote.dtsMap,
	}))
		writeFileSync(join(root, "lib", file), content);
} finally {
	rmSync(stage, { recursive: true, force: true });
}
