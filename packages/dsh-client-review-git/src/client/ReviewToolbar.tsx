import {
	Button,
	IconChevronDownOutlineRegular,
	IconRefreshOutlineRegular,
	Menu,
	Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { TypertRemoteNamespace } from "@deepseek-ai/dsh-typert-protocol";
import styles from "@lukstei/util-review-ui/client/GitDiffPane.module.css";
import { formatRelativeTime } from "@lukstei/util-review-ui/client/relativeTime.ts";
import {
	COMMIT_PAGE_SIZE,
	type GitRepository,
	MAX_BRANCH_AGE_MS,
	type ReviewCatalog,
	type ReviewScope,
	type ReviewSelection,
} from "@lukstei/util-review-ui/types";
import { useCallback, useState } from "react";
import { useLoad } from "./useLoad.ts";

export function ReviewToolbar({
	catalog,
	activeRepository,
	onSelectRepository,
	selection,
	base,
	revision,
	select,
	api,
	sessionId,
	refresh,
}: {
	catalog: ReviewCatalog | null;
	activeRepository: GitRepository | null;
	onSelectRepository: (cwd: string) => void;
	selection: ReviewScope | null;
	base: string;
	revision: number;
	select: (selection: ReviewScope) => void;
	api: TypertRemoteNamespace<"workspaceReview">;
	sessionId: string;
	refresh: () => void;
}) {
	const [scopeOpen, setScopeOpen] = useState(false);
	const [repoOpen, setRepoOpen] = useState(false);
	const [baselineOpen, setBaselineOpen] = useState(false);
	const active = activeRepository;
	const allBranches =
		active !== null
			? active.branches.filter((branch) => branch.ref.startsWith("refs/heads/"))
			: [];
	const branches = allBranches.filter(
		(branch) => Date.now() - branch.modifiedAt <= MAX_BRANCH_AGE_MS,
	);
	const options: {
		id: string;
		label: string;
		value: ReviewScope;
		disabled: boolean;
	}[] = [
		...(active !== null
			? [
					...allBranches.map((branch) => ({
						id: branch.ref,
						label: branch.label,
						disabled: false,
						value: {
							kind: "branch" as const,
							repository: active.cwd,
							ref: branch.ref,
							base: { kind: "automatic" as const },
							revision: { kind: "all-commits" as const },
						},
					})),
					{
						id: "staged",
						label: "Staged changes",
						value: {
							kind: "uncommitted" as const,
							repository: active.cwd,
							stage: "staged" as const,
						},
						disabled: false,
					},
					{
						id: "unstaged",
						label: "Unstaged changes",
						value: {
							kind: "uncommitted" as const,
							repository: active.cwd,
							stage: "unstaged" as const,
						},
						disabled: false,
					},
				]
			: []),
	];
	const selectedId =
		selection === null
			? ""
			: selection.kind === "branch"
				? selection.ref
				: selection.stage;
	const selectedOption = options.find((option) => option.id === selectedId);
	const scopeLabel =
		selectedOption === undefined ? "Select scope" : selectedOption.label;
	const selectedBaseline =
		active === null
			? undefined
			: active.baselines.find((item) => item.ref === base);
	const baselineLabel =
		selectedBaseline === undefined ? "Baseline" : selectedBaseline.label;
	const cwd =
		active !== null
			? active.cwd
			: catalog === null
				? "Repository"
				: catalog.kind === "git"
					? catalog.repository.cwd
					: catalog.cwd;
	const nameOf = (path: string) =>
		path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
	const name = nameOf(cwd);
	let context = "";
	if (active !== null) {
		const comparisonBase =
			selection !== null && selection.kind === "branch" ? base : active.target;
		const baseline = active.baselines.find(
			(item) => item.ref === comparisonBase,
		);
		if (baseline !== undefined) context = `vs ${baseline.label}`;
	}
	if (selection !== null && selection.kind === "uncommitted")
		context =
			selection.stage === "staged" ? "HEAD → Index" : "Index → Working tree";

	const isMultiRepo =
		catalog !== null &&
		catalog.kind === "git" &&
		catalog.repositories.length > 1;

	return (
		<div className={styles.header}>
			{isMultiRepo && active !== null ? (
				<Menu
					open={repoOpen}
					onClose={() => setRepoOpen(false)}
					selectedId={active.cwd}
					portal
					compact
					autoFocus
					className={styles.scopePicker}
					anchor={
						<Button
							size="sm"
							variant="ghost"
							className={styles.branchButton}
							aria-label="Repository"
							aria-haspopup="menu"
							aria-expanded={repoOpen}
							title={active.cwd}
							onClick={() => setRepoOpen(!repoOpen)}
						>
							<span className={styles.truncate}>
								{nameOf(active.cwd) === "" ? active.cwd : nameOf(active.cwd)}
							</span>
							<IconChevronDownOutlineRegular className={styles.icon} />
						</Button>
					}
					items={catalog.repositories.map((repo) => ({
						id: repo.cwd,
						label: nameOf(repo.cwd) === "" ? repo.cwd : nameOf(repo.cwd),
					}))}
					onSelect={(id) => {
						onSelectRepository(id);
						setRepoOpen(false);
					}}
				/>
			) : (
				<Tooltip label={cwd} side="bottom" portal>
					<span className={styles.repositoryName}>
						{name === "" ? cwd : name}
					</span>
				</Tooltip>
			)}
			<Menu
				open={scopeOpen}
				onClose={() => setScopeOpen(false)}
				selectedId={selectedId}
				portal
				compact
				autoFocus
				className={`${styles.scopePicker} ${styles.scopeSelector}`}
				anchor={
					<Button
						size="sm"
						variant="ghost"
						className={styles.branchButton}
						aria-label="Scope"
						aria-haspopup="menu"
						aria-expanded={scopeOpen}
						title={scopeLabel}
						onClick={() => setScopeOpen(!scopeOpen)}
					>
						<span className={styles.truncate}>{scopeLabel}</span>
						<IconChevronDownOutlineRegular className={styles.icon} />
					</Button>
				}
				items={[
					{ type: "label", id: "branches-label", text: "Branches" },
					...branches.map((branch) => ({
						id: branch.ref,
						label: (
							<BranchLabel name={branch.label} modifiedAt={branch.modifiedAt} />
						),
					})),
					{ type: "separator", id: "working-divider" },
					{ type: "label", id: "working-label", text: "Working tree" },
					...options
						.filter((item) => item.value.kind === "uncommitted")
						.map(({ id, label, disabled }) => ({ id, label, disabled })),
				]}
				onSelect={(id) => {
					const option = options.find((item) => item.id === id);
					if (option === undefined) throw new Error("Scope must exist");
					select(option.value);
					setScopeOpen(false);
				}}
			/>
			{selection !== null && selection.kind === "branch" && (
				<CommitPicker
					key={`${selection.ref}:${base}`}
					api={api}
					sessionId={sessionId}
					selection={{ ...selection, base }}
					revision={revision}
					selectRevision={(revision) => select({ ...selection, revision })}
				/>
			)}
			{selection !== null &&
				selection.kind === "branch" &&
				active !== null &&
				(selection.base.kind === "manual" || base === "") && (
					<Menu
						open={baselineOpen}
						onClose={() => setBaselineOpen(false)}
						selectedId={base}
						portal
						compact
						autoFocus
						className={styles.scopePicker}
						anchor={
							<Button
								size="sm"
								variant="ghost"
								className={styles.branchButton}
								aria-label="Baseline"
								aria-haspopup="menu"
								aria-expanded={baselineOpen}
								title={baselineLabel}
								onClick={() => setBaselineOpen(!baselineOpen)}
							>
								<span className={styles.truncate}>{baselineLabel}</span>
								<IconChevronDownOutlineRegular className={styles.icon} />
							</Button>
						}
						items={active.baselines.map((item) => ({
							id: item.ref,
							label: item.label,
						}))}
						onSelect={(id) => {
							select({
								...selection,
								base: { kind: "manual", ref: id },
								revision: { kind: "all-commits" },
							});
							setBaselineOpen(false);
						}}
					/>
				)}
			<span className={styles.baseline} title={context}>
				{context}
			</span>
			<Tooltip label="Refresh" side="bottom" align="end" portal>
				<Button
					size="sm"
					variant="ghost"
					aria-label="Refresh"
					icon={<IconRefreshOutlineRegular className={styles.icon} />}
					onClick={refresh}
				/>
			</Tooltip>
		</div>
	);
}

function BranchLabel({
	name,
	modifiedAt,
}: {
	name: string;
	modifiedAt: number;
}) {
	return (
		<span className={styles.branchMenuLabel}>
			<span className={styles.truncate}>{name}</span>
			<time
				className={styles.meta}
				dateTime={new Date(modifiedAt).toISOString()}
				title={`Latest commit: ${new Date(modifiedAt).toLocaleString()}`}
			>
				{formatRelativeTime(modifiedAt)}
			</time>
		</span>
	);
}

function CommitPicker({
	api,
	sessionId,
	selection,
	revision,
	selectRevision,
}: {
	api: TypertRemoteNamespace<"workspaceReview">;
	sessionId: string;
	selection: Extract<ReviewSelection, { kind: "branch" }>;
	revision: number;
	selectRevision: (
		revision: Extract<ReviewSelection, { kind: "branch" }>["revision"],
	) => void;
}) {
	const [offset, setOffset] = useState(0);
	const [open, setOpen] = useState(false);
	const load = useCallback(
		(signal: AbortSignal) => {
			// smell: loader identity refreshes the page even when branch, baseline and offset are unchanged.
			void revision;
			return selection.base === ""
				? Promise.resolve({
						ok: true as const,
						value: { commits: [], hasMore: false },
					})
				: api.commits(
						sessionId,
						selection.repository,
						selection.ref,
						selection.base,
						offset,
						signal,
					);
		},
		[
			api,
			sessionId,
			selection.repository,
			selection.ref,
			selection.base,
			offset,
			revision,
		],
	);
	const result = useLoad(load);
	const label =
		selection.revision.kind === "all-commits"
			? "All commits"
			: `${selection.revision.commit.sha.slice(0, 8)} ${selection.revision.commit.subject}`;
	return (
		<Menu
			open={open}
			onClose={() => setOpen(false)}
			selectedId={
				selection.revision.kind === "all-commits"
					? "all"
					: selection.revision.commit.sha
			}
			portal
			compact
			autoFocus
			className={styles.scopePicker}
			anchor={
				<Button
					size="sm"
					variant="ghost"
					className={styles.branchButton}
					aria-label="Commit"
					aria-haspopup="menu"
					aria-expanded={open}
					title={label}
					disabled={selection.base === ""}
					onClick={() => setOpen(!open)}
				>
					<span className={styles.truncate}>{label}</span>
					<IconChevronDownOutlineRegular className={styles.icon} />
				</Button>
			}
			items={[
				{ id: "all", label: "All commits" },
				...(result.status === "ready"
					? result.value.commits.length === 0
						? [
								{
									type: "label" as const,
									id: "empty",
									text: "No commits on this branch",
								},
							]
						: result.value.commits.map((commit) => ({
								id: commit.sha,
								label: (
									<span className={styles.commitLabel}>
										<span className={styles.truncate}>{commit.subject}</span>
										<span className={styles.meta}>
											{commit.sha.slice(0, 8)} · {commit.author} ·{" "}
											<time
												dateTime={commit.date}
												title={new Date(commit.date).toLocaleString()}
											>
												{formatRelativeTime(Date.parse(commit.date))}
											</time>
										</span>
									</span>
								),
							}))
					: [
							{
								type: "label" as const,
								id: "status",
								text:
									result.status === "loading"
										? "Loading commits…"
										: result.message,
							},
						]),
			]}
			footer={
				result.status === "ready" && result.value.commits.length > 0
					? [
							{
								id: "previous",
								label: "Previous commits",
								disabled: offset === 0,
							},
							{
								id: "more",
								label: "More commits",
								disabled: !result.value.hasMore,
							},
						]
					: []
			}
			onSelect={(id) => {
				if (id === "previous") setOffset(offset - COMMIT_PAGE_SIZE);
				else if (id === "more") setOffset(offset + COMMIT_PAGE_SIZE);
				else {
					if (id === "all") selectRevision({ kind: "all-commits" });
					else {
						if (result.status !== "ready")
							throw new Error("Commits must be loaded");
						const commit = result.value.commits.find((item) => item.sha === id);
						if (commit === undefined) throw new Error("Commit must exist");
						selectRevision({ kind: "commit", commit });
					}
					setOpen(false);
				}
			}}
		/>
	);
}
