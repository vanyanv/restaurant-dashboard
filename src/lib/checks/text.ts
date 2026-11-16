/**
 * Store check PIN by text message, sent from the owner's own phone: the
 * dashboard builds an `sms:` link with the message filled in, and the
 * owner presses send in their Messages app. Nothing is sent from a server,
 * so there is no SMS provider, account or carrier registration behind it.
 */

/** A US mobile number as +1XXXXXXXXXX, or null when it isn't one. */
export function normalizeUsPhone(raw: string): string | null {
  // An explicit country code other than +1 is someone else's number, not a US one with punctuation.
  const plus = /^\s*(\+|00)\s*(\d)/.exec(raw)
  if (plus && plus[2] !== "1") return null
  const digits = raw.replace(/\D/g, "")
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (ten.length !== 10) return null
  // NANP: area code and exchange never start with 0 or 1.
  if (/^[01]/.test(ten) || /^[01]/.test(ten.slice(3))) return null
  return `+1${ten}`
}

/** +18185550123 -> (818) 555-0123. Anything else is shown as stored. */
export function formatUsPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}

export type PinText = { firstName: string; storeName: string; pin: string; link: string }

/** The message itself, English then Spanish, short enough to read on a lock screen. */
export function pinTextBody(t: PinText): string {
  return [
    `Hi ${t.firstName}, your store checks PIN for ${t.storeName} is ${t.pin}.`,
    t.link
      ? `Open ${t.link} (or scan the QR poster in the store), enter your PIN, and complete the check.`
      : "Scan the QR poster in the store, enter your PIN, and complete the check.",
    "",
    `Hola ${t.firstName}, tu PIN para las revisiones de ${t.storeName} es ${t.pin}.`,
    t.link
      ? `Abre ${t.link} (o escanea el código QR en la tienda), escribe tu PIN y completa la revisión.`
      : "Escanea el código QR en la tienda, escribe tu PIN y completa la revisión.",
    "",
    "Keep it to yourself. Your name goes on every check you submit. / No lo compartas.",
  ].join("\n")
}

/** The how-to guide's address, beside the store's check link. */
export function howToLink(checkLink: string): string {
  return checkLink ? `${checkLink.replace(/\/$/, "")}/how` : ""
}

/** The "Text how-to" message: no PIN (that goes in its own text), just the guide and the check link. */
export function howToTextBody(t: { firstName: string; storeName: string; link: string }): string {
  return [
    `Hi ${t.firstName}, here's how to do store checks at ${t.storeName}: ${howToLink(t.link)}`,
    `Open the checks here: ${t.link}`,
    "",
    `Hola ${t.firstName}, así se hacen las revisiones en ${t.storeName}: ${howToLink(t.link)}`,
    `Abre las revisiones aquí: ${t.link}`,
  ].join("\n")
}

/**
 * Opens Messages addressed to `phone` with `body` filled in. `?&body=` is the
 * form both iOS (which wants `&`) and Android (which wants `?`) accept.
 */
export function smsHref(phone: string, body: string): string {
  return `sms:${phone}?&body=${encodeURIComponent(body)}`
}
