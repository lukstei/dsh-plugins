import type { Context } from "@deepseek-ai/cordis";
import type {
	SessionPersistenceListOptions,
	SessionPersistenceSnapshot,
} from "@deepseek-ai/dsh-session-persistence";

export const name = "resilient-session-persistence";
export const inject = ["sessionPersistence"];

const WRAPPED_SYMBOL = Symbol.for("dsh.resilientSessionPersistence.wrapped");

type WrappedPersistence = Context["sessionPersistence"] & {
	[WRAPPED_SYMBOL]?: boolean;
};

export function apply(ctx: Context): void {
	const persistence = ctx.sessionPersistence;
	// type-safe: persistence service instance requires local symbol tracking for idempotent wrapping
	const wrapped = persistence as WrappedPersistence;
	if (wrapped[WRAPPED_SYMBOL]) return;
	wrapped[WRAPPED_SYMBOL] = true;

	const origList = persistence.list;
	const origOpen = persistence.open.bind(persistence);

	// Cache verified session revisions: key = `${sessionId}:${revision}`
	const verifiedRevisions = new Map<string, boolean>();

	ctx.effect(() => {
		persistence.list = async (
			options?: SessionPersistenceListOptions,
		): Promise<readonly SessionPersistenceSnapshot[]> => {
			const snapshots = await origList.call(persistence, options);
			const valid: SessionPersistenceSnapshot[] = [];
			const pending: SessionPersistenceSnapshot[] = [];

			for (const snapshot of snapshots) {
				const key = `${snapshot.header.id}:${snapshot.revision}`;
				const status = verifiedRevisions.get(key);
				if (status === true) {
					valid.push(snapshot);
				} else if (status === false) {
				} else {
					pending.push(snapshot);
				}
			}

			if (pending.length > 0) {
				const BATCH_SIZE = 16;
				for (let i = 0; i < pending.length; i += BATCH_SIZE) {
					const chunk = pending.slice(i, i + BATCH_SIZE);
					await Promise.all(
						chunk.map(async (snapshot) => {
							const key = `${snapshot.header.id}:${snapshot.revision}`;
							try {
								const handle = await origOpen(
									snapshot.header.id,
									"read",
									options,
								);
								await handle.close();
								verifiedRevisions.set(key, true);
								valid.push(snapshot);
							} catch (error: unknown) {
								verifiedRevisions.set(key, false);
								const message =
									error instanceof Error ? error.message : String(error);
								ctx.logger.warn(
									`[resilient-persistence] Corrupt session "${snapshot.header.id}" omitted: ${message}`,
								);
							}
						}),
					);
				}
			}

			return valid;
		};

		return () => {
			persistence.list = origList;
			delete wrapped[WRAPPED_SYMBOL];
		};
	});
}
