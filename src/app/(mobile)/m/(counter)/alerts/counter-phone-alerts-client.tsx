"use client"

import { useMemo, useState, useTransition } from "react"
import {
  MList,
  Section,
  Tag,
  useCounterTransition,
  type MListRow,
  SubNav,
} from "@/components/counter"
import { PHONE_ALERT_TABS } from "@/lib/counter/nav"
import { readCounterParams } from "@/lib/counter/url-state"
import type { AlertsSections, PhoneAlertRow } from "@/lib/counter/adapters/alerts"
import type { SectionSources } from "@/lib/counter/adapters/types"
import { useRouter } from "next/navigation"
import { closeAlert } from "@/lib/counter/actions/alert"

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

/**
 * ANSWERING AN ALERT FROM THE PHONE.
 *
 * The desk inbox got acknowledge and dismiss; this is the same decision on the
 * surface an owner actually has in their hand when a number moves. The mobile
 * direction for this product is a lean glance-and-do tool, and an inbox you can
 * only glance at is half of that.
 *
 * SAME URL CONTRACT AS THE DESK. `?alert=<id>` selects, and the row is a link
 * rather than a button — which is also what `P.alerts.phone()` does, giving
 * every open row a `go:` destination while ours have been inert since the page
 * was built. So this makes the list MORE like the fixture, not less, and the
 * two surfaces can hand each other a link that means the same thing.
 *
 * Nothing renders until a row is picked, so the page's default composition is
 * untouched and the fidelity baseline holds.
 *
 * `.mbtn`, not `.btn`: this is the phone's button and the only class
 * `counter-components.css` styles in this position. The explanation field the
 * desk offers is deliberately absent — a walk-in is not where anyone types a
 * paragraph, and `acknowledgeAlert` without text is a complete decision
 * (ACKNOWLEDGED rather than EXPLAINED), not a degraded one.
 */
function PhoneAlertDecision({
  alert,
  onDone,
}: {
  alert: PhoneAlertRow
  onDone: () => void
}) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()
  const [failed, setFailed] = useState(false)

  const close = (how: "acknowledge" | "dismiss") => {
    setFailed(false)
    startSaving(async () => {
      const result = await closeAlert(alert.id, how)
      if (!result.ok) {
        setFailed(true)
        return
      }
      onDone()
      router.refresh()
    })
  }

  return (
    <div className="msec__body">
      <p className="mlede">{alert.title}</p>
      <p className="msub">{alert.detail}</p>
      <button
        className="mbtn mbtn--primary"
        type="button"
        disabled={saving}
        onClick={() => close("acknowledge")}
      >
        {saving ? "Saving…" : "Acknowledge"}
      </button>
      <button
        className="mbtn"
        type="button"
        disabled={saving}
        onClick={() => close("dismiss")}
      >
        Dismiss
      </button>
      {failed ? <p className="msub">That did not save.</p> : null}
    </div>
  )
}

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

  // The same key the desk inbox uses. See `listRow`.
  const selectedAlert = params.get("alert")
  const router = useRouter()

  return (
    /*
     * A FRAGMENT. `.ct-root.ct-phone`, `.mtop` and `.mscroll` are
     * `src/app/(mobile)/m/(counter)/layout.tsx`'s. What is rendered here is
     * what goes INSIDE `.mscroll`.
     */
    <>
      {/* The design's `VIEWS` bar, first inside `.mscroll` — which is exactly
          where `phoneFor()` puts a `.seg`. Same destinations as the desk's,
          on `/m` paths. */}
      <SubNav items={PHONE_ALERT_TABS} label="Alerts" />

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
        {(l) => (
          <>
            <MList rows={l.rows.map(listRow)} />
            {(() => {
              const picked = l.rows.find((r) => r.closable && r.id === selectedAlert)
              return picked ? (
                <PhoneAlertDecision
                  alert={picked}
                  onDone={() => router.push("/m/alerts", { scroll: false })}
                />
              ) : null
            })()}
          </>
        )}
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
    /*
     * A DESTINATION ON THE ROWS THAT CAN BE ANSWERED.
     *
     * `P.alerts.phone()` gives every open row a `go:`; ours have been inert
     * since the page was built, because the prototype's destination was a
     * page this product did not have. `?alert=` is one it does have — the
     * same key the desk inbox selects with — so the row now opens the
     * decision below it, and a link copied from either surface means the
     * same thing on the other.
     */
    href: r.closable ? `/m/alerts?alert=${encodeURIComponent(r.id)}` : undefined,
  }
}
