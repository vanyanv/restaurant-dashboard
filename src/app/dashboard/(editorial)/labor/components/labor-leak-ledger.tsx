import type { Leak } from "@/lib/labor-leaks"

const usd0 = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`

/**
 * The three biggest labor problems of the week, largest dollar first, each
 * ending in something to actually do.
 *
 * The amounts are three different lenses on one week and overlap — an early
 * clock-in at 9am is also part of the 9am block — so they are deliberately not
 * summed and the footnote says so. A fake grand total would be the most
 * quotable number on the page and the least true.
 */
export function LaborLeakLedger({ leaks }: { leaks: Leak[] }) {
  if (leaks.length === 0) {
    return (
      <p className="labor-empty">
        Nothing flagged this week. Hours tracked the sales, and no punches ran
        past the schedule.
      </p>
    )
  }

  return (
    <>
      <ol className="labor-leaks">
        {leaks.map((leak, i) => (
          // The lead leak is set at display size. "Ranked by cost" has to be
          // visible in the typography, not just in the row order.
          <li key={leak.id} className="labor-leak" data-lead={i === 0}>
            <span className="labor-leak__rank">{i + 1}</span>
            <div className="labor-leak__body">
              <h3 className="labor-leak__title">{leak.title}</h3>
              <p className="labor-leak__evidence">{leak.evidence}</p>
              <p className="labor-leak__action">{leak.action}</p>
            </div>
            <div className="labor-leak__amount">
              <strong>{usd0(leak.amount)}</strong>
              <span>{leak.basis}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="labor-leaks__note">
        Three lenses on the same week. They overlap, so they don&rsquo;t add up
        to a total.
      </p>
    </>
  )
}
