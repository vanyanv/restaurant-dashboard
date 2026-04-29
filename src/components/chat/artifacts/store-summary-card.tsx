"use client"

import type { StoreBreakdownRow } from "@/lib/chat/tools/store-summary"
import { CardShell, Num, fmtMoney, fmtCount, fmtPct } from "./card-shell"

interface Props {
  row: StoreBreakdownRow
  collapsedDefault?: boolean
  /** When true, the card frame paints a red proofmark left-bar — the store
   *  the assistant is answering about. */
  isHighlighted?: boolean
}

export function StoreSummaryCard({ row, collapsedDefault, isHighlighted }: Props) {
  return (
    <CardShell
      dept="STORE"
      isHighlighted={isHighlighted}
      headline={
        <span className="chat-artifact__title-italic">{row.storeName}</span>
      }
      subline={
        <>
          <span>
            gross <Num>{fmtMoney(row.gross)}</Num>
          </span>
          <span>
            {" "}
            · share <Num>{fmtPct(row.share)}</Num>
          </span>
          <span>
            {" "}
            · <Num>{fmtCount(row.count)}</Num> orders
          </span>
        </>
      }
      footerHref="/dashboard/analytics"
      defaultOpen={!collapsedDefault}
    >
      <div className="chat-artifact__stat-strip">
        <Stat label="Gross" value={fmtMoney(row.gross)} />
        <Stat label="Net" value={fmtMoney(row.net)} />
        <Stat label="Orders" value={fmtCount(row.count)} />
        <Stat label="Share" value={fmtPct(row.share)} />
      </div>
      {row.platforms.length > 0 ? (
        <div className="chat-artifact__table-wrap">
          <table className="chat-artifact__table">
            <thead>
              <tr>
                <th>Platform</th>
                <th className="num">Gross</th>
                <th className="num">Net</th>
                <th className="num">Orders</th>
              </tr>
            </thead>
            <tbody>
              {row.platforms.map((p) => (
                <tr key={p.platform}>
                  <td>{p.platform}</td>
                  <td className="num">
                    <Num>{fmtMoney(p.gross)}</Num>
                  </td>
                  <td className="num">
                    <Num>{fmtMoney(p.net)}</Num>
                  </td>
                  <td className="num">
                    <Num>{fmtCount(p.count)}</Num>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </CardShell>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="chat-artifact__stat">
      <span className="chat-artifact__stat-label">{label}</span>
      <Num>
        <span className="chat-artifact__stat-value">{value}</span>
      </Num>
    </div>
  )
}
