"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { hasOwnerAccess } from "@/lib/auth"
import { getSession } from "@/lib/auth-scope"
import { deleteScreenMedia } from "@/lib/blob"
import { rateLimitKey } from "@/lib/rate-limit"
import { clampSeconds, isPairCode, normalizeCode } from "@/lib/screens/core"
import { logger } from "@/lib/logger"

/**
 * The owner's write path for Screens. Every action starts from `ownerAccount`
 * (signed in, owner access) and every row it touches is looked up with that
 * account id first, so an id from another account is refused before
 * anything changes.
 */

export type ScreensResult = { ok: true; id?: string } | { ok: false; error: string }

class Refused extends Error {}

async function ownerAccount(): Promise<string> {
  const session = await getSession()
  if (!session?.user) throw new Refused("Sign in again to make changes")
  if (!hasOwnerAccess(session.user.role)) throw new Refused("Only an owner can change screens")
  return session.user.accountId
}

function refresh() {
  revalidatePath("/dashboard/screens")
  revalidatePath("/m/screens")
}

function fail(err: unknown): ScreensResult {
  if (err instanceof Refused) return { ok: false, error: err.message }
  if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Check the form" }
  logger.error("[screens.action]", { message: err instanceof Error ? err.message : String(err) })
  return { ok: false, error: "Couldn't save. Try again." }
}

async function ownStore(accountId: string, storeId: string) {
  const s = await prisma.store.findFirst({ where: { id: storeId, accountId }, select: { id: true } })
  if (!s) throw new Refused("That store isn't in your account")
  return s
}

/**
 * A playlist this screen may play: the account's, and either for every store
 * or for the screen's own store.
 */
async function usablePlaylist(accountId: string, storeId: string, playlistId: string | null) {
  if (!playlistId) return null
  const p = await prisma.screenPlaylist.findFirst({
    where: { id: playlistId, accountId, OR: [{ storeId: null }, { storeId }] },
    select: { id: true },
  })
  if (!p) throw new Refused("That playlist isn't available for this store")
  return p.id
}

const name = (what: string) => z.string().trim().min(1, `Give the ${what} a name`).max(60, `Keep the ${what} name under 60 characters`)
const id = z.string().min(1).max(40)

const ClaimInput = z.object({
  code: z.string().max(20),
  storeId: id,
  name: name("screen"),
  playlistId: id.nullable(),
})

/** Every try counts, right or wrong, and is counted before the code is looked up. */
const CLAIM_LIMIT = { limit: 20, windowMs: 10 * 60_000 }
const CLAIM_LIMIT_IP = { limit: 30, windowMs: 10 * 60_000 }

