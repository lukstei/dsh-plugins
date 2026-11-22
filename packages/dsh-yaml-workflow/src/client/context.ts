/**
 * PURPOSE: React Context container and hook for Cordis ClientContext injection.
 * ALLOWED: createContext, useContext.
 * FORBIDDEN: State manipulation, UI rendering.
 */

import type { Context as CordisContext } from "@deepseek-ai/cordis";
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import { createContext, useContext } from "react";

export type WorkflowClientContext = Omit<CordisContext, "sessions"> & {
	readonly sessions: ISessions;
};

export const WorkflowClientContext =
	createContext<WorkflowClientContext | null>(null);

/**
 * Accesses the Cordis ClientContext from the nearest WorkflowClientContext provider.
 * CONTRACT:
 * - Output: WorkflowClientContext.
 * - Throws: Error if accessed outside WorkflowClientContext.Provider.
 */
export function useWorkflowClientContext(): WorkflowClientContext {
	const ctx = useContext(WorkflowClientContext);
	if (!ctx) {
		throw new Error("WorkflowClientContext must be provided");
	}
	return ctx;
}
