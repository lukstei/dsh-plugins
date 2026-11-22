import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { useEffect, useRef, useState } from "react";

export type LazyFileResult<T> =
	| { status: "idle"; value: null }
	| { status: "loading"; value: T | null }
	| { status: "failed"; value: T | null; message: string }
	| { status: "ready"; value: T };

export function useLazyFile<T>(
	load: (signal: AbortSignal) => Promise<RemoteResult<T>>,
	expanded: boolean,
) {
	const [attempt, setAttempt] = useState(0);
	const [result, setResult] = useState<LazyFileResult<T>>({
		status: "idle",
		value: null,
	});
	const request = useRef<{
		load: typeof load;
		attempt: number;
		controller: AbortController;
	} | null>(null);
	useEffect(() => {
		if (request.current !== null && request.current.load !== load)
			request.current.controller.abort();
		if (!expanded) return;
		if (
			request.current !== null &&
			request.current.load === load &&
			request.current.attempt === attempt &&
			!request.current.controller.signal.aborted
		)
			return;
		if (request.current !== null) request.current.controller.abort();
		const controller = new AbortController();
		request.current = { load, attempt, controller };
		setResult((previous) => ({ status: "loading", value: previous.value }));
		load(controller.signal).then(
			(result) => {
				if (controller.signal.aborted) return;
				if (result.ok) setResult({ status: "ready", value: result.value });
				else
					setResult((previous) => ({
						status: "failed",
						value: previous.value,
						message: result.error.message,
					}));
			},
			(error: unknown) => {
				if (!controller.signal.aborted)
					setResult((previous) => ({
						status: "failed",
						value: previous.value,
						message: error instanceof Error ? error.message : String(error),
					}));
			},
		);
	}, [expanded, load, attempt]);
	useEffect(
		() => () => {
			if (request.current !== null) request.current.controller.abort();
		},
		[],
	);
	const retry = () => setAttempt((value) => value + 1);
	return { result, retry };
}
