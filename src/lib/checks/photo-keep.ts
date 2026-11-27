/**
 * The range the owner can set for how long crew check photos are kept
 * (Account.checkPhotoKeepDays). The floor keeps a photo past its check window
 * and a Redo; the nightly cleanup is `photo-retention.ts`.
 */
export const MIN_PHOTO_KEEP_DAYS = 3
export const MAX_PHOTO_KEEP_DAYS = 365
/** What a new account starts with, and what the setting suggests. */
export const DEFAULT_PHOTO_KEEP_DAYS = 7
