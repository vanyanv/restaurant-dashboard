// scripts/verify-pagination-fix.ts
// Calls the patched fetchInvoiceEmails with a 7-day window to confirm it returns
// the ~20+ emails the production sync has been missing since 2026-03-30.
// Run with: npx tsx scripts/verify-pagination-fix.ts

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
  const { fetchInvoiceEmails } = await import("../src/lib/microsoft-graph")

  for (const days of [7, 30]) {
    const since = new Date()
    since.setDate(since.getDate() - days)
    console.log(`\n── ${days}-day window (since ${since.toISOString().slice(0, 10)}) ──`)
    const msgs = await fetchInvoiceEmails(since)
    console.log(`  returned ${msgs.length} emails with attachments`)
    for (const m of msgs.slice(0, 10)) {
      console.log(`    ${m.receivedDateTime.slice(0, 19).replace("T", " ")}  ${m.subject?.slice(0, 80) ?? "(no subject)"}`)
    }
    if (msgs.length > 10) console.log(`    ... and ${msgs.length - 10} more`)
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1) })
