/**
 * PURPOSE: Pure boolean parsing, template interpolation, and gate resolution helper functions.
 * ALLOWED: Pure computation, string parsing, template interpolation.
 * FORBIDDEN: No I/O, no framework dependencies, no side effects.
 */

/**
 * Converts a boolean, string, or unknown value into a strict boolean (true/false) or undefined if not a boolean representation.
 * CONTRACT:
 * - Input: unknown value (boolean, string, undefined, null, etc.).
 * - Output: boolean true for true / "true" (case-insensitive), false for false / "false" (case-insensitive), undefined otherwise.
 */
export function parseBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const trimmed = value.trim().toLowerCase();
		if (trimmed === "true") return true;
		if (trimmed === "false") return false;
	}
	return undefined;
}

/**
 * Interpolates {{args.<name>}} and {{outputs.<name>}} template variables in a text string.
 * CONTRACT:
 * - Input: raw template string, args map, and optional outputs map.
 * - Output: string with all {{args.*}} and {{outputs.*}} variables replaced.
 * - Throws: Error if an {{args.*}} variable is unresolvable.
 */
export function interpolateTemplate(
	template: string,
	args: Record<string, string>,
	outputs?: Record<string, string | readonly string[]>,
	context?: { readonly item?: string },
): string {
	let result = template.replace(
		/\{\{args\.([a-zA-Z0-9_-]+)\}\}/g,
		(_match, key: string) => {
			const value = args[key];
			if (value === undefined) {
				throw new Error(`Unresolved workflow argument: {{args.${key}}}`);
			}
			return value;
		},
	);
	if (context?.item !== undefined) {
		result = result.replace(/\{\{item\}\}/g, context.item);
	}
	if (outputs !== undefined) {
		result = result.replace(
			/\{\{outputs\.([a-zA-Z0-9_-]+)\}\}/g,
			(_match, key: string) => {
				const val = outputs[key];
				if (val === undefined) return String(val);
				if (Array.isArray(val)) {
					if (val.length === 0) return "";
					return val.map((item) => `- ${item}`).join("\n");
				}
				return String(val);
			},
		);
	}
	return result;
}

/**
 * Resolves a step gate declaration (boolean, templated string, or explicit description) into an active gate criteria string, or undefined if inactive.
 * CONTRACT:
 * - Input: gate (string | boolean | undefined), args map, optional outputs map, optional fallback stepName.
 * - Output: resolved gate description string if active, or undefined if inactive (false, "false", empty, or undefined).
 */
export function resolveGate(
	gate: string | boolean | undefined,
	args: Record<string, string> = {},
	outputs?: Record<string, string | readonly string[]>,
	stepName?: string,
): string | undefined {
	if (gate === undefined) {
		return undefined;
	}
	if (typeof gate === "boolean") {
		return gate ? stepName || "Gate" : undefined;
	}
	const interpolated = interpolateTemplate(gate, args, outputs).trim();
	if (interpolated === "") {
		return undefined;
	}
	const interpolatedBool = parseBoolean(interpolated);
	if (interpolatedBool === false) {
		return undefined;
	}
	if (interpolatedBool === true) {
		return stepName || "Gate";
	}
	return interpolated;
}
