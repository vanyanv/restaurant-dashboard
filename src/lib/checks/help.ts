/**
 * How-to help on a store check task: a few short steps (one per line, in
 * English and Spanish) and up to four reference photos the owner adds, so
 * crew who don't know where something is can look before they ask.
 *
 * Reference photos are the owner's, added once, and only ever looked at.
 * They are not proof: the photos crew take on a Photo required task are
 * CheckMark rows and never pass through here.
 */

export const MAX_HELP_PHOTOS = 4
/** Characters per language: room for six or seven short steps. */
export const MAX_HELP_CHARS = 600

const SAFE = /[^A-Za-z0-9._-]/g

/** Where an account's reference photos live in storage. */
export function helpPhotoPrefix(accountId: string): string {
  return `check-help/${accountId.replace(SAFE, "_")}/`
}

const KEY_TAIL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/

/** A key this account uploaded: the right folder and the shape the upload gives it. */
export function isHelpPhotoKey(accountId: string, key: string): boolean {
  const prefix = helpPhotoPrefix(accountId)
  return key.startsWith(prefix) && KEY_TAIL.test(key.slice(prefix.length))
}

/** Steps from the stored text: one per line, blank lines dropped. */
export function helpSteps(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Stored text from what the owner typed: trimmed lines, no blank ones, null when empty. */
export function helpText(text: string | null | undefined): string | null {
  const steps = helpSteps(text)
  return steps.length > 0 ? steps.join("\n") : null
}

export type CrewHelp = {
  en: string[]
  /** Empty: crew reading Spanish see the English steps. */
  es: string[]
  /** Storage keys, in order. The crew page asks for each through its own link. */
  photos: string[]
}

/** A task's help as crew get it, or null when it has none. */
export function crewHelp(row: { helpEn?: string | null; helpEs?: string | null; helpPhotos?: string[] }): CrewHelp | null {
  const en = helpSteps(row.helpEn)
  const es = helpSteps(row.helpEs)
  const photos = row.helpPhotos ?? []
  if (en.length === 0 && es.length === 0 && photos.length === 0) return null
  return { en, es, photos }
}

/** The link a crew phone loads a reference photo from. */
export function crewHelpPhotoUrl(code: string, key: string): string {
  return `/api/checks/${encodeURIComponent(code)}/help-photo?key=${encodeURIComponent(key)}`
}

/** The link the owner's editor previews a reference photo from. */
export function ownerHelpPhotoUrl(key: string): string {
  return `/api/checks/help-photo?key=${encodeURIComponent(key)}`
}
