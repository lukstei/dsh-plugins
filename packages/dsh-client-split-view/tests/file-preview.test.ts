import { describe, expect, it } from "vitest";
import {
	extensionOf,
	imageMimeTypeOf,
	previewKindOf,
} from "../src/client/file-preview.ts";

describe("file preview classification", () => {
	it("reads the extension from POSIX and Windows paths", () => {
		expect(extensionOf("docs/README.md")).toBe("md");
		expect(extensionOf("C:\\notes\\Plan.Markdown")).toBe("markdown");
		expect(extensionOf("archive.tar.gz")).toBe("gz");
	});

	it("has no extension for dotfiles and bare names", () => {
		expect(extensionOf(".gitignore")).toBe("");
		expect(extensionOf("Makefile")).toBe("");
		expect(extensionOf("src/client/")).toBe("");
	});

	it("maps displayable image extensions to MIME types", () => {
		expect(imageMimeTypeOf("assets/logo.png")).toBe("image/png");
		expect(imageMimeTypeOf("assets/photo.JPEG")).toBe("image/jpeg");
		expect(imageMimeTypeOf("assets/icon.svg")).toBe("image/svg+xml");
		expect(imageMimeTypeOf("assets/readme.md")).toBeUndefined();
	});

	it("classifies Markdown, images, and everything else", () => {
		expect(previewKindOf("docs/guide.md")).toBe("markdown");
		expect(previewKindOf("docs/guide.markdown")).toBe("markdown");
		expect(previewKindOf("docs/guide.mdx")).toBe("markdown");
		expect(previewKindOf("assets/screenshot.webp")).toBe("image");
		expect(previewKindOf("src/index.ts")).toBe("text");
		expect(previewKindOf("Makefile")).toBe("text");
	});
});
