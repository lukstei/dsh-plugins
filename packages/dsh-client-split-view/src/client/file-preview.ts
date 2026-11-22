/**
 * Purpose: Classify a workspace file path for the split pane's inline preview.
 * Contract:
 * - Inputs: one workspace file path in POSIX or Windows spelling.
 * - Outputs: preview kind and displayable image MIME type.
 * - Errors: never throws; unknown extensions classify as plain text.
 */

const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set([
	"md",
	"markdown",
	"mdx",
]);

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	bmp: "image/bmp",
	svg: "image/svg+xml",
};

/**
 * Purpose: Read the lowercased extension from a path's final segment.
 * Contract:
 * - Inputs: one POSIX or Windows path.
 * - Outputs: extension without the dot; empty for dotfiles, bare names, and trailing separators.
 * - Errors: never throws.
 * @internal
 */
export function extensionOf(path: string): string {
	const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	const name = path.slice(separator + 1);
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Purpose: Map one path to a displayable image MIME type.
 * Contract:
 * - Inputs: one POSIX or Windows path.
 * - Outputs: the MIME type for known image extensions, otherwise `undefined`.
 * - Errors: never throws.
 */
export function imageMimeTypeOf(path: string): string | undefined {
	return IMAGE_MIME_TYPES[extensionOf(path)];
}

/** How the pane previews one file: rendered Markdown, an image, or plain text. */
export type PreviewKind = "markdown" | "image" | "text";

/**
 * Purpose: Classify one path into the pane preview strategy.
 * Contract:
 * - Inputs: one POSIX or Windows path.
 * - Outputs: `markdown` for Markdown documents, `image` for displayable images, otherwise `text`.
 * - Errors: never throws.
 */
export function previewKindOf(path: string): PreviewKind {
	const extension = extensionOf(path);
	if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
	if (IMAGE_MIME_TYPES[extension] !== undefined) return "image";
	return "text";
}
