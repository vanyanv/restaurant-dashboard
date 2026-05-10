# Design Brief — External-Signals Strip

_Date: 2026-05-09_
_Output of `$impeccable shape`. Companion to the audit at `2026-05-09-dashboard-audit.md`._

---

## 1. Feature Summary

A horizontal, three-row strip surfacing the three external signals already wired to Postgres but currently buried in tooltip drivers: weather (Open-Meteo), events (PredictHQ), and labor pressure (Harri + ML forecast). Lives above the `<ForecastsRibbon />` so every forecasts tab inherits the context. Built mid-fi for `/dashboard/forecasts` only on the first pass; cross-route reuse and high-fi polish follow once the layout is validated against real operator behavior.

## 2. Primary User Action

Glance at the next 7 days and immediately understand which days will need attention — and *why*. The Strip should answer "is this Sunday going to be quiet or chaotic?" before the operator opens any forecast tab.

## 3. Design Direction

- **Color strategy:** Restrained. PRODUCT.md and DESIGN.md establish the editorial-docket palette. The Strip uses `--ink`, `--ink-muted`, `--ink-faint`, `--paper-deep` for chrome; `--accent` only for state (high-severity weather, near-term high-impact events, understaffed days). No new tokens introduced.
- **Theme scene:** "An owner stands at a back-office monitor on Monday morning at 7am, scanning the week's docket the way a deputy editor scans the paper before press: weather strip on top like the front-page lede, events like the cultural section, labor like the production schedule." This sentence forces light theme — cream paper, late-edition broadsheet logic.
- **Anchor references:**
  1. The week-at-a-glance strip on the inside cover of *Monocle* — single-row table, hairline rules, names rendered with weight, peripheral data in mono caption.
  2. NYT's "Today's Front Page" archive thumbnail strip — date-keyed, scannable left-to-right, no chrome.
  3. The existing `forecasts-briefing.tsx` — same typographic family, same restraint, same `dock-in` reveal cadence. The Strip should feel like a sibling artifact, not a new module.

## 4. Scope

