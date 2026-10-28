"use client"

import Link from "next/link"
import { signOut } from "next-auth/react"
import { useEffect, useState, useTransition } from "react"
import { Logo, MHead, MList, Note, Section, ThemeRow, useCounterTransition, type MListRow } from "@/components/counter"
import { phoneHref } from "@/lib/phone-routes"
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
      <Note live tone={problem === null ? undefined : "bad"}>
        {problem === null ? data.note : `Could not save: ${problem}.`}
      </Note>
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
      {/* `.mlogo`, and no landmark class — the prototype's own wrapper, with
          its own inline style: `P.settings.phone()` (prototype line 5900) is
          `display:grid;justify-items:center;gap:6px;padding:6px 0 2px` holding
          the MARK and a mono caption.

          THE MARK, not `Wordmark`. This drew the name in Bricolage, and the
          give-away that it was wrong is in the ported sheet: `.mlogo .logo`
          declares `width:118px` (counter-components.css:519) and nothing in
          the application matched it, because nothing rendered a `.logo` here.
          Note 15 is why it matters — "the wordmark is the palette's alibi":
          Counter's red and signal yellow read as a designer's choice until the
          real mark sits beside them, and a line of type is not the real thing.
          This is the fifth tab, the one phone surface with room for it.

          `priority={false}`, which `Logo`'s own note asks for: it defaults on
          because every other slot that draws this is a bare auth page where
          the mark is the LCP candidate. Here it is chrome above a list. */}
      <div
        className="mlogo"
        style={{ display: "grid", justifyItems: "center", gap: 6, padding: "6px 0 2px" }}
      >
        <Logo width={118} priority={false} />
        <span className="mono">Operations</span>
      </div>

      {/* The destinations first: they are why a reader opens More. Static,
          so each group resolves with the shell. */}
      {MORE_GROUPS.map((g) => (
        <Section key={g.title} title={g.title} data={sections.account} pending={pending}>
          {() => <MList rows={g.rows} />}
        </Section>
      ))}

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

      {/* Theme is kept in this browser, so the phone gets its own control rather
          than a note sending the reader to the desk. Static, like "More". */}
      <Section title="Appearance" meta={() => "kept on this phone"} data={sections.account} pending={pending}>
        {() => <ThemeRow />}
      </Section>


      {/* `P.settings.phone()`'s closing `.mbtn`, outside every section. */}
      <button className="mbtn" type="button" onClick={() => signOut({ callbackUrl: "/login" })}>
        Sign out
      </button>
    </>
  )
}

/**
 * More is the phone's way into everything the other four tabs do not reach,
 * so it lists every desk rail destination. `e2e/mobile/reachability.spec.ts`
 * fails when a gated phone page has no entrance, and
 * `tests/lib/phone-routes.test.ts` when a desk page has neither a phone page
 * nor a place on the desk-only list.
 *
 * It used to be one flat list of fourteen rows that left out Store checks,
 * Shop, Count & waste, Menu items, Orders, Inventory and Vendors, so on a
 * phone those were reachable only by typing the URL.
 */
const r = (key: string, deskHref: string, title: string, detail: string): MListRow => ({
  key,
  href: phoneHref(deskHref),
  title,
  detail,
  value: "",
})

/**
 * The desk rail's own groups, in its order, so a reader who knows where a page
 * lives on the desk finds it under the same heading here. Hrefs go through
 * `phoneHref`: a page with a phone twin opens it, a desk-only page opens on
 * the desk shell, which keeps the bottom bar at phone width.
 */
const MORE_GROUPS: ReadonlyArray<{ title: string; rows: MListRow[] }> = [
  {
    title: "Stores",
    rows: [
      r("checks", "/dashboard/checks", "Store checks", "Today, history, checklists, crew & PINs"),
      r("shop", "/dashboard/shop", "Shop", "Merch orders, products, pickup"),
    ],
  },
  {
    title: "Today",
    rows: [
      r("alerts", "/dashboard/alerts", "Needs you", "What tripped, and when"),
      r("decisions", "/dashboard/decisions", "The week ahead", "Waiting on a decision"),
      r("orders", "/dashboard/orders", "Orders", "Every ticket, by channel"),
    ],
  },
  {
    title: "Money",
    rows: [
      r("pnl", "/dashboard/pnl", "P&L", "The statement, line by line"),
      r("cogs", "/dashboard/cogs", "COGS", "What the food actually cost"),
      r("labor", "/dashboard/labor", "Labor", "Hours and cost against the budget"),
      r("analytics", "/dashboard/analytics", "Analytics", "Channels, hours, days"),
    ],
  },
  {
    title: "Menu",
    rows: [
      r("items", "/dashboard/menu/items", "Menu items", "Photos, food cost, new item"),
      r("menu", "/dashboard/menu", "Menu", "The catalogue and what it earns"),
      r("recipes", "/dashboard/recipes", "Recipes", "What each plate is made of"),
      r("menuprofit", "/dashboard/menu-profit", "Menu profit", "Margin per item"),
      r("productmix", "/dashboard/product-mix", "Product mix", "What sells with what"),
    ],
  },
  {
    title: "Stock and suppliers",
    rows: [
      r("count", "/dashboard/count", "Count & waste", "The weekly count, waste, report, setup"),
      r("inventory", "/dashboard/operations/inventory", "Inventory", "Stock on hand and past counts"),
      r("ingredients", "/dashboard/ingredients", "Ingredients", "The catalogue and its prices"),
      r("vendors", "/dashboard/operations/vendors", "Vendors", "Who sells it, and for how much"),
      r("operations", "/dashboard/operations", "Operations", "Packaging and product usage"),
    ],
  },
  {
    title: "Admin",
    rows: [
      r("stores", "/dashboard/stores", "Stores", "Rent, commissions, COGS targets"),
      r("monitoring", "/dashboard/admin/monitoring", "Monitoring", "Developer-facing"),
    ],
  },
]
