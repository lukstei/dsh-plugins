import type { ReviewCatalog, ReviewScope } from "@lukstei/util-review-ui/types";

export function resolveReviewBaseline(
	scope: ReviewScope | null,
	catalog: ReviewCatalog | null,
): string {
	if (scope === null || scope.kind !== "branch") return "";
	if (scope.base.kind === "manual") return scope.base.ref;
	if (catalog === null || catalog.kind !== "git") return "";
	const repo = catalog.repositories.find((r) => r.cwd === scope.repository);
	if (repo === undefined) return "";
	const branch = repo.branches.find((branch) => branch.ref === scope.ref);
	return branch === undefined || branch.base === null ? "" : branch.base;
}
