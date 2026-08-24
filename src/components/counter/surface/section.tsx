import type { ReactNode } from "react"
import { hasData, type SectionData } from "@/lib/counter/section-data"
import { Skeleton } from "@/components/counter/state/skeleton"
import { Failed } from "@/components/counter/state/failed"
import { Empty } from "@/components/counter/state/empty"
import { StaleBanner } from "@/components/counter/state/stale"
import { Owed } from "@/components/counter/state/owed"

/**
 * The keystone. Prototype note 22 in one component.
 *
 * A page author writes `<Section title="…" data={x}>{d => …}</Section>` and
 * gets all six states, correctly, with no opportunity to get them wrong —
 * because `children` is a function that only runs when data exists. There is no
 * code path in which a page renders a figure that is not there.
 *
 * This is also why `npm run tokens` forbids a page from inspecting
 * `SectionData.status`: the check belongs here, once.
 */
export function Section<T>({
  title,
  meta,
  data,
  askAbout,
  onRetry,
  children,
}: {
  title: string
  /** A short qualifier — the range, the store, the row count. Shown only with data. */
  meta?: string
  data: SectionData<T>
  /** `true` asks about the section by its title; a string asks about that instead. */
  askAbout?: boolean | string
  onRetry?: (action: string) => void
  children: (data: T) => ReactNode
}) {
  const withData = hasData(data)
  const askTarget = askAbout === true ? title : askAbout

  return (
    <section className="rounded-ct border border-ct-line bg-ct-surface p-5">
      <div className="mb-4 flex items-baseline gap-3">
        <h3 className="text-ct-mid text-ct-ink">{title}</h3>
        {withData && meta ? (
          <span className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
            {meta}
          </span>
        ) : null}
        {/* Note 55: this button was rendered on fifty pages and wired to nothing.
            It appears only when there is an answer to ask about, and it carries
            the question with it so the Ask surface does not have to guess. */}
        {withData && askTarget ? (
          <button
            type="button"
            data-ask-about={askTarget}
            className="ml-auto font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3 hover:text-ct-accent"
          >
            Ask about this
          </button>
        ) : null}
      </div>

      {data.status === "loading" ? <Skeleton /> : null}
      {data.status === "failed" ? (
        <Failed error={data.error} retryAction={data.retryAction} onRetry={onRetry} />
      ) : null}
      {data.status === "empty" ? <Empty reason={data.reason} /> : null}
      {data.status === "not_computed" ? <Owed owed={data.owed} /> : null}
      {data.status === "stale" ? <StaleBanner lastGoodAt={data.lastGoodAt} /> : null}
      {withData ? children(data.data) : null}
    </section>
  )
}
