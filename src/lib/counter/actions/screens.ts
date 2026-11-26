"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { hasOwnerAccess } from "@/lib/auth"
import { getSession } from "@/lib/auth-scope"
import { checkThumbKey, deleteScreenMedia, screenFhdKey } from "@/lib/blob"
import { rateLimitKey } from "@/lib/rate-limit"
import { EVERY_DAY, IDENTIFY_MS, SLIDES_MAX, TIMES_MAX, clampSeconds, isPairCode, normalizeCode } from "@/lib/screens/core"
import { logger } from "@/lib/logger"
import { pingAccountTvs } from "@/lib/screens/push"

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

/** The pages show the change, and every TV in the account hears of it now rather than at its next check. */
async function refresh(accountId: string) {
  revalidatePath("/dashboard/screens")
  revalidatePath("/m/screens")
  await pingAccountTvs(accountId)
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

const name = (what: string) => z.string().trim().min(1, `Give the ${what} a name`).max(60, `Keep the ${what} name under 60 characters`)
const id = z.string().min(1).max(40)

const ClaimInput = z.object({
  code: z.string().max(20),
  storeId: id,
  name: name("screen"),
})

/** Every try counts, right or wrong, and is counted before the code is looked up. */
const CLAIM_LIMIT = { limit: 20, windowMs: 10 * 60_000 }
const CLAIM_LIMIT_IP = { limit: 30, windowMs: 10 * 60_000 }

/** Pair the TV showing `code`: it becomes the screen `name` in `storeId`, with nothing on it yet. */
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
        // Re-pairing a TV of this account (a reset, a move) keeps its pictures on the same row.
        return tx.screen.update({
          where: { id: existing.id },
          data: { storeId: input.storeId, name: input.name, pairedAt: new Date(), lastSeenAt: null },
          select: { id: true },
        })
      }
      return tx.screen.create({
        data: {
          accountId,
          storeId: input.storeId,
          name: input.name,
          tokenHash: pairing.tokenHash,
          device: pairing.device,
        },
        select: { id: true },
      })
    })

    await refresh(accountId)
    return { ok: true, id: screen.id }
  } catch (err) {
    return fail(err)
  }
}

const ScreenInput = z.object({ screenId: id, name: name("screen"), storeId: id })

