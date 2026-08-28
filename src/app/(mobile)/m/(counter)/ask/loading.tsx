"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The phone Ask's content-only loading boundary.
 *
 * `npm run tokens` requires a `loading.tsx` beside every `page.tsx` under a
 * `(counter)` route group, and this is the shortest-lived boundary on the
 * phone as it is on the desk: the page awaits a session and a store list and
 * nothing else. The ANSWER's wait is drawn by `AskAnswerBody`'s "Reading the
 * numbers…" on the page itself, which is where it belongs — this is only the
 * flicker before the reader's own question is on screen.
 *
 * See `(mobile)/m/(counter)/loading.tsx` for why this is `"use client"` and
 * why it is built from `Section` rather than a second skeleton.
 */
export default function MobileAskLoading() {
  return (
    <Section bare title="Ask" data={loading()}>
      {() => null}
    </Section>
  )
}
