const GRAPH_BASE = "https://graph.microsoft.com/v1.0"

// --- Token cache (same pattern as otter.ts) ---
let cachedToken: string | null = null
let cachedTokenExp = 0 // unix seconds

async function getGraphAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedTokenExp - now > 300) return cachedToken

  const tenantId = process.env.MICROSOFT_TENANT_ID
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Microsoft Graph auth requires MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, and MICROSOFT_CLIENT_SECRET env vars"
    )
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  })

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Microsoft token request failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  cachedToken = data.access_token as string
  cachedTokenExp = now + (data.expires_in as number)
  return cachedToken
}

function getMailUserId(): string {
  const userId = process.env.MICROSOFT_MAIL_USER_ID
  if (!userId) {
    throw new Error("MICROSOFT_MAIL_USER_ID env var is required (email or user object ID)")
  }
  return userId
}

// --- Types ---

export interface GraphMessage {
  id: string
  subject: string | null
  receivedDateTime: string
  from: { emailAddress: { name: string; address: string } } | null
  hasAttachments: boolean
}

export interface GraphAttachment {
  id: string
  name: string
  contentType: string
  contentBytes: string // base64
  size: number
}

// --- Email fetching ---

export async function fetchInvoiceEmails(sinceDate: Date): Promise<GraphMessage[]> {
  const token = await getGraphAccessToken()
  const userId = getMailUserId()
  const since = sinceDate.toISOString()

  const messages: GraphMessage[] = []
  // Simple filter - combining $filter with $orderby can fail on some mailbox types
  let url: string | null =
    `${GRAPH_BASE}/users/${encodeURIComponent(userId)}/messages` +
    `?$filter=hasAttachments eq true` +
    `&$select=id,subject,receivedDateTime,from,hasAttachments` +
    `&$top=50`

  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Graph API error (${res.status}): ${text}`)
    }

    const data = await res.json()
    const batch = (data.value ?? []) as GraphMessage[]
    messages.push(...batch)

    // Follow pagination
    url = data["@odata.nextLink"] ?? null

    // Stop if we've gone past our sinceDate (messages come newest-first by default)
    const oldest = batch[batch.length - 1]
    if (oldest && new Date(oldest.receivedDateTime) < sinceDate) {
      break
    }
  }

  // Client-side date filter since we couldn't combine it with $filter on server
  return messages.filter((m) => new Date(m.receivedDateTime) >= sinceDate)
}

// --- Attachment fetching ---

export async function getEmailAttachments(messageId: string): Promise<GraphAttachment[]> {
  const token = await getGraphAccessToken()
  const userId = getMailUserId()

  // Don't $select contentBytes - only available on fileAttachment subtype, not base attachment
  const url =
    `${GRAPH_BASE}/users/${encodeURIComponent(userId)}/messages/${messageId}/attachments`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Graph attachments error (${res.status}): ${text}`)
  }

  const data = await res.json()
  const attachments = (data.value ?? []) as Array<Record<string, unknown>>

  // Filter to PDF attachments under 20MB
  return attachments
    .filter(
      (a) =>
        a["@odata.type"] === "#microsoft.graph.fileAttachment" &&
        (a.contentType === "application/pdf" ||
          (typeof a.name === "string" && a.name.toLowerCase().endsWith(".pdf"))) &&
        typeof a.size === "number" &&
        a.size < 20 * 1024 * 1024
    )
    .map((a) => ({
      id: a.id as string,
      name: a.name as string,
      contentType: (a.contentType as string) ?? "application/pdf",
      contentBytes: a.contentBytes as string,
      size: a.size as number,
    }))
}
