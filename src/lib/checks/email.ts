/**
 * Store check email, sent through Resend's HTTP API: the crew PIN email and
 * the owners' report on each submitted check (report.ts).
 *
 * Needs RESEND_API_KEY and a sender on a domain Resend has verified
 * (CHECKS_EMAIL_FROM, else EMAIL_FROM). Without them the send reports that
 * email is not set up, and the owner can still read the PIN off the Crew &
 * PINs page and hand it over.
 */

export type PinEmail = {
  to: string
  firstName: string
  storeName: string
  pin: string
  link: string
}

export type SendResult = { ok: true } | { ok: false; reason: string }

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && (process.env.CHECKS_EMAIL_FROM || process.env.EMAIL_FROM))
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

export function pinEmailContent(e: PinEmail): { subject: string; text: string; html: string } {
  const subject = `Your store check PIN for ${e.storeName}`
  const text = [
    `Hi ${e.firstName},`,
    "",
    `Your PIN for store checks at ${e.storeName} is ${e.pin}.`,
    "Scan the QR poster in the store, enter this PIN, and complete the check.",
    "",
    `Tu PIN para las revisiones de ${e.storeName} es ${e.pin}.`,
    "Escanea el código QR en la tienda, escribe este PIN y completa la revisión.",
    "",
    `Link: ${e.link}`,
    "",
    "Keep it to yourself. Your name goes on every check you submit.",
  ].join("\n")
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">
<p>Hi ${escapeHtml(e.firstName)},</p>
<p>Your PIN for store checks at <b>${escapeHtml(e.storeName)}</b> is</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:bold">${escapeHtml(e.pin)}</p>
<p>Scan the QR poster in the store, enter this PIN, and complete the check.</p>
<p>Tu PIN para las revisiones de ${escapeHtml(e.storeName)} es <b>${escapeHtml(e.pin)}</b>. Escanea el código QR en la tienda, escribe este PIN y completa la revisión.</p>
<p>Keep it to yourself. Your name goes on every check you submit.</p>
</div>`
  return { subject, text, html }
}

export async function sendPinEmail(e: PinEmail): Promise<SendResult> {
  return sendEmail({ to: [e.to], ...pinEmailContent(e) })
}

export function escapeEmailHtml(s: string): string {
  return escapeHtml(s)
}

/** One message through Resend. Never throws: the reason comes back in words. */
export async function sendEmail(m: { to: string[]; subject: string; text: string; html: string }): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.CHECKS_EMAIL_FROM || process.env.EMAIL_FROM
  if (!key || !from) return { ok: false, reason: "Email isn't set up for the dashboard yet" }
  if (m.to.length === 0) return { ok: false, reason: "Nobody to send it to" }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: m.to, subject: m.subject, text: m.text, html: m.html }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.warn(`[checks.email] Resend ${res.status}: ${body.slice(0, 200)}`)
      return { ok: false, reason: "The email service refused the message" }
    }
    return { ok: true }
  } catch (err) {
    console.warn("[checks.email] send failed", err)
    return { ok: false, reason: "Couldn't reach the email service" }
  }
}