/** Pair the TV showing `code`: it becomes a screen in `storeId`, playing `playlistId`. */
export async function claimScreen(raw: z.input<typeof ClaimInput>): Promise<ScreensResult> {
  try {
    const input = ClaimInput.parse(raw)
    const accountId = await ownerAccount()
    const code = normalizeCode(input.code)
    if (!isPairCode(code)) return { ok: false, error: "The code on the TV is 6 digits" }

    // Counted up front, per account and per address, so a burst of guesses can't all slip past the check.
    const ip = ((await headers()).get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown"
    const tooMany =
      (await rateLimitKey(`screens-claim:${accountId}`, CLAIM_LIMIT)) ??
      (await rateLimitKey(`screens-claim-ip:${ip}`, CLAIM_LIMIT_IP))
    if (tooMany) return { ok: false, error: "Too many tries. Wait ten minutes and try again." }

    await ownStore(accountId, input.storeId)
    const playlistId = await usablePlaylist(accountId, input.storeId, input.playlistId)

    const pairing = await prisma.screenPairing.findUnique({ where: { code } })
    if (!pairing || pairing.expiresAt < new Date()) {
      return { ok: false, error: "No TV is showing that code. Check the digits, or wait for the TV to show a new one." }
    }

    const screen = await prisma.$transaction(async (tx) => {
      await tx.screenPairing.delete({ where: { code } })
      const existing = await tx.screen.findUnique({ where: { tokenHash: pairing.tokenHash }, select: { id: true, accountId: true } })
      // A TV already paired to another account is never moved by a code: that account unpairs it first.
      if (existing && existing.accountId !== accountId) throw new Refused("That TV is already paired to another account")
      if (existing) {
        // Re-pairing a TV of this account (a reset, a move) is a fresh start on the same row.
        return tx.screen.update({
          where: { id: existing.id },
          data: { storeId: input.storeId, name: input.name, playlistId, pairedAt: new Date(), lastSeenAt: null },
          select: { id: true },
        })
      }
      return tx.screen.create({
        data: {
          accountId,
          storeId: input.storeId,
          name: input.name,
          playlistId,
          tokenHash: pairing.tokenHash,
          device: pairing.device,
        },
        select: { id: true },
      })
    })

    refresh()
    return { ok: true, id: screen.id }
  } catch (err) {
    return fail(err)
  }
}

const ScreenInput = z.object({ screenId: id, name: name("screen"), storeId: id, playlistId: id.nullable() })

/** Rename a screen, move it to another store, or change what it plays. */
export async function updateScreen(raw: z.input<typeof ScreenInput>): Promise<ScreensResult> {
  try {
    const input = ScreenInput.parse(raw)
    const accountId = await ownerAccount()
    const found = await prisma.screen.findFirst({ where: { id: input.screenId, accountId }, select: { id: true } })
    if (!found) return { ok: false, error: "That screen is gone. Reload the page." }
    await ownStore(accountId, input.storeId)
    const playlistId = await usablePlaylist(accountId, input.storeId, input.playlistId)
    await prisma.screen.update({
      where: { id: found.id },
      data: { name: input.name, storeId: input.storeId, playlistId },
      select: { id: true },
    })
    refresh()
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

/** Unpair a screen. The TV goes back to showing a code. */
export async function removeScreen(screenId: string): Promise<ScreensResult> {
  try {
    const accountId = await ownerAccount()
    const { count } = await prisma.screen.deleteMany({ where: { id: id.parse(screenId), accountId } })
    if (count === 0) return { ok: false, error: "That screen is gone. Reload the page." }
    refresh()
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

const PlaylistInput = z.object({ name: name("playlist"), storeId: id.nullable() })

export async function createPlaylist(raw: z.input<typeof PlaylistInput>): Promise<ScreensResult> {
  try {
    const input = PlaylistInput.parse(raw)
    const accountId = await ownerAccount()
    if (input.storeId) await ownStore(accountId, input.storeId)
    const p = await prisma.screenPlaylist.create({
      data: { accountId, storeId: input.storeId, name: input.name },
      select: { id: true },
    })
    refresh()
    return { ok: true, id: p.id }
  } catch (err) {
    return fail(err)
  }
}

const SlidesInput = z.object({
  playlistId: id,
  name: name("playlist"),
  slides: z.array(z.object({ mediaId: id, seconds: z.number() })).max(50, "A playlist holds up to 50 images"),
})

/**
 * Save a playlist as a whole: its name and its slides in order. One write for
 * the lot, so a TV never picks up a half-saved list.
 */
export async function savePlaylist(raw: z.input<typeof SlidesInput>): Promise<ScreensResult> {
  try {
    const input = SlidesInput.parse(raw)
    const accountId = await ownerAccount()
    const playlist = await prisma.screenPlaylist.findFirst({
      where: { id: input.playlistId, accountId },
      select: { id: true, storeId: true },
    })
    if (!playlist) return { ok: false, error: "That playlist is gone. Reload the page." }

    // Every image must be the account's, and usable where the playlist plays.
    const ids = [...new Set(input.slides.map((s) => s.mediaId))]
    const media = await prisma.screenMedia.findMany({
      where: {
        id: { in: ids },
        accountId,
        ...(playlist.storeId ? { OR: [{ storeId: null }, { storeId: playlist.storeId }] } : { storeId: null }),
      },
      select: { id: true },
    })
    if (media.length !== ids.length) {
      return { ok: false, error: "One of those images belongs to another store. Use an image for this store or for all stores." }
    }

    await prisma.$transaction([
      prisma.screenPlaylist.update({ where: { id: playlist.id }, data: { name: input.name }, select: { id: true } }),
      prisma.screenSlide.deleteMany({ where: { playlistId: playlist.id } }),
      prisma.screenSlide.createMany({
        data: input.slides.map((s, i) => ({
          playlistId: playlist.id,
          mediaId: s.mediaId,
          position: i,
          seconds: clampSeconds(s.seconds),
        })),
      }),
    ])
    refresh()
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

/** Delete a playlist. Screens playing it go blank (they show "Nothing to show yet"). */
export async function deletePlaylist(playlistId: string): Promise<ScreensResult> {
  try {
    const accountId = await ownerAccount()
    const { count } = await prisma.screenPlaylist.deleteMany({ where: { id: id.parse(playlistId), accountId } })
    if (count === 0) return { ok: false, error: "That playlist is gone. Reload the page." }
    refresh()
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

/** Delete an image, from storage and from every playlist that had it. */
export async function deleteMedia(mediaId: string): Promise<ScreensResult> {
  try {
    const accountId = await ownerAccount()
    const media = await prisma.screenMedia.findFirst({
      where: { id: id.parse(mediaId), accountId },
      select: { id: true, blobKey: true },
    })
    if (!media) return { ok: false, error: "That image is gone. Reload the page." }
    await prisma.screenMedia.delete({ where: { id: media.id } })
    try {
      await deleteScreenMedia(media.blobKey)
    } catch (err) {
      logger.error("[screens] image delete from storage failed", { blobKey: media.blobKey, message: err instanceof Error ? err.message : String(err) })
    }
    refresh()
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}
