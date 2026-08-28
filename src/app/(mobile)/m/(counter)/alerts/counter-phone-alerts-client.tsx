"use client"

import { useMemo } from "react"
import {
  MList,
  Section,
  Tag,
  useCounterTransition,
  type MListRow,
} from "@/components/counter"
import { readCounterParams } from "@/lib/counter/url-state"
import type { AlertsSections, PhoneAlertRow } from "@/lib/counter/adapters/alerts"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * Counter Needs-you — "Open right now", the phone (`P.alerts.phone`,
 * `docs/counter/counter-prototype.html:4820`), composed in its order and
 * stopping where it stops:
 *
 *   `.mtitle` / `.msub` → `sec('Open', '3', mlist(3))` →
 *   `sec('Acknowledged', 'last 30 days', mlist(2))`
 *
 * It calls the SAME adapter the desk calls, with the SAME arguments, so no
 * figure here can disagree with the same figure on `/dashboard/alerts`: one
 * inbox, one load, one `SectionData` per section.
 *
 * ## The subtitle is this surface's own N-R2
 *
 * The prototype writes "3 open · 12 acknowledged". Live it reads
 * `77 open · 0 acknowledged`, and the second figure is `status =
 * ACKNOWLEDGED` — never the ten rows carrying an `acknowledgedAt`, every one
 * of which is a DISMISSAL. It is built in the ADAPTER (`phoneHead.sub`), not
 * assembled here out of two counts, because a page that formats its own
 * version of a figure is a second opinion about that figure.
 *
 * ## The second section is "Closed", not "Acknowledged" (N-R18)
 *
 * The prototype titles it `sec('Acknowledged', 'last 30 days', mlist(2))`.
 * Scoped to `status = ACKNOWLEDGED` this database has zero rows, and the
 * section drew its `mlist` shell over them — chosen so that `Empty` would not
 * emit a `.empty` landmark the prototype lacks. What that rendered was a
 * heading over a blank white panel, and the fidelity gate measured it as
 * three rendering differences (an `.mlist` with no children has no grid track
 * and no text). Avoiding the extra landmark did not make the section render.
 *
 * So it holds what is CLOSED — the same rows the desk's median time-to-close
 * is measured over — and the adapter names the population in the meta
 * ("1 dismissal"). N-R2 is untouched: the two figures that could call a
 * dismissal an acknowledgement are the desk strip's cell and the `.msub`
 * above, and both still read `status = ACKNOWLEDGED`, which is still 0.
 * A window with nothing closed in it carries one stated row rather than a
 * blank list. All of that is decided in the adapter; this file prints it.
 *
 * ## The phone is a route, not a breakpoint
 *
 * `src/proxy.ts` rewrites `/dashboard/alerts` to `/m/alerts` on a phone
 * user agent. A screenshot of the desk at 390px photographs the desk squeezed
 * and says nothing about this file.
 *
 * ## What the phone drops, and it is the prototype that drops it
 *
 * | Desk | Phone |
 * |---|---|
 * | the four-cell `.strip` | the `.msub`'s two counts |
 * | two `.filters` rows, eight toggles, a search box | — |
 * | the five-column `tbl` | two `mlist`s, six rows each at most |
 * | the opened-per-day bars | — |
 *
 * The filters are the one worth naming: the desk's two rows write to the URL
 * and this surface has none, but it still reads the same params — a link
 * pressed on a desk and opened on a phone must be the same segment and the
 * same filter, and the adapter applies them either way.
 */
export function CounterPhoneAlertsClient({
  params: paramsString,
  today,
  sections,
}: {
  /** The query string as PLAIN TEXT — a `URLSearchParams` loses its prototype crossing the RSC boundary. */
  params: string
  today: Date
  sections: SectionSources<AlertsSections>
}) {
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  // Read for the same reason `/m/decisions` reads `?day=`: the params this
  // page was rendered for are the params the adapter was asked with, and
  // reading them here is what proves the two agree.
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])
  void counterParams

  /*
   * This page owns no `push` of its own — the date sheet and the store picker
   * are `PhoneShell`'s, and there is no filter row on this surface. `pending`
   * is that same transition, threaded to every `<Section>` below so a store
   * change reads as `stale` rather than a blank `loading.tsx`.
   */
  const { pending } = useCounterTransition()

  return (
    /*
     * A FRAGMENT. `.ct-root.ct-phone`, `.mtop` and `.mscroll` are
     * `src/app/(mobile)/m/(counter)/layout.tsx`'s. What is rendered here is
     * what goes INSIDE `.mscroll`.
     */
    <>
      {/* The store is not in this sub: `.mtop`'s `.st` is already showing it,
          one element up. What IS here is the pair of counts — see the file
          note on N-R2. */}
      <Section bare title="Alerts" data={sections.phoneHead} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">{h.title}</h2>
            <p className="msub">{h.sub}</p>
          </div>
        )}
      </Section>

      <Section title="Open" meta={(l) => l.meta} data={sections.phoneOpen} pending={pending}>
        {(l) => <MList rows={l.rows.map(listRow)} />}
      </Section>

      {/* What is no longer open, never a blank panel. See the file note. */}
      <Section
        title="Closed"
        meta={(l) => l.meta}
        data={sections.phoneClosed}
        pending={pending}
      >
        {(l) => <MList rows={l.rows.map(listRow)} />}
      </Section>
    </>
  )
}

/**
 * `PhoneAlertRow` in `.mli` shape.
 *
 * Every string on the row — the title, the "Anomalies · 1d ago" detail, the
 * severity word — is the ADAPTER's, built beside the desk's own rows so
 * neither surface can round or relabel what the other prints. The only thing
 * decided here is that the severity word is wrapped in a `Tag`, because a
 * component cannot be built in a `.ts` adapter and because `Tag` is where the
 * `.mtag` tone classes live and nowhere else.
 *
 * No `href`: there is no per-alert page, and `.mli.is-link` is set from `href`
 * alone, so a row without one cannot advertise a tap that does nothing.
 *
 * A row with no `severityLabel` gets no `.mtag` at all. That is the stated row
 * a closed list carries when nothing has closed (N-R18) — a sentence, not an
 * alert — and giving it an "Info" pill would file it as the mildest of five
 * alerts rather than as the absence of any.
 */
function listRow(r: PhoneAlertRow): MListRow {
  return {
    key: r.key,
    title: r.title,
    detail: r.detail,
    value: r.severityLabel ? <Tag tone={r.severityTone}>{r.severityLabel}</Tag> : null,
  }
}
