import { prisma } from "@/lib/prisma"
import {
  PAIR_CODE_TTL_MS,
  SEEN_WRITE_EVERY_MS,
  newPairCode,
  playlistVersion,
  screenMediaUrl,
} from "./core"

/**
 * The TV's side of Screens: ask for a code, then ask what to play. Both are
 * reached only with the TV's own token hash, never an account or store id the
 * TV could make up.
 */

export type TvSlide = { id: string; url: string; seconds: number; name: string }

export type TvContent =
  | { paired: false; code: string; expiresAt: string }
  | {
      paired: true
      screen: { name: string; store: string }
      playlist: { name: string; version: string; slides: TvSlide[] } | null
    }

/**
 * The code this TV shows. Reuses a live one, so a TV that reloads keeps
 * showing the same digits; makes a new one once the old has expired.
 */
export async function pairingFor(tokenHash: string, device: string | null): Promise<{ code: string; expiresAt: Date }> {
  const now = new Date()
  const live = await prisma.screenPairing.findUnique({ where: { tokenHash } })
  if (live && live.expiresAt > now) return { code: live.code, expiresAt: live.expiresAt }

  // A collision on the six digits is rare; try a few before giving up.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newPairCode()
    const expiresAt = new Date(now.getTime() + PAIR_CODE_TTL_MS)
    try {
      await prisma.$transaction([
        prisma.screenPairing.deleteMany({ where: { OR: [{ tokenHash }, { expiresAt: { lt: now } }] } }),
        prisma.screenPairing.create({ data: { code, tokenHash, device, expiresAt } }),
      ])
      return { code, expiresAt }
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err
    }
  }
  throw new Error("Could not make a pairing code")
}

/** What a TV should show now. Notes that the TV was seen, at most once a minute. */
export async function contentFor(tokenHash: string, device: string | null): Promise<TvContent> {
  const screen = await prisma.screen.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      name: true,
      lastSeenAt: true,
      device: true,
      store: { select: { name: true } },
      playlist: {
        select: {
          name: true,
          slides: {
            orderBy: { position: "asc" },
            select: { id: true, seconds: true, media: { select: { name: true, blobKey: true } } },
          },
        },
      },
    },
  })

  if (!screen) {
    const p = await pairingFor(tokenHash, device)
    return { paired: false, code: p.code, expiresAt: p.expiresAt.toISOString() }
  }

  const now = new Date()
  if (!screen.lastSeenAt || now.getTime() - screen.lastSeenAt.getTime() >= SEEN_WRITE_EVERY_MS || (device && device !== screen.device)) {
    await prisma.screen.update({
      where: { id: screen.id },
      data: { lastSeenAt: now, ...(device ? { device } : {}) },
      select: { id: true },
    })
  }

  const pl = screen.playlist
  return {
    paired: true,
    screen: { name: screen.name, store: screen.store.name },
    playlist: pl
      ? {
          name: pl.name,
          version: playlistVersion(
            pl.slides.map((s) => ({ id: s.id, seconds: s.seconds, key: s.media.blobKey })),
            pl.name,
          ),
          slides: pl.slides.map((s) => ({
            id: s.id,
            url: screenMediaUrl(s.media.blobKey),
            seconds: s.seconds,
            name: s.media.name,
          })),
        }
      : null,
  }
}
