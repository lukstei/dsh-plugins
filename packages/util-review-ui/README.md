# @lukstei/util-review-ui

## Summary

Source-only library shared by the Git review plugin: file list, code and diff views, review card, selection quoting, and the review schemas and types. It has no Cordis entry and no bundle. Its only consumer is [`@lukstei/dsh-client-review-git`](../dsh-client-review-git/README.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install `@lukstei/util-review-ui` and import from the package `exports`:

| Import | Content |
|---|---|
| `@lukstei/util-review-ui/types` | Git review data contracts (`ReviewScope`, `ReviewTarget`, `GitSnapshot`, `GitDiffView`, `GitRepository`, ...), `COMMIT_PAGE_SIZE` (50), `MAX_BRANCH_AGE_MS` (7 days) |
| `@lukstei/util-review-ui/review` | Zod schemas (`reviewTargetSchema`, `branchReviewScopeSchema`, `snapshotSchema`), `GIT_REVIEW_TOOL` (`git_review_present`), `branchLabel`, `shortSha`, `commentLines` |
| `@lukstei/util-review-ui/client/*` | React components and hooks from [src/client/](src/client/) |
| `@lukstei/util-review-ui/pane-css` | Build plugin that inlines `GitDiffPane.module.css` |

Client modules: `FileList`, `FileReview`, `CodeFileView`, `ReviewCard`, `useLazyFile`, `useSelectionQuote`, `quote` (`formatQuoteContent`, `quoteToComposer`), `diff` (`createUnifiedDiff`), `relativeTime`.

Client bundles that use the components must register the exported `paneCss` plugin in their build, so the scoped CSS module ships inside the single DSH plugin script. The bundle of [`@lukstei/dsh-client-review-git`](../dsh-client-review-git/README.md) does this.

### Plugin dependencies

No plugin dependencies. Library; not mounted, no `inject`.

Used by (code imports): [`dsh-client-review-git`](../dsh-client-review-git/README.md), [`dsh-client-split-view`](../dsh-client-split-view/README.md).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- [src/types.ts](src/types.ts): plain TypeScript contracts for host Git reads and sidebar rendering.
- [src/review.ts](src/review.ts): schemas and formatting helpers.
- [scripts/pane-css.ts](scripts/pane-css.ts): build plugin that compiles the CSS module with `lightningcss` and exports `cssText` plus scoped class names.
- [src/client/](src/client/): components and hooks. `useLazyFile` loads a file when expanded and aborts stale requests. `useSelectionQuote` turns a code selection into a quote payload.

Persisted state: none. Runtime deps: `@deepseek-ai/dsh-typert-protocol`, `zod`; UI primitives come from `@deepseek-ai/dsh-client-ui-primitives` at the consumer.

Tests: specs beside sources ([diff.spec.ts](src/client/diff.spec.ts), [quote.spec.ts](src/client/quote.spec.ts), [ReviewCard.spec.tsx](src/client/ReviewCard.spec.tsx), [useSelectionQuote.spec.tsx](src/client/useSelectionQuote.spec.tsx)).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@lukstei/dsh-client-review-git`](../dsh-client-review-git/README.md): the consumer.

<a id="model-experience"></a>
## Model Experience

No model-visible surface. This package adds no tools, prompt text, or context to the model.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

None.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`pnpm run verify` runs Biome, typecheck and tests. There is no build step.

</details>
