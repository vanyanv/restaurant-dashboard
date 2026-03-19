// scripts/test-graph-email.ts
// Run with: npx tsx scripts/test-graph-email.ts
// Tests Microsoft Graph API: auth → list emails with attachments → download first PDF

import fs from "fs"
import path from "path"

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return {}
  const content = fs.readFileSync(envPath, "utf-8")
  const result: Record<string, string> = {}
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
    result[key] = val
  }
  return result
}

const env = loadEnvLocal()

const TENANT_ID = env["MICROSOFT_TENANT_ID"]
const CLIENT_ID = env["MICROSOFT_CLIENT_ID"]
const CLIENT_SECRET = env["MICROSOFT_CLIENT_SECRET"]
const MAIL_USER = env["MICROSOFT_MAIL_USER_ID"]

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !MAIL_USER) {
  console.error("Missing env vars. Need: MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_MAIL_USER_ID")
  process.exit(1)
}

const GRAPH_BASE = "https://graph.microsoft.com/v1.0"

async function getToken(): Promise<string> {
  console.log("=== Step 1: Acquiring access token (fresh) ===")
  console.log(`Tenant: ${TENANT_ID}`)
  console.log(`Client: ${CLIENT_ID}`)
  console.log(`Mailbox: ${MAIL_USER}`)

  const tokenUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  })

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    // No caching
    cache: "no-store",
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`Token request FAILED (${res.status}):`, text)
    process.exit(1)
  }

  const data = await res.json()

  // Decode token to show permissions
  try {
    const payload = JSON.parse(Buffer.from(data.access_token.split(".")[1], "base64url").toString())
    console.log(`Token roles: ${JSON.stringify(payload.roles ?? "none")}`)
  } catch { /* ignore */ }

  console.log(`✓ Token acquired (expires in ${data.expires_in}s)\n`)
  return data.access_token
}

async function testBasicAccess(token: string) {
  console.log("=== Step 1b: Testing basic user access ===")

  // First, just try to access the user profile to verify the mailbox exists
  const userUrl = `${GRAPH_BASE}/users/${encodeURIComponent(MAIL_USER)}`
  const userRes = await fetch(userUrl, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!userRes.ok) {
    const text = await userRes.text()
    console.error(`User lookup FAILED (${userRes.status}):`, text)
    console.log("\nPossible issues:")
    console.log("- The mailbox may not exist in this tenant")
    console.log("- The app may need User.Read.All permission too")
    console.log("- Try using a different mailbox email or user object ID")
    return false
  }

  const userData = await userRes.json()
  console.log(`✓ Found user: ${userData.displayName} (${userData.mail ?? userData.userPrincipalName})\n`)
  return true
}

async function listEmails(token: string) {
  console.log("=== Step 2: Listing emails with attachments ===")

  // Look back 90 days for more results
  const since = new Date()
  since.setDate(since.getDate() - 90)
  const sinceStr = since.toISOString()
  console.log(`Looking for emails since: ${sinceStr}`)

  // Use $search instead of $filter for complex queries (more reliable across mailbox types)
  const url =
    `${GRAPH_BASE}/users/${encodeURIComponent(MAIL_USER)}/messages` +
    `?$filter=hasAttachments eq true` +
    `&$select=id,subject,receivedDateTime,from,hasAttachments` +
    `&$top=10`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`List messages FAILED (${res.status}):`, text)

    if (res.status === 403) {
      console.log("\n=== TROUBLESHOOTING 403 ===")
      console.log("1. In Azure Portal → App registrations → your app → API permissions:")
      console.log("   - Ensure 'Mail.Read' is listed under 'Application' permissions (not Delegated)")
      console.log("   - Ensure 'Admin consent' column shows a green checkmark")
      console.log("   - If you just added it, wait 5-10 minutes for propagation")
      console.log("2. If using Exchange Online Application Access Policy:")
      console.log("   - Verify the policy includes this app and mailbox")
      console.log("3. Try accessing a different mailbox or removing Application Access Policies")
    }
    return []
  }

  const data = await res.json()
  const messages = data.value ?? []
  console.log(`✓ Found ${messages.length} emails with attachments\n`)

  for (const msg of messages.slice(0, 5)) {
    console.log(`  📧 ${msg.subject}`)
    console.log(`     From: ${msg.from?.emailAddress?.address ?? "unknown"}`)
    console.log(`     Date: ${msg.receivedDateTime}`)
    console.log(`     ID: ${msg.id.slice(0, 40)}...\n`)
  }

  return messages
}

async function getAttachments(token: string, messageId: string, subject: string) {
  console.log(`=== Step 3: Getting attachments for "${subject}" ===`)

  // Don't $select contentBytes - it's only on fileAttachment subtype, not base attachment
  const url =
    `${GRAPH_BASE}/users/${encodeURIComponent(MAIL_USER)}/messages/${messageId}/attachments`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`Get attachments FAILED (${res.status}):`, text)
    return null
  }

  const data = await res.json()
  const attachments = data.value ?? []

  console.log(`Found ${attachments.length} attachment(s):`)
  for (const att of attachments) {
    const sizeMB = ((att.size ?? 0) / (1024 * 1024)).toFixed(2)
    console.log(`  📎 ${att.name} (${att.contentType}, ${sizeMB}MB)`)
  }
  console.log()

  // Filter PDF attachments
  const pdfs = attachments.filter(
    (a: { contentType?: string; name?: string; size?: number }) =>
      (a.contentType === "application/pdf" ||
        (typeof a.name === "string" && a.name.toLowerCase().endsWith(".pdf"))) &&
      (a.size ?? 0) < 20 * 1024 * 1024
  )

  if (pdfs.length > 0) {
    const pdf = pdfs[0]
    console.log(`Saving first PDF: ${pdf.name}`)
    const outDir = path.resolve(process.cwd(), "scripts/test-output")
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
    const outPath = path.join(outDir, pdf.name)
    fs.writeFileSync(outPath, Buffer.from(pdf.contentBytes, "base64"))
    console.log(`✓ Saved to ${outPath} (${(Buffer.from(pdf.contentBytes, "base64").length / 1024).toFixed(1)}KB)\n`)
    return { pdfBase64: pdf.contentBytes, fileName: pdf.name, filePath: outPath }
  }

  console.log("No PDF attachments found in this email.\n")
  return null
}

async function main() {
  console.log("╔══════════════════════════════════════════╗")
  console.log("║  Microsoft Graph Email Test              ║")
  console.log("╚══════════════════════════════════════════╝\n")

  const token = await getToken()

  // Skip user lookup - go straight to listing emails (only needs Mail.Read)
  const messages = await listEmails(token)

  if (messages.length === 0) {
    console.log("No emails with attachments found. Try expanding the date range.")
    return
  }

  // Try to find the first email with a PDF attachment
  for (const msg of messages.slice(0, 5)) {
    const result = await getAttachments(token, msg.id, msg.subject)
    if (result) {
      console.log("=== SUCCESS ===")
      console.log(`Found PDF: ${result.fileName}`)
      console.log(`Base64 length: ${result.pdfBase64.length} chars`)
      console.log(`File saved to: ${result.filePath}`)
      console.log("\nReady to test Gemini extraction on this PDF.")
      console.log("Run: npx tsx scripts/test-gemini-invoice.ts")
      return
    }
  }

  console.log("No PDF attachments found in the first 5 emails. Check the mailbox.")
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
