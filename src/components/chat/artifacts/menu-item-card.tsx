"use client"

import type { MenuItemDetailsResult } from "@/lib/chat/tools/menu"
import { CardShell, Num, fmtMoney, fmtCount } from "./card-shell"

interface Props {
  details: MenuItemDetailsResult
  collapsedDefault?: boolean
}

export function MenuItemCard({ details, collapsedDefault }: Props) {
  return (
    <CardShell
      dept="MENU ITEM"
      headline={
        <span className="chat-artifact__title-italic">{details.itemName}</span>
      }
      subline={
        <>
          <span>{details.store}</span>
          <span> · {details.category}</span>
          {details.currentPrice !== null ? (
            <span>
              {" "}
              · current <Num>{fmtMoney(details.currentPrice)}</Num>
            </span>
          ) : null}
        </>
      }
      footerHref="/dashboard/menu/catalog"
      defaultOpen={!collapsedDefault}
    >
      <div className="chat-artifact__stat-strip">
        <Stat label="Total qty" value={fmtCount(details.totalQty)} />
        <Stat label="Total revenue" value={fmtMoney(details.totalRevenue)} />
        <Stat label="Days w/ sales" value={fmtCount(details.daysWithSales)} />
        <Stat
          label="Window"
          value={
            details.firstSeen && details.lastSeen
              ? `${details.firstSeen} → ${details.lastSeen}`
              : "—"
          }
        />
      </div>
      <div className="chat-artifact__table-wrap">
        <table className="chat-artifact__table">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Qty</th>
              <th className="num">Revenue</th>
              <th className="num">Avg price</th>
            </tr>
          </thead>
          <tbody>
            {details.daily.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td className="num">
                  <Num>{fmtCount(d.qty)}</Num>
                </td>
                <td className="num">
                  <Num>{fmtMoney(d.revenue)}</Num>
                </td>
                <td className="num">
                  <Num>{d.avgPrice !== null ? fmtMoney(d.avgPrice) : "—"}</Num>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
