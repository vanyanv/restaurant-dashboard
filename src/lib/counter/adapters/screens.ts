import { getAccountStores } from "@/lib/account-stores"
import { prisma } from "@/lib/prisma"
import { activeTime, screenMediaUrl, screenState, storeOffsetMinutes, type ScreenState } from "@/lib/screens/core"
import { latestSeen, seenFor } from "@/lib/screens/push"
import { classify, guardSection, lazy, type StreamedSections } from "./types"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * Screens: every TV and picture in the account, in one load.
 *
 * The page switches between stores (each store is a workspace) without a
 * new query: the reads below run once, in parallel, for the whole
 * account, and the client narrows them to the store picked (query rules:
 * load once for the widest span, per-store views filter it).
 *
 * Tenancy: every read is filtered by `accountId`, passed in by the page from
 * the session. Store-owned rows are also on the account through `accountId`.
 */

export type SlideRow = { mediaId: string; seconds: number }

/** Different pictures for part of the week. `days` has bit 0 for Sunday; minutes are store time. */
export type TimeRow = { id: string; name: string; days: number; start: number; end: number; slides: SlideRow[] }

export type ScreenRow = {
  id: string
  name: string
  storeId: string
  /** What it shows outside every window. */
  slides: SlideRow[]
  times: TimeRow[]
  /** The window on now, worked out on the server so the page draws the same everywhere. */
  onNow: string | null
  device: string | null
  state: ScreenState
  lastSeenAt: string | null
}

export type MediaRow = {
  id: string
  name: string
  /** Null: every store can use it (every picture uploaded since the board; older ones may be one store's). */
  storeId: string | null
  /** The small copy. The TV loads the full picture. */
  url: string
  width: number | null
  height: number | null
  /** How many screens have it. */
  screens: number
}

export type ScreensData = {
  stores: { id: string; name: string }[]
  screens: ScreenRow[]
  media: MediaRow[]
}

export type ScreensSections = { screens: SectionData<ScreensData> }

const SLIDES = { orderBy: { position: "asc" }, select: { mediaId: true, seconds: true } } as const

export async function loadScreens(accountId: string): Promise<ScreensData> {
  const [stores, { screens, seen }, media] = await Promise.all([
    getAccountStores(accountId),
    prisma.screen.findMany({
      where: { accountId },
      orderBy: [{ pairedAt: "asc" }],
      select: {
        id: true,
        name: true,
        storeId: true,
        // For the beat lookup only. Never put on a row the page gets.
        tokenHash: true,
        // A beat older than this is from the TV's last pairing; see latestSeen.
        pairedAt: true,
        device: true,
        lastSeenAt: true,
        playlist: { select: { slides: SLIDES } },
        times: {
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, days: true, startMinute: true, endMinute: true, playlist: { select: { slides: SLIDES } } },
        },
      },
    })
      // A TV on the new player says it is on to Redis, not the database: one MGET for every screen, no query.
      .then(async (screens) => ({ screens, seen: await seenFor(screens.map((s) => s.tokenHash)) })),
    prisma.screenMedia.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, storeId: true, blobKey: true, width: true, height: true },
    }),
  ])

  const now = new Date()
  const local = new Date(now.getTime() + storeOffsetMinutes(now) * 60_000)
  const day = local.getUTCDay()
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes()
  const used = new Map<string, number>()
  const rows = screens.map((s): ScreenRow => {
    const slides = s.playlist?.slides ?? []
    const times = s.times.map((t) => ({ id: t.id, name: t.name, days: t.days, start: t.startMinute, end: t.endMinute, slides: t.playlist.slides }))
    for (const m of new Set([slides, ...times.map((t) => t.slides)].flat().map((x) => x.mediaId))) used.set(m, (used.get(m) ?? 0) + 1)
    const last = latestSeen(s.lastSeenAt, s.device, seen.get(s.tokenHash), s.pairedAt)
    return {
      id: s.id,
      name: s.name,
      storeId: s.storeId,
      slides,
      times,
      onNow: activeTime(times.filter((t) => t.slides.length > 0), day, minute)?.id ?? null,
      device: last.device,
      state: screenState(last.at, now),
      lastSeenAt: last.at?.toISOString() ?? null,
    }
  })

  return {
    stores: stores.map((s) => ({ id: s.id, name: s.name })),
    // Left, Middle, Right, the way they hang; anything else after, oldest first.
    screens: rows.sort((a, b) => spotOrder(a.name) - spotOrder(b.name)),
    media: media.map((m) => ({
      id: m.id,
      name: m.name,
      storeId: m.storeId,
      url: `${screenMediaUrl(m.blobKey)}?small=1`,
      width: m.width,
      height: m.height,
      screens: used.get(m.id) ?? 0,
    })),
  }
}

/** Pure, for the test: where a screen's name puts it in its row. */
export function spotOrder(name: string): number {
  const i = ["left", "middle", "right"].findIndex((s) => name.toLowerCase().includes(s))
  return i === -1 ? 3 : i
}

export function getScreensSectionPromises(opts: { accountId: string }): StreamedSections<ScreensSections> {
  return {
    screens: lazy(() =>
      guardSection(
        classify(() => loadScreens(opts.accountId), {
          retryAction: "screens",
          isEmpty: (d) => d.stores.length === 0,
          emptyReason: "no_stores",
        }),
        "screens",
      ),
    ),
  }
}
