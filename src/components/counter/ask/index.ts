/**
 * The Ask surface's own entry point — a SECOND public barrel, deliberately
 * separate from `@/components/counter`.
 *
 * ## Why these five are not in the main barrel
 *
 * They were, and it cost every Counter route ~40 KB of JavaScript it never
 * ran. `ask-surface.tsx` imports `@/lib/counter/use-ask`, which imports
 * `useChat` from `@ai-sdk/react` and `DefaultChatTransport` from `ai`. The
 * main barrel is imported by 103 files — every page client takes `Section`,
 * `Strip`, `Table` from it — and a barrel is one module graph, so all 42
 * rebuilt routes pulled the AI SDK in whether or not they rendered anything
 * that used it. Measured: `/m/alerts` and `/dashboard/alerts` were 2.6 KB
 * apart at ~344 KB gzipped, and every `/m/**` route was ~1.8x its budget.
 *
 * `next.config.ts`'s `optimizePackageImports` cannot help here — it rewrites
 * imports of npm PACKAGES, and `@/components/counter` is a path alias.
 *
 * ## What belongs here
 *
 * Anything under `ask/`. Three pages render one of these directly (the two
 * Ask pages and the two overview clients); everything else reaches the ⌘K
 * palette through `AppShell`, which loads it on demand rather than importing
 * it eagerly — see the `next/dynamic` call there.
 *
 * `tests/components/counter/boundary.test.ts` holds this file to the same
 * completeness rule the main barrel has: every `ask/*.tsx` must be re-exported
 * from exactly one of the two barrels, so a new file cannot end up reachable
 * only by a deep path.
 */
export { AskSurface } from "./ask-surface"
export { AskBar } from "./ask-bar"
export { AskSheet } from "./ask-sheet"
export { AskAnswerPane, AskAnswerBody } from "./ask-answer"
export { AskComposer } from "./ask-composer"
/*
 * The reading log an answer shows while it is worked out.
 *
 * HERE RATHER THAN IN `surface/`, and that placement is load-bearing: it
 * imports `TOOL_LABELS`, ~300 lines of label data, and the main barrel is
 * imported by ~100 files. Exported from there it put that map into all 42
 * Counter routes and pushed two phone routes back over budget — the same
 * defect, one size down, that splitting this entry point out fixed in the
 * first place. It belongs with the Ask code, which already loads the labels.
 */
export { Thinking } from "./thinking"
/* The `.convs` rail of past conversations — the prototype's Ask page is a
   two-column `.askpage` and this is its left column. */
export { Conversations } from "./conversations"
