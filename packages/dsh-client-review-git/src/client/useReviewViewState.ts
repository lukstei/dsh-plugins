import type { ReviewScope } from "@lukstei/util-review-ui/types";
import { useCallback, useEffect, useRef, useState } from "react";

/** @internal */
export const REVIEW_STORAGE_PREFIX = "dsh-client-review-git:state:v1:";
/** @internal */
export const REVIEW_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface GitReviewViewState {
	version: 1;
	selectedRepoCwd: string | null;
	scope: ReviewScope | null;
	expandedPaths: string[];
	scrollTop: number;
	wrapped: boolean;
	updatedAt: number;
}

function isReviewScope(val: unknown): val is ReviewScope {
	if (!val || typeof val !== "object") return false;
	const obj = val as Record<string, unknown>;
	if (typeof obj.repository !== "string") return false;
	if (obj.kind === "uncommitted") {
		return obj.stage === "staged" || obj.stage === "unstaged";
	}
	if (obj.kind === "branch") {
		return (
			typeof obj.ref === "string" && Boolean(obj.base) && Boolean(obj.revision)
		);
	}
	return false;
}

/** @internal */
export function readPersistedReviewState(
	sessionId: string,
): GitReviewViewState | null {
	if (typeof localStorage === "undefined") return null;
	try {
		const raw = localStorage.getItem(`${REVIEW_STORAGE_PREFIX}${sessionId}`);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<GitReviewViewState>;
		if (parsed.version !== 1) return null;
		if (
			typeof parsed.updatedAt !== "number" ||
			!Number.isFinite(parsed.updatedAt) ||
			Date.now() - parsed.updatedAt > REVIEW_TTL_MS
		) {
			localStorage.removeItem(`${REVIEW_STORAGE_PREFIX}${sessionId}`);
			return null;
		}
		return {
			version: 1,
			selectedRepoCwd:
				typeof parsed.selectedRepoCwd === "string"
					? parsed.selectedRepoCwd
					: null,
			scope: isReviewScope(parsed.scope) ? parsed.scope : null,
			expandedPaths: Array.isArray(parsed.expandedPaths)
				? parsed.expandedPaths.filter((p): p is string => typeof p === "string")
				: [],
			scrollTop: typeof parsed.scrollTop === "number" ? parsed.scrollTop : 0,
			wrapped: Boolean(parsed.wrapped),
			updatedAt: parsed.updatedAt,
		};
	} catch {
		return null;
	}
}

/** @internal */
export function writePersistedReviewState(
	sessionId: string,
	state: {
		selectedRepoCwd: string | null;
		scope: ReviewScope | null;
		expandedPaths: string[];
		scrollTop: number;
		wrapped: boolean;
	},
): void {
	if (typeof localStorage === "undefined") return;
	try {
		const payload: GitReviewViewState = {
			version: 1,
			selectedRepoCwd: state.selectedRepoCwd,
			scope: state.scope,
			expandedPaths: state.expandedPaths,
			scrollTop: state.scrollTop,
			wrapped: state.wrapped,
			updatedAt: Date.now(),
		};
		localStorage.setItem(
			`${REVIEW_STORAGE_PREFIX}${sessionId}`,
			JSON.stringify(payload),
		);
	} catch {
		// defensive storage isolation
	}
}

export function useReviewViewState(
	sessionId: string,
	initialScope?: ReviewScope,
) {
	const [initialState] = useState(() => readPersistedReviewState(sessionId));

	const isScopeOverridden =
		initialScope !== undefined &&
		initialState?.scope !== null &&
		initialState?.scope !== undefined &&
		(initialState.scope.kind !== initialScope.kind ||
			initialState.scope.repository !== initialScope.repository ||
			(initialState.scope.kind === "branch" &&
				initialScope.kind === "branch" &&
				initialState.scope.ref !== initialScope.ref));

	const [selectedRepoCwd, setSelectedRepoCwd] = useState<string | null>(() =>
		initialScope !== undefined
			? initialScope.repository
			: (initialState?.selectedRepoCwd ?? null),
	);
	const [scope, setScope] = useState<ReviewScope | null>(
		() => initialScope ?? initialState?.scope ?? null,
	);
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
		isScopeOverridden ? new Set() : new Set(initialState?.expandedPaths ?? []),
	);
	const [wrapped, setWrapped] = useState<boolean>(
		() => initialState?.wrapped ?? false,
	);
	const scrollTopRef = useRef<number>(
		isScopeOverridden ? 0 : (initialState?.scrollTop ?? 0),
	);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isFirstMountRef = useRef(true);

	const stateRef = useRef({
		selectedRepoCwd,
		scope,
		expandedPaths,
		scrollTop: scrollTopRef.current,
		wrapped,
	});
	stateRef.current = {
		selectedRepoCwd,
		scope,
		expandedPaths,
		scrollTop: scrollTopRef.current,
		wrapped,
	};

	const persist = useCallback(() => {
		writePersistedReviewState(sessionId, {
			selectedRepoCwd: stateRef.current.selectedRepoCwd,
			scope: stateRef.current.scope,
			expandedPaths: Array.from(stateRef.current.expandedPaths),
			scrollTop: stateRef.current.scrollTop,
			wrapped: stateRef.current.wrapped,
		});
	}, [sessionId]);

	const debouncedPersist = useCallback(() => {
		if (debounceTimerRef.current !== null) {
			clearTimeout(debounceTimerRef.current);
		}
		debounceTimerRef.current = setTimeout(() => {
			debounceTimerRef.current = null;
			persist();
		}, 100);
	}, [persist]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: state values are re-persist triggers; persist reads them via stateRef
	useEffect(() => {
		if (isFirstMountRef.current) {
			isFirstMountRef.current = false;
			if (!isScopeOverridden) return;
		}
		persist();
	}, [
		selectedRepoCwd,
		scope,
		expandedPaths,
		wrapped,
		persist,
		isScopeOverridden,
	]);

	useEffect(() => {
		return () => {
			if (debounceTimerRef.current !== null) {
				clearTimeout(debounceTimerRef.current);
				persist();
			}
		};
	}, [persist]);

	const isPathExpanded = useCallback(
		(path: string): boolean => {
			return expandedPaths.has(path);
		},
		[expandedPaths],
	);

	const togglePathExpanded = useCallback((path: string, expand?: boolean) => {
		setExpandedPaths((prev) => {
			const next = new Set(prev);
			const shouldExpand = expand ?? !next.has(path);
			if (shouldExpand) {
				next.add(path);
			} else {
				next.delete(path);
			}
			return next;
		});
	}, []);

	const setScrollTop = useCallback(
		(top: number) => {
			scrollTopRef.current = top;
			debouncedPersist();
		},
		[debouncedPersist],
	);

	const toggleWrapped = useCallback(() => {
		setWrapped((w) => !w);
	}, []);

	return {
		selectedRepoCwd,
		setSelectedRepoCwd,
		scope,
		setScope,
		expandedPaths,
		isPathExpanded,
		setPathExpanded: togglePathExpanded,
		togglePathExpanded,
		scrollTop: scrollTopRef.current,
		setScrollTop,
		wrapped,
		toggleWrapped,
	};
}
