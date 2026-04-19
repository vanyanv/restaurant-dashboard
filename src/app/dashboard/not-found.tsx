import Link from "next/link"
import { EditorialTopbar } from "./components/editorial-topbar"

const SUGGESTIONS: Array<{ label: string; href: string; index: string }> = [
  { label: "Sales overview", href: "/dashboard", index: "I" },
  { label: "Orders", href: "/dashboard/orders", index: "II" },
  { label: "Recipes", href: "/dashboard/recipes", index: "III" },
  { label: "Invoices", href: "/dashboard/invoices", index: "IV" },
  { label: "Settings", href: "/dashboard/settings", index: "V" },
]

export default function DashboardNotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <EditorialTopbar section="§ —" title="Out of circulation" />
      <div className="missing-dispatch">
        <div className="dispatch-issue">Vol. 01 · A page is missing</div>
        <div className="dispatch-rule" aria-hidden="true" />
        <div className="dispatch-bracket" aria-hidden="true">
          <span>&#x2e27;</span>
          <span>&#x2e28;</span>
        </div>
        <div className="dispatch-number">404</div>
        <h1 className="dispatch-title">
          This page is <em>out of circulation</em>.
        </h1>
        <p className="dispatch-caption">
          The dispatch you asked for isn&rsquo;t in this week&rsquo;s issue.
          It may have been renamed, withdrawn, or never went to press. Try
          one of the sections below — all are current.
        </p>

        <nav className="dispatch-bibliography" aria-label="Suggested pages">
          <div className="bibliography-label">In this issue</div>
          {SUGGESTIONS.map((row) => (
            <Link
              key={row.href}
              href={row.href}
              className="bibliography-row"
            >
              <span className="biblio-number">{row.index}</span>
              <span>{row.label}</span>
              <span className="biblio-dots" aria-hidden="true" />
              <span className="biblio-number">→</span>
            </Link>
          ))}
        </nav>

        <div className="dispatch-actions">
          <Link href="/dashboard" className="editorial-submit">
            Return to the front page
          </Link>
        </div>
      </div>
    </div>
  )
}
