import { createHash, randomInt } from "node:crypto"

/**
 * Screens: the rules a TV and the dashboard share, kept free of the database
 * so they can be tested on their own.
 *
 * A TV makes its own random token the first time the app opens and keeps it.
 * The server only ever stores `hashToken(token)`, on the pairing row while
 * the TV shows its code and on the Screen once the owner types the code in.
 * Every call the TV makes after that sends the token, which is how it finds
 * its own screen and nothing else.
 */

export * from "./limits"
import { SCREEN_TZ, SLIDE_SECONDS_DEFAULT, SLIDE_SECONDS_MAX, SLIDE_SECONDS_MIN, ONLINE_WINDOW_MS } from "./limits"

/** Six digits, never starting with 0 so it reads the same said aloud. */
export function newPairCode(): string {
  return String(randomInt(100_000, 1_000_000))
}

/** Digits only, so "482 913" and "482-913" both work. */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, "")
}

export function isPairCode(code: string): boolean {
  return /^[1-9]\d{5}$/.test(code)
}

/** A TV token: 32 to 128 URL-safe characters. Anything else is refused before it is hashed. */
export function isDeviceToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token)
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** `Authorization: Bearer <token>`, or null. */
export function tokenFromHeader(header: string | null): string | null {
  if (!header) return null
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return m && isDeviceToken(m[1]) ? m[1] : null
}

/**
 * What the TV says it is, cleaned for storing. The player joins its parts with
 * "·", which arrives mangled in an HTTP header; any run of non-ASCII is put
 * back as one "·", so "Tizen 7.0 Â· 3840x2160" reads "Tizen 7.0 · 3840x2160".
 */
export function cleanDevice(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.replace(/[^\x20-\x7e]+/g, "·").replace(/\s+/g, " ").trim().slice(0, 120)
  return s || null
}

export type ScreenState = "on" | "off" | "waiting"

/** On, off, or never heard from since pairing. */
export function screenState(lastSeenAt: Date | null, now: Date = new Date()): ScreenState {
  if (!lastSeenAt) return "waiting"
  return now.getTime() - lastSeenAt.getTime() <= ONLINE_WINDOW_MS ? "on" : "off"
}

export function clampSeconds(n: number): number {
  if (!Number.isFinite(n)) return SLIDE_SECONDS_DEFAULT
  return Math.min(SLIDE_SECONDS_MAX, Math.max(SLIDE_SECONDS_MIN, Math.round(n)))
}

/** Where the TV and the dashboard load an image from. The key's uuid is what makes it unguessable. */
export function screenMediaUrl(blobKey: string, fit?: "fhd"): string {
  return `/api/tv/media/${blobKey.split("/").map(encodeURIComponent).join("/")}${fit ? `?fit=${fit}` : ""}`
}

/**
 * Whether a TV draws at most 1920 x 1080, from the label its player sends
 * ("Tizen 7.0 · 1920x1080"). Samsung's apps draw at 1920 x 1080 even on a 4K
 * panel, so those TVs get the lossless 1920 x 1080 copy: the same pixels the
 * TV would make itself, at a quarter of the download and the decoding. A TV
 * that says nothing, or draws more, gets the full picture.
 */
export function drawsFullHd(device: string | null | undefined): boolean {
  const m = /(\d{3,5})x(\d{3,5})/.exec(device ?? "")
  if (!m) return false
  const w = Number(m[1])
  const h = Number(m[2])
  return Math.max(w, h) <= 1920 && Math.min(w, h) <= 1080
}

/** Accepted uploads. */
export const SCREEN_MEDIA_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const

export type ScreenMediaType = keyof typeof SCREEN_MEDIA_TYPES

export function isScreenMediaType(t: string): t is ScreenMediaType {
  return Object.hasOwn(SCREEN_MEDIA_TYPES, t)
}

/** What the bytes really are, whatever the browser called them. */
export function sniffImage(b: Uint8Array): ScreenMediaType | null {
  if (b.length < 12) return null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg"
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png"
  const at = (i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0))
  return at(0, "RIFF") && at(8, "WEBP") ? "image/webp" : null
}

/** Minutes between UTC and store time at `at` (-480 in a Los Angeles winter). Sent to the TV, whose own clock and zone are not trusted. */
export function storeOffsetMinutes(at: Date, tz: string = SCREEN_TZ): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(at)
      .map((x) => [x.type, Number(x.value)]),
  )
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000)
}

/** One fingerprint for what a TV is showing, so it only reloads when something changed. */
export function playlistVersion(parts: { id: string; seconds: number; key: string }[], name: string): string {
  return createHash("sha1")
    .update(name)
    .update(parts.map((p) => `${p.id}:${p.seconds}:${p.key}`).join("|"))
    .digest("hex")
    .slice(0, 16)
}