- **Fidelity:** Mid-fi. Working component shipped to `/dashboard/forecasts`; iteration follows operator feedback rather than upfront polish.
- **Breadth:** One surface (above `<ForecastsRibbon />`). No cross-route reuse in v1.
- **Interactivity:** Static-render (no animation choreography beyond the existing `dock-in` stagger). Each cell is a `<button>` that opens a day-detail dialog (deferred to v2 if dialog work isn't trivial).
- **Time intent:** Two to three days. Ship, observe, iterate.

## 5. Layout Strategy

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  EXT § THIS WEEK · MAY 09–15 · WORST-OF-PORTFOLIO          [Single store ▾] │
├──────────────────────────────────────────────────────────────────────────────┤
│  WEATHER  │  Wed  │  Thu  │  Fri  │  SAT  │  Sun  │  Mon  │  Tue           │
│           │  ☀ Cl │  ☀ Cl │  ⛅ Pc │  ⛈ Tn │  ☁ Ov │  🌧 Rn│  ☀ Cl          │
├───────────┼───────┼───────┼───────┼───────┼───────┼───────┼─────────────────┤
│  EVENTS   │  —    │  —    │  —    │ Lakers v Warriors │ — │ —             │
│           │       │       │       │ 18k · #88         │   │               │
│           │       │       │       │ +2 concerts ·1 fest│  │               │
├───────────┼───────┼───────┼───────┼───────┼───────┼───────┼─────────────────┤
│  LABOR    │  bal  │  bal  │  bal  │  thin │  bal  │  bal  │  bal           │
│           │       │       │       │ ▲ 3   │       │       │                │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Container:** `.inv-panel` with `padding: 14px 18px`. Lives above the existing briefing card. `dock-in dock-in-1` so it lands first.
- **Header:** A single line above the table: `EXT § THIS WEEK · MAY 09–15 · <SCOPE>` left-aligned in JetBrains Mono caption (`var(--ink-faint)`), with the store-picker control right-aligned. Scope reads "Worst-of-portfolio" when no store is selected, "<Store name>" otherwise.
- **Grid:** 8 columns. Column 1 is the row label (uppercase JetBrains Mono in `var(--ink-muted)`, 80px fixed). Columns 2–8 are the seven days, each minmax(80px, 1fr). Border is `1px solid var(--hairline)` on row tops; column dividers are NOT drawn (whitespace separates).
- **Day labels:** Day-of-week in JetBrains Mono caption above each column. Today is bold + `var(--ink)`; future days `var(--ink-muted)`. The day with the highest combined severity (storm + event + thin) renders the day label in `--accent`, all caps — the editorial proofmark of "watch this day."
- **Per-row content:**
  - **Weather:** WMO icon + 2-letter abbreviation ("Cl", "Pc", "Tn", etc.) in DM Sans 13px. Severity-tinted: WMO 95/96/99 (storms) render the cell text in `var(--accent)`; codes 71+ (snow) and 80+ (rain showers) in `var(--ink)` semibold; clear/cloudy in `var(--ink-muted)`.
  - **Events:** Top 1 event by `localRank` rendered as: event title in DM Sans 13px (truncates with ellipsis), attendance + `#localRank` on a second line in `var(--ink-muted)` 11px tabular, then category-count line in JetBrains Mono caption ("+2 concerts · 1 fest"). Events with `localRank ≥ 80` get `var(--accent)` on the title line. Cell with no events renders a single `var(--ink-faint)` em-dash.
  - **Labor:** A short pressure label ("bal", "thin", "heavy", "—" for missing schedule) in DM Sans 13px. "thin" and "—" render in `var(--accent)`; "heavy" in `var(--ink)` semibold. When `understaffed` count >0 across portfolio, an `▲ N` proofmark appears below the label in mono caption.

## 6. Key States

| State | What the user sees |
|---|---|
| **Default** | Strip populated with 7 days of data. ~80% of weeks will have one or two days with named events; rest show em-dashes. |
| **Empty (no signals at all)** | Strip COLLAPSES — entirely hidden from DOM. Operator should not see a useless three-row grid of em-dashes. Trigger: zero StoreEventSignal rows + zero StoreWeatherSignal rows in the date range. (Labor data is always present.) |
| **Loading** | Skeleton renders with three rows of `var(--paper-deep)` blocks at the cell heights. Reuses existing `ForecastSectionFallback` skeleton pattern. |
| **Error (data fetch failure)** | Strip renders the chrome (header + row labels) but cells show "—" with a small JetBrains Mono caption beneath the strip: "external signals offline · refreshed 2h ago". The operator is told the Strip exists but can't be trusted right now; they don't lose the rest of the page. |
| **Single store with no schedule** | Labor row shows "no schedule" in `var(--ink-faint)` for affected days. Other rows render normally. |
| **Today is the worst day** | Today's day label gets the `--accent` proofmark per the rule above. The `dock-in` stagger animates today's column last (visual emphasis without animation excess). |
| **Reduced motion** | `prefers-reduced-motion: reduce` disables the `dock-in` stagger entirely — Strip renders instantly. No exceptions. |

## 7. Interaction Model

- **Cell click:** Each cell is a `<button>` (semantic — full keyboard reach). On click, opens a day-detail dialog showing the full event list for that day, raw weather summary (high/low temp, wind, precipitation), and the day's per-store labor breakdown. **Dialog deferred to v2 if it slows v1.** v1 cells can be non-interactive if dialog isn't ready.
- **Cell hover/focus:** Cell background washes to `var(--row-hover-bg)` (the new token). No transform, no shadow. The day label above the hovered cell goes to `var(--ink)` semibold to confirm focus.
- **Store-picker:** Reuses the existing `<ForecastsStorePicker />` — exact same control, just rendered inline in the Strip header alongside the existing one in the page topbar. (Open question: dedupe these into a single picker or accept the redundancy for the v1 sketch.)
- **Per-day click on a "watch this day" day:** Smooth scrolls (`scroll: "smooth"` per `prefers-reduced-motion`) to the corresponding card lower on the page that explains why — labor card if `thin`, events row if `localRank ≥ 80`, etc. Deferred to v2.

## 8. Content Requirements

- **Header text:** `EXT §`, `THIS WEEK`, date range, scope label. All static except date range and scope.
- **Row labels:** `WEATHER`, `EVENTS`, `LABOR`. Uppercase, JetBrains Mono.
- **Weather labels:** 2-letter codes for the top-12 WMO codes seen in real data — `Cl, Pc, Ov, Fg, Rn, Sn, Tn, Hz, Bl, Sl, Iy, Cm`. Map in `src/lib/weather-labels.ts` (new file).
- **Event title:** Pulled directly from `StoreEventDetailSignal.title`. Truncate at 24 chars with ellipsis. No editorialisation — names are facts.
- **Attendance format:** `<rounded thousands>k` (e.g., 18000 → "18k", 2400 → "2.4k"). Round to one decimal below 10k, integer above.
- **Pressure labels:** `bal`, `thin`, `heavy`, `—`. The "—" carries meaning so promote to `var(--ink-muted)` minimum, never `var(--ink-faint)` (per the audit's a11y note).
- **Empty-day cell:** A single `—` in `var(--ink-faint)`. This one is genuinely decorative — the absence of data, not data itself.
- **Error caption:** `external signals offline · refreshed <relative time>`. Relative time computed from `max(syncedAt)` across the three signal tables.

## 9. Recommended References

For implementation:
- **Reuse existing utilities:** `forecasts-briefing.tsx` (typography patterns, `dock-in` cadence), `labor-staffing-actions.ts:192–211` (the existing query against `storeWeatherSignal`/`storeEventSignal`/`storeEventDetailSignal` — extract into a shared `src/lib/external-signals.ts` helper instead of duplicating).
- **New shared helper file:** `src/lib/external-signals.ts` exporting `getExternalSignals(storeIds, dateRange) → { weather, events, labor }`.
- **New WMO label map:** `src/lib/weather-labels.ts` (12 codes → 2-letter + icon glyph + severity tone).
- **Component file:** `src/app/dashboard/forecasts/components/external-signals-strip.tsx`.
- **CSS:** No new tokens needed. Strip uses the existing palette + the `--row-hover-bg` token added during the polish sweep.

## 10. Open Questions

- **Store-picker redundancy.** The forecasts page topbar already has a `ForecastsStorePicker`. Should the Strip's header re-render the picker (clearer scope at the Strip level) or read the existing URL param silently (less duplication)? Recommend the latter for v1 — the Strip becomes header-less below the masthead, just shows scope label inline.
- **Day-detail dialog.** v1 ships without; v2 adds. Acceptable trade-off, but the cells are weaker affordances without it. Decision deferred to operator feedback.
- **Severity rules need real-data tuning.** "WMO ≥ 71 = bold" and "localRank ≥ 80 = accent" are both reasonable initial cutoffs, but they should be reviewed against a week of actual signals before they're written into stone. Tune in week 2.
- **Combined-severity scoring for the "worst day" proofmark.** The rule needs a deterministic function: storm-weather (+3), high-impact event (+2), thin labor (+1) — sum, top score wins, ties go to the later day in the week. Document the function in the `external-signals.ts` helper.

---

**Stop here.** Per impeccable shape rules, the brief needs explicit user confirmation before craft. Reply "approved" (or with edits) and I'll move to implementation; reply with changes and I'll revise.
