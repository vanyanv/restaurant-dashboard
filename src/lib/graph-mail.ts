import { getGraphAccessToken, getMailUserId } from "@/lib/microsoft-graph"

const GRAPH_BASE = "https://graph.microsoft.com/v1.0"

export interface SendGraphMailResult {
  sent: boolean
  error?: string
}

/**
 * Send an email via Microsoft Graph's /sendMail endpoint using the same Azure app
 * that reads the invoice mailbox. Requires the Azure app to have the `Mail.Send`
 * Application permission (plus admin consent).
 *
 * Errors are not thrown — the caller gets `{ sent: false, error }` so a failed
 * alert email never poisons the sync that triggered it.
 */
export async function sendGraphMail(args: {
  toEmail: string
  subject: string
  html: string
  fromUserId?: string
}): Promise<SendGraphMailResult> {
  const fromUserId = args.fromUserId ?? getMailUserId()

  let token: string
  try {
    token = await getGraphAccessToken()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`sendGraphMail: token acquisition failed: ${msg}`)
    return { sent: false, error: msg }
  }

  const body = {
    message: {
      subject: args.subject,
      body: { contentType: "HTML", content: args.html },
      toRecipients: [{ emailAddress: { address: args.toEmail } }],
    },
    saveToSentItems: true,
  }

  const url = `${GRAPH_BASE}/users/${encodeURIComponent(fromUserId)}/sendMail`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (res.status === 202 || res.ok) {
    return { sent: true }
  }

  const text = await res.text().catch(() => "")
  const msg = `Graph sendMail failed (${res.status}): ${text.slice(0, 300)}`
  console.error(msg)
  return { sent: false, error: msg }
}
