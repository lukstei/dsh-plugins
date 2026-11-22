import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { useEffect, useState } from "react";

export function useLoad<T>(
	load: (signal: AbortSignal) => Promise<RemoteResult<T>>,
):
	| { status: "loading" }
	| { status: "failed"; message: string }
	| { status: "ready"; value: T } {
	const [result, setResult] = useState<
		| { status: "loading" }
		| { status: "failed"; message: string }
		| { status: "ready"; value: T }
	>({ status: "loading" });
	useEffect(() => {
		const controller = new AbortController();
		setResult({ status: "loading" });
		load(controller.signal).then(
			(result) => {
				if (!controller.signal.aborted)
					setResult(
						result.ok
							? { status: "ready", value: result.value }
							: { status: "failed", message: result.error.message },
					);
			},
			(error: unknown) => {
				if (!controller.signal.aborted)
					setResult({
						status: "failed",
						message: error instanceof Error ? error.message : String(error),
					});
			},
		);
		return () => controller.abort();
	}, [load]);
	return result;
}
