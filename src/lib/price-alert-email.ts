export interface PriceHike {
  vendorName: string
  productName: string
  sku: string | null
  category: string | null
  unit: string | null
  prevPrice: number
  prevDate: Date
  latestPrice: number
  latestDate: Date
  pctChange: number
  invoiceNumber: string
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtPct(p: number): string {
  const sign = p >= 0 ? "+" : ""
  return `${sign}${p.toFixed(1)}%`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Build a consolidated HTML email body summarizing price increases detected during
 * the most recent invoice sync. One email covers all hikes in the batch.
 */
export function buildPriceAlertEmail(hikes: PriceHike[]): {
  subject: string
  html: string
} {
  // Subject: aggregate per vendor so the preview shows which suppliers moved
  const byVendor = new Map<string, number>()
  for (const h of hikes) {
    byVendor.set(h.vendorName, (byVendor.get(h.vendorName) ?? 0) + 1)
  }
  const vendorSummary = Array.from(byVendor.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `${v} +${n}`)
    .join(", ")
  const subject = `Price increases on ${hikes.length} product${hikes.length === 1 ? "" : "s"} (${vendorSummary})`

  const rows = hikes
    .map((h) => {
      const dollarDelta = h.latestPrice - h.prevPrice
      const dateGapDays = Math.round(
        (h.latestDate.getTime() - h.prevDate.getTime()) / (1000 * 60 * 60 * 24)
      )
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">
            <strong>${escapeHtml(h.vendorName)}</strong><br/>
            <span style="color:#888;font-size:12px;">Invoice ${escapeHtml(h.invoiceNumber)}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">
            ${escapeHtml(h.productName)}<br/>
            <span style="color:#888;font-size:12px;">${h.sku ? "SKU " + escapeHtml(h.sku) : ""}${h.unit ? " · " + escapeHtml(h.unit) : ""}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">
            ${fmtUsd(h.prevPrice)}<br/>
            <span style="color:#888;font-size:12px;">${fmtDate(h.prevDate)}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">
            <strong>${fmtUsd(h.latestPrice)}</strong><br/>
            <span style="color:#888;font-size:12px;">${fmtDate(h.latestDate)}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">
            <strong style="color:#c0392b;">${fmtPct(h.pctChange)}</strong><br/>
            <span style="color:#888;font-size:12px;">+${fmtUsd(dollarDelta)} · ${dateGapDays}d gap</span>
          </td>
        </tr>`
    })
    .join("")

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#222;margin:0;padding:24px;background:#f7f7f8;">
<div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;">
  <div style="padding:20px 24px;border-bottom:1px solid #eee;">
    <h2 style="margin:0;font-size:18px;">Price increases detected on ${hikes.length} product${hikes.length === 1 ? "" : "s"}</h2>
    <p style="margin:6px 0 0;color:#666;font-size:14px;">Based on invoices synced in the last run. Threshold: 5% increase vs the prior order.</p>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead>
      <tr style="background:#fafafa;">
        <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #eee;font-weight:600;">Vendor</th>
        <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #eee;font-weight:600;">Product</th>
        <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #eee;font-weight:600;">Prev price</th>
        <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #eee;font-weight:600;">Latest price</th>
        <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #eee;font-weight:600;">Change</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="padding:16px 24px;color:#666;font-size:13px;border-top:1px solid #eee;">
    Open the dashboard to see all price movers and historical trends.
  </div>
</div>
</body></html>`

  return { subject, html }
}
