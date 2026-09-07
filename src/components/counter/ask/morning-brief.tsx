"use client"

import type { AskSignal } from "@/lib/counter/adapters/ask-brief"

/**
 * THE MORNING BRIEF — the empty Ask, as the "Ask in Motion II" mock draws it.
 *
 *   SINCE SATURDAY · 3 THINGS MOVED
 *   Good morning, Chris.
 *   Three things changed since you were last here. Each one is a question…
 *   ┌ ● Saturday sales   $4,120  −12% vs prior Sat   Why was Saturday down?  → ┐
 *   │ ● Ground beef      $4.62/lb +$0.42 on Aug 21   Which recipes does…     → │
 *   └ ● Invoices         3 in review                 Which invoices do not…  → ┘
 *   OR START FROM  [P&L] [Sales] [Forecast] [Invoices] [Ingredients] [Inventory]
 *
 * Pure presentation. The signals come from `loadAskBrief` through a
 * `Section`, so this component never sees a loading or failed state — the
 * page decides what an empty brief looks like (the starters alone). Each row
 * is one button whose whole face is the question: the figure explains why
 * the question is worth asking, the arrow says pressing it asks.
 *
 * Motion is the least on the page — this screen is seen every morning. The
 * rows enter once in reading order (`.sig.in`, 300ms, 60ms apart); hover
 * slides the arrow 3px. Nothing else moves.
 */
export function MorningBrief({
  greeting,
  since,
  signals,
  onAsk,
}: {
  /** "Good morning, Chris." — decided on the server, in the store's own clock. */
  greeting: string
  /** "Since Saturday" — the last visit, or the last sync when there was none. */
  since: string
  signals: AskSignal[]
  onAsk: (question: string) => void
}) {
  const n = signals.length
  return (
    <div className="morning">
      <div>
        <div className="sub">
          {since} · <b>{n === 1 ? "1 thing moved" : `${n} things moved`}</b>
        </div>
        <h2>{greeting}</h2>
      </div>
      <p>
        {n === 1 ? "One thing changed" : `${["", "One", "Two", "Three"][n] ?? n} things changed`}{" "}
        since you were last here. Each one is a question you can ask as it is, or type your own
        below.
      </p>
      <div className="signals">
        {signals.map((s, i) => (
          <button
            type="button"
            className="sig in"
            style={{ animationDelay: `${i * 60}ms` }}
            key={s.id}
            onClick={() => onAsk(s.question)}
          >
            <span className="fig">
              <span className="k">
                <i className={s.tone} />
                {s.label}
              </span>
              <span className="v">
                {s.value}
                {s.delta ? <em className={s.tone}>{s.delta}</em> : null}
              </span>
            </span>
            <span className="q">
              {s.question}
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** The six department starters, as one chip row under the brief. */
export function StarterChips({
  starters,
  onAsk,
}: {
  starters: ReadonlyArray<{ dept: string; q: string }>
  onAsk: (question: string) => void
}) {
  return (
    <div className="starts">
      <span className="lbl">Or start from</span>
      {starters.map(({ dept, q }) => (
        <button className="sug" type="button" key={q} title={q} onClick={() => onAsk(q)}>
          {dept}
        </button>
      ))}
    </div>
  )
}
