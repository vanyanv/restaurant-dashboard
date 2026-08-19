"use client"

interface Props {
  onSelect: (text: string) => void
}

/** Prompts grouped by the desk that answers them. Each carries the tools it
 * will reach for, so the empty state doubles as a map of what the analyst can
 * actually see — the previous three chips said nothing about its range. */
const DEPARTMENTS: Array<{
  dept: string
  rows: Array<{ q: string; tools: string }>
}> = [
  {
    dept: "Sales",
    rows: [
      { q: "How were sales last week?", tools: "getDailySales · compareSales" },
      { q: "Which day of the week is weakest right now?", tools: "getDailySales · 8 weeks" },
      { q: "Split last month by platform", tools: "getPnlSummary · by channel" },
    ],
  },
  {
    dept: "Costs",
    rows: [
      { q: "What did we spend on produce last month?", tools: "searchInvoices · sumInvoiceLines" },
      { q: "Has ground beef gone up since June?", tools: "getIngredientPriceHistory" },
      { q: "Who is cheapest on american cheese?", tools: "compareVendorPrices" },
    ],
  },
  {
    dept: "Menu",
    rows: [
      { q: "What is the margin on the Double Slider?", tools: "getMenuMargin · getRecipeById" },
      { q: "Which menu items have the lowest margin?", tools: "rankRecipes" },
      { q: "Which recipes have no costed ingredients?", tools: "listIngredientGaps" },
    ],
  },
]

/** First-paint state for the thread and the drawer. A dated masthead, a lede,
 * then the prompts as ledger rows carrying the proofmark hover — the same
 * interaction contract as every other list on the dashboard. Closes with what
 * the analyst reads and what it will not do, so its limits are stated up front
 * rather than discovered by being refused. */
export function ChatEmpty({ onSelect }: Props) {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  })

  return (
    <div className="chat-empty">
      <div className="chat-empty__mast">
        <span className="chat-empty__mast-label">{today} · Late edition</span>
        <span className="chat-empty__mast-label">Owner analyst</span>
      </div>

      <h2 className="chat-empty__headline">Ask the ledger.</h2>
      <p className="chat-empty__lead">
        The same numbers as the dashboard, reached by question instead of by page.
        Every answer carries the tool it came from and the range it covers.
      </p>

      <div className="chat-empty__grid">
        {DEPARTMENTS.map((d) => (
          <div key={d.dept} className="chat-empty__sec">
            <div className="chat-empty__sec-head">
              <span className="chat-empty__dept">{d.dept}</span>
            </div>
            {d.rows.map((r) => (
              <button
                key={r.q}
                type="button"
                className="chat-prompt-row"
                onClick={() => onSelect(r.q)}
              >
                <span>
                  <span className="chat-prompt-row__q">{r.q}</span>
                  <span className="chat-prompt-row__tools">{r.tools}</span>
                </span>
                <span className="chat-prompt-row__go" aria-hidden>
                  Ask ›
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="chat-empty__reach">
        <div>
          <span className="chat-empty__reach-key">Reads</span>
          <span className="chat-empty__reach-val">
            sales · orders · invoices · recipes · ingredient prices · menu margin · ML forecasts
          </span>
        </div>
        <div>
          <span className="chat-empty__reach-key">Will not</span>
          <span className="chat-empty__reach-val">
            invent a number · read sentiment · give advice
          </span>
        </div>
      </div>
    </div>
  )
}
