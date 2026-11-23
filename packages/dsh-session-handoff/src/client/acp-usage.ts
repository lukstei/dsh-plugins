/** Context occupancy an ACP agent reported, as the adapter exposes it. */
export interface AcpUsage {
	readonly used: number;
	readonly size: number;
}

export type AcpUsageReader = (
	sessionId: string,
) => Promise<AcpUsage | undefined>;

// smell: module-level seat; the optional ACP scope in `index.ts` fills it, so the ring needs no
// hard dependency on the adapter.
let reader: AcpUsageReader | undefined;
const listeners = new Set<() => void>();

export function setAcpUsageReader(next: AcpUsageReader | undefined): void {
	reader = next;
	for (const listener of listeners) listener();
}

/** `useSyncExternalStore` seat, so a ring mounted before the adapter re-reads once it arrives. */
export function subscribeAcpUsageReader(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function currentAcpUsageReader(): AcpUsageReader | undefined {
	return reader;
}
