"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { activePhoneTab, PHONE_TABS, type PhoneTab } from "@/lib/counter/phone-tabs"

/**
 * `.mtabs` — the phone's bottom bar, which this product did not have.
 *
 * The prototype builds it in `phoneFor()` (line 8738) as the last child of
 * `.pframe`, and `counter-components.css` already carried every rule for it
 * (`.mtabs`, `.mtab`, `.mtab--ask .bub`) from the day the sheet was extracted.
 * Nothing rendered them. What the phone drew instead was the pre-Counter
 * `MobileTabBar` — five lucide glyphs in a `--paper` bar, labelled
 * Home / Count / Invoices / Orders / More — so the surface a reader touches on
 * every single screen was the one piece of the old design that had never been
 * replaced, and the raised Ask disc that is the phone's answer to ⌘K did not
 * exist at all.
 *
 * The phone crossover spec under `e2e/mobile/` says so in its own docblock:
 * "The old design cannot be unloaded from these routes until that tab bar is
 * rebuilt in Counter, and that is a design job rather than a bug fix." This is
 * that job. (Its filename is not spelled out here on purpose — this file opens
 * a Counter token root, and `tests/styles/token-parity.test.ts` sweeps every
 * such file for the old design's name.)
 *
 * ## Ported, not re-drawn
 *
 * The markup is the prototype's: a `.mtab` is an icon over a mono label, the
 * middle one is `.mtab--ask` with its glyph inside a `.bub`. The icons are the
 * prototype's own 16-box paths rather than lucide — `PHONE_TAB_ICONS` below
 * transcribes `IC.grid`, `IC.clip`, `IC.ask`, `IC.doc` and `IC.more`. A lucide
 * substitute would be a different drawing at a different weight in the one
 * place on the phone where five glyphs sit in a row and have to agree.
 *
 * `<Link>` rather than the prototype's `<button data-goto>`, the same trade
 * `MList` and `PhoneBack` make: an anchor gets middle-click, "open in new
 * tab", the correct role and keyboard activation for free, and `.mtab` styles
 * one unchanged.
 *
 * ## The window travels
 *
 * Tab links carry the current query string. Every Counter figure is a claim
 * about a window, and a bar that dropped `?range=` would silently reset the
 * range each time a reader moved between Today and Invoices — the same defect
 * as note 42 ("a range that only changes the label is a lie"), one level up.
 * `PhoneShell`'s controls write those parameters; this bar preserves them.
 */
export function MTabs() {
  const pathname = usePathname() ?? "/m"
  const searchParams = useSearchParams()
  const active = activePhoneTab(pathname)
  const qs = searchParams?.toString() ?? ""

  /*
   * The editorial chat draws its own full-height shell (`.m-chat-shell`,
   * `position:fixed`, its own composer against the bottom edge) and the bar it
   * replaced hid itself there for that reason. Kept, unchanged: this is not
   * the surface to change while replacing the bar under it.
   */
  if (pathname === "/m/chat" || pathname.startsWith("/m/chat/")) return null

  /*
   * THE TOKEN ROOT TRAVELS WITH THE BAR, and that is not decoration.
   *
   * `.mtabs` reads `--chrome`, `--line` and `--accent`, which the alias layer
   * declares only on a Counter root. This bar is mounted by
   * `src/app/(mobile)/m/layout.tsx`, which is still the pre-Counter shell and
   * loads its stylesheets. Opening the root THERE would have put the old
   * design and a Counter root in one file, which
   * `tests/styles/token-parity.test.ts` fails on by design: every file that
   * can open one must be free of the old design, so that nothing of it is
   * ever rendered inside a root reading an unprefixed token the alias layer
   * has re-answered with a Counter value.
   *
   * Owning the root here keeps that true. The wrapper is a SIBLING of the old
   * shell's roots and never an ancestor — custom properties inherit downward
   * only — and its whole subtree is this file's ported markup. It holds
   * nothing but a fixed element, so it takes no space in the flow.
   */
  return (
    <div className="ct-root ct-phone">
      <nav className="mtabs" aria-label="Primary">
        {PHONE_TABS.map((tab) => (
          <MTab key={tab.id} tab={tab} on={tab.id === active} qs={qs} />
        ))}
      </nav>
    </div>
  )
}

function MTab({ tab, on, qs }: { tab: PhoneTab; on: boolean; qs: string }) {
  const href = qs ? `${tab.href}?${qs}` : tab.href
  const icon = <TabIcon name={tab.icon} />

  /*
   * The raised disc never takes `.on`. In the prototype it is drawn from
   * `t.mid` before the active branch is reached, so it is accent-coloured on
   * every screen and says nothing about where you are — it is an action, not
   * a location. `aria-current` still marks it when Ask IS the page, because
   * "this is an action" is a visual decision and not one to make for a screen
   * reader.
   */
  if (tab.mid) {
    return (
      <Link
        className="mtab mtab--ask"
        href={href}
        aria-current={on ? "page" : undefined}
      >
        <span className="bub">{icon}</span>
        <span>{tab.label}</span>
      </Link>
    )
  }

  return (
    <Link
      className={`mtab${on ? " on" : ""}`}
      href={href}
      aria-current={on ? "page" : undefined}
    >
      {icon}
      <span>{tab.label}</span>
    </Link>
  )
}

/**
 * `IC.grid`, `IC.clip`, `IC.ask`, `IC.doc` and `IC.more`, transcribed from the
 * prototype's icon map (line 2928) with its own `svg()` attributes: a 16-box,
 * `fill:none`, `currentColor` at 1.5, round caps and joins.
 */
const PHONE_TAB_ICONS: Record<PhoneTab["icon"], React.ReactNode> = {
  grid: (
    <>
      <rect x="2" y="2" width="5" height="6" rx="1" />
      <rect x="9" y="2" width="5" height="4" rx="1" />
      <rect x="2" y="10" width="5" height="4" rx="1" />
      <rect x="9" y="8" width="5" height="6" rx="1" />
    </>
  ),
  clip: (
    <>
      <rect x="4" y="3" width="8" height="11" rx="1.4" />
      <path d="M6.2 3V2.2h3.6V3" />
      <path d="M6.4 7h3.2M6.4 9.6h2" />
    </>
  ),
  ask: (
    <>
      <path d="M13.5 9.5a1.6 1.6 0 01-1.6 1.6H5.6L2.5 13.8V4.1a1.6 1.6 0 011.6-1.6h7.8a1.6 1.6 0 011.6 1.6z" />
      <path d="M6 6.4h4M6 8.6h2.4" />
    </>
  ),
  doc: (
    <>
      <path d="M3.5 2h9v12l-2-1.2L8.5 14 6.5 12.8 4.5 14 3.5 13.2z" />
      <path d="M6 5.5h4M6 8h4" />
    </>
  ),
  more: <path d="M3 5h10M3 8h10M3 11h10" />,
}

function TabIcon({ name }: { name: PhoneTab["icon"] }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PHONE_TAB_ICONS[name]}
    </svg>
  )
}