/** Rename a screen or move it to another store. Its pictures go with it. */
export async function updateScreen(raw: z.input<typeof ScreenInput>): Promise<ScreensResult> {
  try {
    const input = ScreenInput.parse(raw)
    const accountId = await ownerAccount()
    await ownStore(accountId, input.storeId)
    const { count } = await prisma.screen.updateMany({
      where: { id: input.screenId, accountId },
      data: { name: input.name, storeId: input.storeId },
    })
    if (count === 0) return { ok: false, error: "That screen is gone. Reload the page." }
    await refresh(accountId)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

/** Unpair a screen, and drop the picture lists only it used. The TV goes back to showing a code. */
export async function removeScreen(screenId: string): Promise<ScreensResult> {
  try {
    const accountId = await ownerAccount()
    const screen = await prisma.screen.findFirst({
      where: { id: id.parse(screenId), accountId },
      select: { id: true, playlistId: true, times: { select: { playlistId: true } } },
    })
    if (!screen) return { ok: false, error: "That screen is gone. Reload the page." }
    const lists = [screen.playlistId, ...screen.times.map((t) => t.playlistId)].filter((x): x is string => x !== null)
    await prisma.$transaction([
      prisma.screen.delete({ where: { id: screen.id }, select: { id: true } }),
      prisma.screenPlaylist.deleteMany({ where: { id: { in: lists }, accountId, screens: { none: {} }, times: { none: {} } } }),
    ])
    await refresh(accountId)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

const Slides = z.array(z.object({ mediaId: id, seconds: z.number() })).max(SLIDES_MAX, `A screen holds up to ${SLIDES_MAX} pictures`)
const SetInput = z
  .array(
    z.object({
      screenId: id,
      /** Null: the pictures shown outside every window. */
      timeId: id.nullable(),
      slides: Slides,
      /** The pictures this change was made from, so it can't wipe out someone else's. */
      was: z.array(id).max(SLIDES_MAX).optional(),
    }),
  )
  .min(1)
  .max(100, "That's too many screens at once")

/**
 * Put pictures on screens: one call for a drop on one TV, on a whole store,
 * or for an undo. Each screen (and each window on it) owns its list; a list
 * still shared from before this is copied, so changing one TV never changes
 * another. All or nothing, and one at a time per screen: the Screen rows are
 * locked first, so two owners saving at once can't leave both lists mixed.
 */
export async function setPictures(raw: z.input<typeof SetInput>): Promise<ScreensResult> {
  try {
    const changes = SetInput.parse(raw)
    const accountId = await ownerAccount()
    const keyOf = (c: { screenId: string; timeId: string | null }) => c.timeId ?? c.screenId
    if (new Set(changes.map(keyOf)).size !== changes.length) throw new Refused("Couldn't save. Try again.")

    const screenIds = [...new Set(changes.map((c) => c.screenId))]
    const mediaIds = [...new Set(changes.flatMap((c) => c.slides.map((s) => s.mediaId)))]
    const media = await prisma.screenMedia.findMany({ where: { id: { in: mediaIds }, accountId }, select: { id: true, storeId: true } })
    const mediaById = new Map(media.map((m) => [m.id, m]))

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Screen" WHERE "id" IN (${Prisma.join(screenIds)}) AND "accountId" = ${accountId} ORDER BY "id" FOR UPDATE`
      const list = { orderBy: { position: "asc" }, select: { mediaId: true } } as const
      const screens = await tx.screen.findMany({
        where: { id: { in: screenIds }, accountId },
        select: {
          id: true,
          name: true,
          storeId: true,
          playlistId: true,
          playlist: { select: { slides: list, _count: { select: { screens: true, times: true } } } },
          times: { select: { id: true, playlistId: true, playlist: { select: { slides: list } } } },
        },
      })
      const screenById = new Map(screens.map((s) => [s.id, s]))

      const fresh: { id: string; screenId: string; name: string }[] = []
      const left: string[] = []
      const targets = changes.map((c) => {
        const s = screenById.get(c.screenId)
        if (!s) throw new Refused("That screen is gone. Reload the page.")
        for (const x of c.slides) {
          const m = mediaById.get(x.mediaId)
          if (!m) throw new Refused("That picture is gone. Reload the page.")
          if (m.storeId && m.storeId !== s.storeId) throw new Refused("That picture is for another store only.")
        }
        const time = c.timeId ? s.times.find((x) => x.id === c.timeId) : null
        if (c.timeId && !time) throw new Refused("That time is gone. Reload the page.")
        const held = (time ? time.playlist.slides : (s.playlist?.slides ?? [])).map((x) => x.mediaId)
        if (c.was && c.was.join() !== held.join()) throw new Refused(`${s.name} was changed somewhere else. Look again, then redo it.`)

        let playlistId: string
        if (time) playlistId = time.playlistId
        else if (s.playlistId && s.playlist?._count.screens === 1 && s.playlist._count.times === 0) playlistId = s.playlistId
        else {
          playlistId = randomUUID()
          fresh.push({ id: playlistId, screenId: s.id, name: s.name })
          if (s.playlistId) left.push(s.playlistId)
        }
        return { playlistId, slides: c.slides }
      })

      if (fresh.length) {
        await tx.screenPlaylist.createMany({ data: fresh.map((f) => ({ id: f.id, accountId, storeId: null, name: f.name })) })
        await tx.$executeRaw`UPDATE "Screen" AS s SET "playlistId" = v.pid, "updatedAt" = now()
          FROM (VALUES ${Prisma.join(fresh.map((f) => Prisma.sql`(${f.screenId}, ${f.id})`))}) AS v(sid, pid)
          WHERE s."id" = v.sid AND s."accountId" = ${accountId}`
        if (left.length) {
          await tx.screenPlaylist.deleteMany({ where: { id: { in: left }, accountId, screens: { none: {} }, times: { none: {} } } })
        }
      }
      await tx.screenSlide.deleteMany({ where: { playlistId: { in: targets.map((t) => t.playlistId) } } })
      await tx.screenSlide.createMany({
        data: targets.flatMap((t) =>
          t.slides.map((s, i) => ({ playlistId: t.playlistId, mediaId: s.mediaId, position: i, seconds: clampSeconds(s.seconds) })),
        ),
      })
    })
    await refresh(accountId)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

const minute = z.number().int().min(0).max(1439)
const Window = { name: name("time"), days: z.number().int().min(1, "Pick at least one day").max(EVERY_DAY), start: minute, end: minute }
const AddTimeInput = z.object({ screenId: id, ...Window })

/** Different pictures for part of the week on one screen. Starts with none, so the usual pictures stay until one is added. */
export async function addTime(raw: z.input<typeof AddTimeInput>): Promise<ScreensResult> {
  try {
    const input = AddTimeInput.parse(raw)
    const accountId = await ownerAccount()
    const screen = await prisma.screen.findFirst({
      where: { id: input.screenId, accountId },
      select: { id: true, _count: { select: { times: true } } },
    })
    if (!screen) return { ok: false, error: "That screen is gone. Reload the page." }
    if (screen._count.times >= TIMES_MAX) return { ok: false, error: `A screen holds up to ${TIMES_MAX} times` }
    const time = await prisma.screenTime.create({
      data: {
        name: input.name,
        days: input.days,
        startMinute: input.start,
        endMinute: input.end,
        screen: { connect: { id: screen.id } },
        playlist: { create: { accountId, storeId: null, name: input.name } },
      },
      select: { id: true },
    })
    await refresh(accountId)
    return { ok: true, id: time.id }
  } catch (err) {
    return fail(err)
  }
}

const UpdateTimeInput = z.object({ timeId: id, ...Window })

export async function updateTime(raw: z.input<typeof UpdateTimeInput>): Promise<ScreensResult> {
  try {
    const input = UpdateTimeInput.parse(raw)
    const accountId = await ownerAccount()
    const { count } = await prisma.screenTime.updateMany({
      where: { id: input.timeId, screen: { accountId } },
      data: { name: input.name, days: input.days, startMinute: input.start, endMinute: input.end },
    })
    if (count === 0) return { ok: false, error: "That time is gone. Reload the page." }
    await refresh(accountId)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

/** Remove a window; the screen's usual pictures show instead. */
export async function removeTime(timeId: string): Promise<ScreensResult> {
  try {
    const accountId = await ownerAccount()
    const time = await prisma.screenTime.findFirst({
      where: { id: id.parse(timeId), screen: { accountId } },
      select: { id: true, playlistId: true },
    })
    if (!time) return { ok: false, error: "That time is gone. Reload the page." }
    await prisma.$transaction([
      prisma.screenTime.delete({ where: { id: time.id }, select: { id: true } }),
      prisma.screenPlaylist.deleteMany({ where: { id: time.playlistId, accountId, screens: { none: {} }, times: { none: {} } } }),
    ])
    await refresh(accountId)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

/** "Which TV is which?": every TV shows its own name for a short while. `on: false` ends it early. */
export async function identifyScreens(on: boolean): Promise<ScreensResult> {
  try {
    const accountId = await ownerAccount()
    await prisma.screen.updateMany({
      where: { accountId },
      data: { identifyUntil: on ? new Date(Date.now() + IDENTIFY_MS) : null },
    })
    await pingAccountTvs(accountId)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

/** Delete a picture, from storage and from every screen that had it. */
export async function deleteMedia(mediaId: string): Promise<ScreensResult> {
  try {
    const accountId = await ownerAccount()
    const media = await prisma.screenMedia.findFirst({
      where: { id: id.parse(mediaId), accountId },
      select: { id: true, blobKey: true, originalKey: true },
    })
    if (!media) return { ok: false, error: "That picture is gone. Reload the page." }
    await prisma.screenMedia.delete({ where: { id: media.id } })
    try {
      await Promise.all([
        deleteScreenMedia(media.blobKey),
        deleteScreenMedia(checkThumbKey(media.blobKey)),
        deleteScreenMedia(screenFhdKey(media.blobKey)),
        ...(media.originalKey ? [deleteScreenMedia(media.originalKey)] : []),
      ])
    } catch (err) {
      logger.error("[screens] image delete from storage failed", { blobKey: media.blobKey, message: err instanceof Error ? err.message : String(err) })
    }
    await refresh(accountId)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}
