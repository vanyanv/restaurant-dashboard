import { getAccountStores } from "@/lib/account-stores"
import { prisma } from "@/lib/prisma"
import { screenMediaUrl, screenState, type ScreenState } from "@/lib/screens/core"
import { classify, guardSection, lazy, type StreamedSections } from "./types"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * Screens: every TV, playlist and image in the account, in one load.
 *
 * The page switches between stores (each store is a workspace) without a
 * new query: the four reads below run once, in parallel, for the whole
 * account, and the client narrows them to the store picked (query rules:
 * load once for the widest span, per-store views filter it).
 *
 * Tenancy: every read is filtered by `accountId`, passed in by the page from
 * the session. Store-owned rows are also on the account through `accountId`.
 */

export type ScreenRow = {
  id: string
  name: string
  storeId: string
  playlistId: string | null
  playlistName: string | null
  slides: number
  thumb: string | null
  device: string | null
  state: ScreenState
  lastSeenAt: string | null
  pairedAt: string
}

export type PlaylistRow = {
  id: string
  name: string
  /** Null: every store can use it. */
  storeId: string | null
  slides: { mediaId: string; seconds: number }[]
  screens: number
}

export type MediaRow = {
  id: string
  name: string
  storeId: string | null
  url: string
  width: number | null
  height: number | null
  bytes: number
  createdAt: string
  playlists: number
}

export type ScreensData = {
  stores: { id: string; name: string }[]
  screens: ScreenRow[]
  playlists: PlaylistRow[]
  media: MediaRow[]
  checkedAt: string
}

export type ScreensSections = { screens: SectionData<ScreensData> }

export async function loadScreens(accountId: string): Promise<ScreensData> {
  const [stores, screens, playlists, media] = await Promise.all([
    getAccountStores(accountId),
    prisma.screen.findMany({
      where: { accountId },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        storeId: true,
        playlistId: true,
        device: true,
        lastSeenAt: true,
        pairedAt: true,
      },
    }),
    prisma.screenPlaylist.findMany({
      where: { accountId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        storeId: true,
        slides: { orderBy: { position: "asc" }, select: { mediaId: true, seconds: true } },
      },
    }),
    prisma.screenMedia.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, storeId: true, blobKey: true, width: true, height: true, bytes: true, createdAt: true },
    }),
  ])

  const now = new Date()
  const mediaById = new Map(media.map((m) => [m.id, m]))
  const playlistById = new Map(playlists.map((p) => [p.id, p]))
  const screensOn = new Map<string, number>()
  for (const s of screens) if (s.playlistId) screensOn.set(s.playlistId, (screensOn.get(s.playlistId) ?? 0) + 1)
  const inPlaylists = new Map<string, number>()
  for (const p of playlists) for (const id of new Set(p.slides.map((x) => x.mediaId))) inPlaylists.set(id, (inPlaylists.get(id) ?? 0) + 1)

  return {
    stores: stores.map((s) => ({ id: s.id, name: s.name })),
    screens: screens.map((s) => {
      const p = s.playlistId ? playlistById.get(s.playlistId) : undefined
      const first = p?.slides[0] ? mediaById.get(p.slides[0].mediaId) : undefined
      return {
        id: s.id,
        name: s.name,
        storeId: s.storeId,
        playlistId: p?.id ?? null,
        playlistName: p?.name ?? null,
        slides: p?.slides.length ?? 0,
        thumb: first ? screenMediaUrl(first.blobKey) : null,
        device: s.device,
        state: screenState(s.lastSeenAt, now),
        lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
        pairedAt: s.pairedAt.toISOString(),
      }
    }),
    playlists: playlists.map((p) => ({
      id: p.id,
      name: p.name,
      storeId: p.storeId,
      slides: p.slides,
      screens: screensOn.get(p.id) ?? 0,
    })),
    media: media.map((m) => ({
      id: m.id,
      name: m.name,
      storeId: m.storeId,
      url: screenMediaUrl(m.blobKey),
      width: m.width,
      height: m.height,
      bytes: m.bytes,
      createdAt: m.createdAt.toISOString(),
      playlists: inPlaylists.get(m.id) ?? 0,
    })),
    checkedAt: now.toISOString(),
  }
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
