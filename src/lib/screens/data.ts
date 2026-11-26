import { prisma } from "@/lib/prisma"
import { pairLink, qrRows } from "./pair-link"
import {
  PAIR_CODE_TTL_MS,
  PLAYER_VERSION,
  SEEN_WRITE_EVERY_MS,
  newPairCode,
  playlistVersion,
  drawsFullHd,
  screenMediaUrl,
  storeOffsetMinutes,
  type TimeWindow,
} from "./core"

/**
 * The TV's side of Screens: ask for a code, then ask what to play. Both are
 * reached only with the TV's own token hash, never an account or store id the
 * TV could make up.
 */

export type TvSlide = { id: string; url: string; seconds: number; name: string }
export type TvTime = TimeWindow & { id: string; slides: TvSlide[] }

export type TvContent =
  | { paired: false; code: string; expiresAt: string; player: string; /** The pairing link as rows of 0 and 1. */ qr: string[] }
  | {
      paired: true
      player: string
      screen: { name: string; store: string }
      playlist: { name: string; version: string; slides: TvSlide[] } | null
      times: TvTime[]
      /** The TV works out store time from these, so a wrong clock or zone on the TV does not matter. */
      clock: { now: string; offsetMinutes: number }
      identifyUntil: string | null
    }

const SLIDES = {
  orderBy: { position: "asc" },
  select: { id: true, seconds: true, media: { select: { name: true, blobKey: true } } },
} as const

type SlideRow = { id: string; seconds: number; media: { name: string; blobKey: string } }

/** `fit`: ask for the 1920 x 1080 copy (the media route falls back to the full picture where there is none). */
function tvSlides(rows: SlideRow[], fit?: "fhd"): TvSlide[] {
  return rows.map((s) => ({ id: s.id, url: screenMediaUrl(s.media.blobKey, fit), seconds: s.seconds, name: s.media.name }))
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
        // Only dead codes: a live one for this TV (made by a poll that ran at the
        // same moment) must survive, so the create below hits P2002 and shows it.
        prisma.screenPairing.deleteMany({ where: { expiresAt: { lte: now } } }),
        prisma.screenPairing.create({ data: { code, tokenHash, device, expiresAt } }),
      ])
      return { code, expiresAt }
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err
      // Two polls from one TV at once: the other one made the code. Show that one, don't replace it.
      const other = await prisma.screenPairing.findUnique({ where: { tokenHash } })
      if (other && other.expiresAt > new Date()) return { code: other.code, expiresAt: other.expiresAt }
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
          slides: SLIDES,
        },
      },
      identifyUntil: true,
      times: {
        orderBy: { createdAt: "asc" },
        select: { id: true, days: true, startMinute: true, endMinute: true, playlist: { select: { slides: SLIDES } } },
      },
    },
  })

  if (!screen) {
    const p = await pairingFor(tokenHash, device)
    return { paired: false, code: p.code, expiresAt: p.expiresAt.toISOString(), player: PLAYER_VERSION, qr: qrRows(pairLink(p.code)) }
  }

  const now = new Date()
  if (!screen.lastSeenAt || now.getTime() - screen.lastSeenAt.getTime() >= SEEN_WRITE_EVERY_MS || (device && device !== screen.device)) {
    await prisma.$transaction([
      prisma.screen.update({
        where: { id: screen.id },
        data: { lastSeenAt: now, ...(device ? { device } : {}) },
        select: { id: true },
      }),
      // A code made for this TV while it was being paired is no use any more.
      prisma.screenPairing.deleteMany({ where: { tokenHash } }),
    ])
  }

  const pl = screen.playlist
  const fit = drawsFullHd(device ?? screen.device) ? "fhd" : undefined
  return {
    paired: true,
    player: PLAYER_VERSION,
    screen: { name: screen.name, store: screen.store.name },
    playlist: pl
      ? {
          name: pl.name,
          version: playlistVersion(
            pl.slides.map((s) => ({ id: s.id, seconds: s.seconds, key: s.media.blobKey + (fit ?? "") })),
            pl.name,
          ),
          slides: tvSlides(pl.slides, fit),
        }
      : null,
    times: screen.times.map((t) => ({ id: t.id, days: t.days, start: t.startMinute, end: t.endMinute, slides: tvSlides(t.playlist.slides, fit) })),
    clock: { now: now.toISOString(), offsetMinutes: storeOffsetMinutes(now) },
    identifyUntil: screen.identifyUntil && screen.identifyUntil > now ? screen.identifyUntil.toISOString() : null,
  }
}
