// scripts/probe-mailbox.ts
// Diagnose why recent sync runs reported 0 emails scanned.
// Tests multiple Graph query shapes to see what's actually in the mailbox.

import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvLocal()

const GRAPH_BASE = "https://graph.microsoft.com/v1.0"

async function getToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }).toString(),
    }
  )
  const data = await res.json()
  return data.access_token as string
}

interface Msg {
  id: string
  subject: string | null
  receivedDateTime: string
  hasAttachments: boolean
  from?: { emailAddress?: { address?: string } }
}

async function query(url: string, token: string, label: string): Promise<Msg[] | null> {
  console.log(`\n── ${label} ──`)
  console.log(`  URL: ${url.replace(encodeURIComponent(process.env.MICROSOFT_MAIL_USER_ID!), "<mailbox>")}`)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    console.log(`  ✗ FAILED (${res.status}): ${(await res.text()).slice(0, 200)}`)
    return null
  }
  const data = await res.json()
  const msgs = (data.value ?? []) as Msg[]
  console.log(`  ✓ Returned ${msgs.length} messages`)
  return msgs
}

function printMsgs(msgs: Msg[], limit: number = 15): void {
  for (const m of msgs.slice(0, limit)) {
    const from = m.from?.emailAddress?.address ?? "?"
    const att = m.hasAttachments ? "📎" : "  "
    console.log(`    ${att} ${m.receivedDateTime.slice(0, 19).replace("T", " ")}  ${from.padEnd(38).slice(0, 38)}  ${(m.subject ?? "").slice(0, 55)}`)
  }
}

async function main() {
  const userId = process.env.MICROSOFT_MAIL_USER_ID!
  const encodedUser = encodeURIComponent(userId)
  const token = await getToken()
  console.log(`Mailbox: ${userId}`)
  console.log(`Today: ${new Date().toISOString()}`)

  // ── A: Most recent ALL emails (no filter, orderby desc) ──
  // This should show if the mailbox is receiving ANY mail at all.
  const qA = `${GRAPH_BASE}/users/${encodedUser}/messages?$orderby=receivedDateTime desc&$select=id,subject,receivedDateTime,from,hasAttachments&$top=15`
  const msgsA = await query(qA, token, "A. Most recent 15 emails (any attachment status)")
  if (msgsA) printMsgs(msgsA)

  // ── B: Filter hasAttachments eq true, no orderby (same as production sync) ──
  const qB = `${GRAPH_BASE}/users/${encodedUser}/messages?$filter=hasAttachments eq true&$select=id,subject,receivedDateTime,from,hasAttachments&$top=15`
  const msgsB = await query(qB, token, "B. First 15 with attachments (filter only, NO orderby — same query shape as sync)")
  if (msgsB) printMsgs(msgsB)

  // ── C: Filter hasAttachments eq true + orderby (known to hit InefficientFilter, confirm) ──
  const qC = `${GRAPH_BASE}/users/${encodedUser}/messages?$filter=hasAttachments eq true&$orderby=receivedDateTime desc&$select=id,subject,receivedDateTime,from,hasAttachments&$top=15`
  await query(qC, token, "C. Filter + orderby combination (expected to fail with InefficientFilter)")

  // ── D: Date filter >= 2026-03-30, orderby desc ──
  const qD = `${GRAPH_BASE}/users/${encodedUser}/messages?$filter=receivedDateTime ge 2026-03-30T00:00:00Z&$orderby=receivedDateTime desc&$select=id,subject,receivedDateTime,from,hasAttachments&$top=50`
  const msgsD = await query(qD, token, "D. All emails since 2026-03-30 (date filter + orderby desc)")
  if (msgsD) {
    printMsgs(msgsD, 30)
    const withAtt = msgsD.filter((m) => m.hasAttachments)
    console.log(`\n  → ${msgsD.length} total emails since 2026-03-30, of which ${withAtt.length} have attachments.`)
  }
}

main().catch((e) => {
  console.error("Fatal:", e)
  process.exit(1)
})
