import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { Component, createRef, type ReactNode } from "react";

type ScrollSnapshot = Array<{ element: HTMLElement; top: number }> | null;

// edge case: moving a mounted pane resets its browser scrollport before layout effects run
export class SplitLayout extends Component<
	{ sessionIds: readonly SessionId[]; children: ReactNode },
	Record<string, never>,
	ScrollSnapshot
> {
	private shell = createRef<HTMLDivElement>();

	getSnapshotBeforeUpdate(previous: SplitLayout["props"]): ScrollSnapshot {
		if (
			previous.sessionIds.length !== this.props.sessionIds.length ||
			previous.sessionIds.every(
				(id, index) => id === this.props.sessionIds[index],
			) ||
			!this.shell.current
		)
			return null;
		// edge case: React has mounted the shell ref before this update lifecycle
		return Array.from(
			this.shell.current.querySelectorAll<HTMLElement>(
				"[data-conversation-scroll], .dsh-split-file",
			),
			(element) => ({ element, top: element.scrollTop }),
		);
	}

	componentDidUpdate(
		_previous: SplitLayout["props"],
		_state: Readonly<Record<string, never>>,
		snapshot: ScrollSnapshot,
	): void {
		if (snapshot === null) return;
		for (const { element, top } of snapshot) element.scrollTop = top;
	}

	render() {
		return (
			<div ref={this.shell} className="dsh-split-shell">
				{this.props.children}
			</div>
		);
	}
}
