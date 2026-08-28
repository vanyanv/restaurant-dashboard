"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * Ask's content-only loading boundary.
 *
 * `npm run tokens` requires a `loading.tsx` beside every `page.tsx` under a
 * `(counter)` route group, and this route is no exception even though it is
 * the shortest-lived boundary in the product: this page awaits a session and a
 * store list and nothing else, so what shows here is the flicker between
 * pressing Ask in the rail and the page painting.
 *
 * ONE section, not a mock of the answer. Built from `Section` with `loading()`
 * for the same reason every other boundary here is (see
 * `(counter)/loading.tsx`) — a second loading appearance in one product is
 * worse than none. The title is deliberately not a question: the reader's own
 * question is not known on the server, and the ANSWER's wait is drawn by
 * `AskAnswerBody`'s "Reading the numbers…" on the page itself, which is where
 * it belongs.
 */
export default function AskLoading() {
  return (
    <Section bare title="Ask" data={loading()}>
      {() => null}
    </Section>
  )
}
