// scripts/test-price-alert-email.ts
// Sends a synthetic price-alert email via Microsoft Graph to verify
// (a) the Mail.Send permission is set up, and
// (b) the HTML template renders readably.
// Run with: npx tsx scripts/test-price-alert-email.ts

import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue
    const i = t.indexOf("="); if (i === -1) continue
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()

async function main() {
  const { sendGraphMail } = await import("../src/lib/graph-mail")
  const { buildPriceAlertEmail } = await import("../src/lib/price-alert-email")

  const recipient = process.env.PRICE_ALERT_EMAIL || process.env.OTTER_EMAIL
  if (!recipient) {
    console.error("Set PRICE_ALERT_EMAIL or OTTER_EMAIL in .env.local before running.")
    process.exit(2)
  }
  console.log(`Recipient: ${recipient}`)
  console.log(`Sender (MICROSOFT_MAIL_USER_ID): ${process.env.MICROSOFT_MAIL_USER_ID}\n`)

  const hikes = [
    {
      vendorName: "Sysco",
      productName: "WHLFCLS ICE CREAM MIX SFTSR VAN 5%",
      sku: "7087727",
      category: "Dairy",
      unit: "CS",
      prevPrice: 37.26,
      prevDate: new Date("2026-03-19"),
      latestPrice: 41.50,
      latestDate: new Date("2026-04-18"),
      pctChange: 11.4,
      invoiceNumber: "945819855",
    },
    {
      vendorName: "Premier Meats & Crystal Bay",
      productName: "GROUND BEEF FINE GRND 73/27 CREEKSTONE",
      sku: null,
      category: "Meat",
      unit: "LB",
      prevPrice: 4.25,
      prevDate: new Date("2026-04-06"),
      latestPrice: 4.55,
      latestDate: new Date("2026-04-18"),
      pctChange: 7.1,
      invoiceNumber: "2250815",
    },
  ]

  const { subject, html } = buildPriceAlertEmail(hikes)
  console.log(`Subject: ${subject}`)
  console.log(`HTML size: ${html.length} bytes\n`)

  const result = await sendGraphMail({ toEmail: recipient, subject, html })
  if (result.sent) {
    console.log(`✓ Email sent successfully to ${recipient}.`)
  } else {
    console.error(`✗ Send failed: ${result.error}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
