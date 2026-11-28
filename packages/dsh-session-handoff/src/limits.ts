/** Token bars at which the ring suggests a handoff. */
export interface Bars {
	readonly soft: number;
	readonly strong: number;
}

export interface Limits {
	readonly warm: Bars;
	/** Bars once the prompt cache has expired; lower, since the next turn re-writes the context. */
	readonly cold: Bars;
	/** Idle time after which the provider's prompt cache is considered cold. */
	readonly cacheTtlMs: number;
}

/** Flat, all-optional overrides; unset fields fall through to the next level. */
export interface LimitOverride {
	warmSoft?: number;
	warmStrong?: number;
	coldSoft?: number;
	coldStrong?: number;
	cacheTtlMs?: number;
}

export interface LimitsConfig {
	/** Applies to every model. */
	defaults?: LimitOverride;
	/** Keyed by provider id. */
	providers?: Record<string, LimitOverride>;
	/** Keyed by `provider/model`; wins over the provider entry. */
	models?: Record<string, LimitOverride>;
}

// Absolute prompt sizes, tuned by cost: a fresh session starts near 18k tokens, so a handoff
// pays back sooner the more context a turn re-sends. Anthropic's cache TTL is 5 minutes.
export const BUILTIN_LIMITS: Limits = {
	warm: { soft: 100_000, strong: 150_000 },
	cold: { soft: 70_000, strong: 100_000 },
	cacheTtlMs: 5 * 60_000,
};

/** Precedence: `models["provider/model"]`, then `providers[provider]`, then `defaults`, then the built-ins. */
export function resolveLimits(
	config: LimitsConfig,
	route: { provider: string; model: string } | undefined,
): Limits {
	const layers: (LimitOverride | undefined)[] = [
		config.defaults,
		route === undefined || config.providers === undefined
			? undefined
			: config.providers[route.provider],
		route === undefined || config.models === undefined
			? undefined
			: config.models[`${route.provider}/${route.model}`],
	];
	const pick = <K extends keyof LimitOverride>(
		key: K,
		fallback: number,
	): number => {
		let value = fallback;
		for (const layer of layers) {
			if (layer !== undefined && layer[key] !== undefined) value = layer[key];
		}
		return value;
	};
	return {
		warm: {
			soft: pick("warmSoft", BUILTIN_LIMITS.warm.soft),
			strong: pick("warmStrong", BUILTIN_LIMITS.warm.strong),
		},
		cold: {
			soft: pick("coldSoft", BUILTIN_LIMITS.cold.soft),
			strong: pick("coldStrong", BUILTIN_LIMITS.cold.strong),
		},
		cacheTtlMs: pick("cacheTtlMs", BUILTIN_LIMITS.cacheTtlMs),
	};
}

/** Name of the page global the Host fills with the validated config. */
export const CONFIG_GLOBAL = "__DSH_SESSION_HANDOFF_CONFIG__";
