/**
 * Photo checks shared by the crew routes. The phone shrinks each photo to
 * 1600 px JPEG, a few hundred KB, so the limit is a guard, not a target.
 */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024

/** The first bytes of a JPEG, PNG or WebP. The declared type alone is the client's word. */
export function looksLikeImage(head: Uint8Array): boolean {
  const at = (i: number, ...b: number[]) => b.every((v, j) => head[i + j] === v)
  return at(0, 0xff, 0xd8, 0xff) || at(0, 0x89, 0x50, 0x4e, 0x47) || (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
}
