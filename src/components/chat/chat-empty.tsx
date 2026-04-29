"use client"

interface Props {
  onSelect: (text: string) => void
}

const SUGGESTIONS = [
  "How were sales last week?",
  "What did we spend on produce in March?",
  "Top 5 items by revenue this month.",
]

/** First-paint state for the drawer. Fraunces italic headline + three
 * suggested prompts as toolbar-btn-style chips. No avatar, no rocket
 * emoji, no greeting. */
export function ChatEmpty({ onSelect }: Props) {
  return (
    <div className="chat-empty">
      <div className="chat-empty__intro">
        <div className="chat-drawer__dept">Ask · Owner Analyst</div>
        <div className="chat-empty__headline">Ask the ledger.</div>
        <p className="chat-empty__lead">
          Sales, costs, invoices, menu prices. Same numbers as the dashboard.
        </p>
      </div>
      <div className="chat-empty__suggestions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className="chat-empty__chip"
            onClick={() => onSelect(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
