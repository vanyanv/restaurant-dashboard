"use client"

import Link from "next/link"
import { signOut } from "next-auth/react"
import { useEffect, useState, useTransition } from "react"
import { MHead, MList, Section, Wordmark, useCounterTransition } from "@/components/counter"
import { saveNotificationPreferences } from "@/lib/counter/actions/settings"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { SettingsNotifications, SettingsSections } from "@/lib/counter/adapters/settings"

/**
 * More, on a phone — `P.settings.phone()`.
 *
 * "Where the wordmark makes its second appearance, and the only place it does
 * on the phone." That is the prototype's own note on this page, and it is why
 * `.mlogo` opens it: the fifth tab is the only phone surface with room for the
 * brand, because it is the only one that is not a reading.
 *
 * Four things, in the design's order: the wordmark, who is signed in, the
 * notification switches, and where else to go. The desk's Sessions table, its
 * Team table, its Brand panel and its Preferences list are all desk-only —
 * they are things you configure sitting down, and `P.settings.phone()` leaves
 * every one of them out.
 *
 * The switches WORK here. The editorial page this replaces carried a note
 * reading "Profile, password, and notification preferences are edited on
 * desktop. Mobile shows the active values only" — which was true and is the
 * thing worth fixing rather than explaining.
 */

/** The three standing orders, in `P.settings.phone()`'s own order. */
const TOGGLES: Array<{ key: keyof State; label: string; detail: string }> = [
  { key: "invoices", label: "Invoice review", detail: "When something needs approving" },
  { key: "anomaly", label: "Critical alerts", detail: "Breaks and sync failures" },
  { key: "weekly", label: "Weekly decisions", detail: "Sunday evening" },
]

interface State {
  invoices: boolean
  weekly: boolean
  anomaly: boolean
}

function Switches({ data }: { data: SettingsNotifications }) {
  const [state, setState] = useState<State>({
    invoices: data.invoices,
    weekly: data.weekly,
    anomaly: data.anomaly,
  })
  const [saving, startSaving] = useTransition()
  const [problem, setProblem] = useState<string | null>(null)

  // The server is the truth: if the section re-resolves, take its answer.
  useEffect(() => {
    setState({ invoices: data.invoices, weekly: data.weekly, anomaly: data.anomaly })
  }, [data.invoices, data.weekly, data.anomaly])

  function toggle(key: keyof State) {
    const previous = state
    const next = { ...state, [key]: !state[key] }
    setState(next)
    setProblem(null)
    startSaving(async () => {
      const result = await saveNotificationPreferences(next)
      if (!result.ok) {
        setProblem(result.error)
        setState(previous)
      }
    })
  }

  return (
    <>
      {TOGGLES.map((t) => (
        <div className="setrow" key={t.key}>
          <div className="tx">
            <b>{t.label}</b>
            <span>{t.detail}</span>
          </div>
          <button
            className="sw"
            type="button"
            aria-pressed={state[t.key]}
            aria-label={t.label}
            disabled={saving}
            onClick={() => toggle(t.key)}
          >
            <i />
          </button>
        </div>
      ))}
      <p className="mono" style={{ margin: "10px 0 0" }}>
        {problem === null ? data.note : `Could not save: ${problem}.`}
      </p>
    </>
  )
}

export function CounterPhoneMoreClient({
  name,
  email,
  role,
  sections,
}: {
  name: string
  email: string
  role: string
  sections: SectionSources<SettingsSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      {/* `.mlogo`, and no landmark class — the prototype's own wrapper. */}
      <div
        className="mlogo"
        style={{ display: "grid", justifyItems: "center", gap: 6, padding: "6px 0 2px" }}
      >
        <Wordmark />
        <span className="mono">Operations</span>
      </div>

      <MHead
        label="Signed in as"
        value={name}
        note={
          <p className="mono">
            {email} · {role === "DEVELOPER" ? "Developer" : "Owner"}
          </p>
        }
      />

      <Section
        title="Notifications"
        meta={(n) => n.meta}
        data={sections.notifications}
        pending={pending}
      >
        {(n) => <Switches data={n} />}
      </Section>

      {/* `P.settings.phone()`'s "More" list: the destinations the four other
          tabs do not reach. Every one is a Counter page. */}
      <Section title="More" meta={() => "everything not on the other four tabs"} data={sections.account} pending={pending}>
        {() => <MList rows={MORE_ROWS} />}
      </Section>

      {/* `P.settings.phone()`'s closing `.mbtn`, outside every section. */}
      <button className="mbtn" type="button" onClick={() => signOut({ callbackUrl: "/login" })}>
        Sign out
      </button>
    </>
  )
}

