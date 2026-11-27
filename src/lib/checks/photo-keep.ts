/**
 * The range the owner can set for how long crew check photos are kept
 * (Account.checkPhotoKeepDays). The floor keeps a photo past its check window
 * and a Redo; the nightly cleanup is `photo-retention.ts`.
 */
export const MIN_PHOTO_KEEP_DAYS = 3
export const MAX_PHOTO_KEEP_DAYS = 365
/** What a new account starts with, and what the setting suggests. */
export const DEFAULT_PHOTO_KEEP_DAYS = 7

/**
 * Mark rows with any photo the cleanup already deleted treated as having no
 * photo, so a check closed late never copies a dead key into its record.
 */
export function withoutPurgedPhotos<
  R extends { photoKey: string | null; photoType: string | null; photoSize: number | null; photoPurgedAt: Date | null },
>(rows: R[]): Array<Omit<R, "photoPurgedAt">> {
  return rows.map(({ photoPurgedAt, ...r }) => (photoPurgedAt ? { ...r, photoKey: null, photoType: null, photoSize: null } : r))
}
