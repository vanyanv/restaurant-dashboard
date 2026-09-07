"use client"

import dynamic from "next/dynamic"
import type { ShownPresentation } from "@/lib/chat/return"

/**
 * The chart and table half of an answer, kept out of every route's first load.
 *
 * `AskAnswerBody` is reached from the Counter barrel by all 42 rebuilt routes,
 * because the ⌘K palette mounts on every one of them. Importing `Chart` and
 * `Table` from it directly would put the chart geometry, the tooltip
 * hit-testing and the FLIP table in the initial JavaScript of pages that never
 * draw either — the exact shape of the regression `package.json`'s
 * `sideEffects` fix went and undid (51 routes over budget, then 0).
 *
 * Deferring is also just what is true of this component: a presentation exists
 * only after a turn has streamed back, which is seconds after first paint at
 * the earliest and never at all on a page nobody asks a question from. SSR is
 * left ON — a RESTORED thread renders its charts in the server's HTML, and a
 * fidelity run that has to wait a frame for a landmark is a fidelity run that
 * can flake.
 *
 * Nothing renders and no chunk is fetched until there is something to draw.
 */
const AskShowBody = dynamic(
  () => import("./ask-show-body").then((m) => m.AskShowBody),
  { loading: () => null },
)

export function AskShow({ shown }: { shown: readonly ShownPresentation[] }) {
  if (shown.length === 0) return null
  return <AskShowBody shown={shown} />
}