/**
 * Static, so it needs no query and resolves with the shell.
 *
 * `MList` rows carry an `href`, so each of these is a real link rather than
 * the prototype's `data-goto` delegate — middle-clickable and copyable, the
 * same call `Rail` and `SubNav` make.
 *
 * ## This list is the phone's ONLY way into most of the product
 *
 * It held six rows and the phone had twenty-one rebuilt pages.
 * `e2e/mobile/reachability.spec.ts` put a number on it: nine gated Counter
 * phone pages — Today's own alerts and decisions, Analytics, COGS, Labor,
 * Menu, Menu profit, Product mix and the Operations hub — were reachable only
 * by typing the URL. Built, gated, landmark-perfect, and with no entrance.
 * It is the same defect `/dashboard/stores/new` had, nine times over, and no
 * gate could see it: fidelity measures a page you navigate to, and the link
 * sweep asks whether a link resolves, not whether one exists.
 *
 * ## The order is the design's, not the sitemap's
 *
 * `P.more.phone()` groups its destinations — Money, Back of house, Account —
 * and `P.more.desk()` writes down the rule behind the grouping: "a tab is for
 * something you DO on your feet… everything you merely READ lives one tap
 * deeper." So this runs money first, then the back of house, then the
 * catalogue, then the developer's own tab, rather than alphabetically or in
 * the order the pages were built.
 *
 * Four destinations are deliberately NOT here and are one level further in:
 * packaging, product usage, vendors and stock counts all hang off Operations,
 * which the design calls "a hub of hubs". A flat list of everything is a
 * sitemap, and the reason this page is not one is that it has to be readable
 * at arm's length.
 */
const MORE_ROWS = [
  { key: "pnl", href: "/m/pnl", title: "P&L", detail: "The statement, line by line", value: "" },
  { key: "labor", href: "/m/labor", title: "Labor", detail: "Hours and cost against the budget", value: "" },
  { key: "cogs", href: "/m/cogs", title: "COGS", detail: "What the food actually cost", value: "" },
  { key: "analytics", href: "/m/analytics", title: "Analytics", detail: "Channels, hours, days", value: "" },
  { key: "productmix", href: "/m/product-mix", title: "Product mix", detail: "What sells with what", value: "" },
  { key: "menuprofit", href: "/m/menu-profit", title: "Menu profit", detail: "Margin per item", value: "" },
  { key: "decisions", href: "/m/decisions", title: "Needs you", detail: "Waiting on a decision", value: "" },
  { key: "alerts", href: "/m/alerts", title: "Alerts", detail: "What tripped, and when", value: "" },
  { key: "operations", href: "/m/operations", title: "Operations", detail: "Counts, vendors, packaging, usage", value: "" },
  { key: "stores", href: "/m/stores", title: "Stores", detail: "Rent, commissions, COGS targets", value: "" },
  { key: "menu", href: "/m/menu", title: "Menu", detail: "The catalogue and what it earns", value: "" },
  { key: "recipes", href: "/m/recipes", title: "Recipes", detail: "What each plate is made of", value: "" },
  { key: "ingredients", href: "/m/ingredients", title: "Ingredients", detail: "The catalogue and its prices", value: "" },
  { key: "monitoring", href: "/m/monitoring", title: "Monitoring", detail: "Developer-facing", value: "" },
]
