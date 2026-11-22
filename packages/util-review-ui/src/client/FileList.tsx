import {
	Button,
	IconChevronDownOutlineRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { GitFileDiff, GitReviewComment } from "../types.ts";
import styles from "./GitDiffPane.module.css";

type Entry = { kind: "diff" } & GitFileDiff;

export function FileList(props: {
	files: Entry[];
	target?: GitReviewComment | null;
	label: string;
	isExpanded?: (path: string) => boolean;
	onToggleExpanded?: (path: string, expanded: boolean) => void;
	initialScrollTop?: number;
	onScroll?: (scrollTop: number) => void;
	renderFile: (
		file: Entry,
		heading: ReactNode,
		expanded: boolean,
		contentId: string,
	) => ReactNode;
}): ReactNode {
	const navRef = useRef<HTMLElement>(null);
	const initialScrollRestored = useRef(false);

	useEffect(() => {
		const nav = navRef.current;
		if (!nav) return;
		const container = nav.closest<HTMLElement>(`.${styles.fileTreeScroll}`);
		if (!container) return;

		if (
			!initialScrollRestored.current &&
			typeof props.initialScrollTop === "number" &&
			props.initialScrollTop > 0
		) {
			const targetTop = props.initialScrollTop;
			container.scrollTop = targetTop;
			requestAnimationFrame(() => {
				if (container.scrollTop !== targetTop) {
					container.scrollTop = targetTop;
				}
			});
			initialScrollRestored.current = true;
		}

		if (!props.onScroll) return;

		let rAF: number | null = null;
		const handleScroll = () => {
			if (rAF !== null) cancelAnimationFrame(rAF);
			rAF = requestAnimationFrame(() => {
				props.onScroll?.(container.scrollTop);
				rAF = null;
			});
		};

		container.addEventListener("scroll", handleScroll, { passive: true });
		return () => {
			if (rAF !== null) cancelAnimationFrame(rAF);
			container.removeEventListener("scroll", handleScroll);
		};
	}, [props.initialScrollTop, props.onScroll]);

	return (
		<div className={styles.fileTreeScroll}>
			<nav ref={navRef} aria-label={props.label}>
				<FileTree
					{...props}
					target={props.target ?? null}
					directory=""
					depth={0}
					visible={true}
				/>
			</nav>
		</div>
	);
}

function FileTree(
	props: Parameters<typeof FileList>[0] & {
		directory: string;
		depth: number;
		visible: boolean;
	},
): ReactNode {
	const entries = Map.groupBy(
		props.files,
		(file) => file.path.slice(props.directory.length).split("/")[0],
	);
	return (
		<ul className={styles.fileTree}>
			{[...entries].map(([name, children]) => {
				const path = props.directory + name;
				const file = children.find((child) => child.path === path);
				const descendants = children.filter((child) => child.path !== path);
				return (
					<li key={path}>
						{file !== undefined && (
							<FileEntry {...props} file={file} name={name} />
						)}
						{descendants.length > 0 &&
							(() => {
								const dir = compactDirectory(name, `${path}/`, descendants);
								return (
									<Directory
										{...props}
										files={descendants}
										directory={dir.directory}
										name={dir.name}
									/>
								);
							})()}
					</li>
				);
			})}
		</ul>
	);
}

function compactDirectory(
	name: string,
	directory: string,
	files: Entry[],
): { name: string; directory: string } {
	let currentName = name;
	let currentDir = directory;
	while (true) {
		let nextSegment: string | null = null;
		let hasDirectFile = false;
		for (const file of files) {
			const relative = file.path.slice(currentDir.length);
			const slashIndex = relative.indexOf("/");
			if (slashIndex === -1) {
				hasDirectFile = true;
				break;
			}
			const segment = relative.slice(0, slashIndex);
			if (nextSegment === null) {
				nextSegment = segment;
			} else if (nextSegment !== segment) {
				nextSegment = null;
				break;
			}
		}
		if (hasDirectFile || nextSegment === null) {
			break;
		}
		currentName = `${currentName}/${nextSegment}`;
		currentDir = `${currentDir}${nextSegment}/`;
	}
	return { name: currentName, directory: currentDir };
}

function Directory(props: Parameters<typeof FileTree>[0] & { name: string }) {
	const [open, setOpen] = useState(true);
	useEffect(() => {
		if (props.target === null || props.target === undefined) return;
		if (props.target.path.startsWith(props.directory)) setOpen(true);
	}, [props.target, props.directory]);
	return (
		<details
			open={open}
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary
				className={styles.directory}
				style={{ paddingInlineStart: 12 + props.depth * 16 }}
				title={props.directory}
				aria-label={`Directory ${props.directory.slice(0, -1)}`}
			>
				{props.name}
			</summary>
			<FileTree
				{...props}
				depth={props.depth + 1}
				visible={props.visible && open}
			/>
		</details>
	);
}

function FileEntry(
	props: Parameters<typeof FileTree>[0] & { file: Entry; name: string },
) {
	const [open, setOpen] = useState(() =>
		props.isExpanded ? props.isExpanded(props.file.path) : false,
	);
	const id = useId();
	const row = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!props.target || props.target.path !== props.file.path) return;
		setOpen(true);
		props.onToggleExpanded?.(props.file.path, true);
		const frame = requestAnimationFrame(() => {
			if (row.current !== null)
				row.current.scrollIntoView({ block: "nearest" });
		});
		return () => cancelAnimationFrame(frame);
	}, [props.target, props.file.path, props.onToggleExpanded]);
	const file = props.file;
	const heading = (
		<Button
			size="sm"
			variant="ghost"
			className={styles.row}
			style={{ paddingInlineStart: 10 + props.depth * 16 }}
			title={file.path}
			aria-label={`${file.path} · ${file.status}`}
			aria-expanded={open}
			aria-controls={`${id}-content`}
			aria-describedby={`${id}-description`}
			onClick={() => {
				const next = !open;
				setOpen(next);
				props.onToggleExpanded?.(props.file.path, next);
			}}
		>
			<IconChevronDownOutlineRegular
				className={open ? styles.disclosureOpen : styles.disclosureClosed}
			/>
			<span className={styles.status} aria-hidden="true">
				{{ added: "A", modified: "M", deleted: "D" }[file.status]}
			</span>
			{file.status === "deleted" ? (
				<del className={styles.filename}>{props.name}</del>
			) : (
				<span className={styles.filename}>{props.name}</span>
			)}
			<span className={styles.lineCounts} aria-hidden="true">
				<span className={styles.added}>+{file.addedLines}</span>
				<span className={styles.deleted}>−{file.deletedLines}</span>
			</span>
			<span id={`${id}-description`} className={styles.visuallyHidden}>
				{`${file.addedLines} additions, ${file.deletedLines} deletions`}
			</span>
		</Button>
	);
	return (
		<div ref={row} className={styles.fileEntry}>
			<div>
				{props.renderFile(
					file,
					heading,
					props.visible && open,
					`${id}-content`,
				)}
			</div>
		</div>
	);
}
