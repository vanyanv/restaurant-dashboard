import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"

/**
 * A lasting record of pairing changes, so "the TV keeps unpairing" can be
 * answered from data: an owner pressed Unpair, or a TV that was paired came
 * back with no pairing (it lost its saved token). Never throws: a missed
 * record must not fail the change it describes.
 */

export type ScreenEventKind = "paired" | "repaired" | "unpaired" | "code"

/** First 12 hex of the token hash: tells TVs apart without being usable as one. */
export function tvTag(tokenHash: string): string {
  return tokenHash.slice(0, 12)
}

export async function recordScreenEvent(e: {
  kind: ScreenEventKind
  tokenHash: string
  accountId?: string | null
  screenName?: string | null
  storeId?: string | null
  device?: string | null
  userId?: string | null
}): Promise<void> {
  try {
    await prisma.screenEvent.create({
      data: {
        kind: e.kind,
        tv: tvTag(e.tokenHash),
        accountId: e.accountId ?? null,
        screenName: e.screenName ?? null,
        storeId: e.storeId ?? null,
        device: e.device ?? null,
        userId: e.userId ?? null,
      },
      select: { id: true },
    })
  } catch (err) {
    logger.warn("[screens.event] could not record", { kind: e.kind, message: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * A TV asked for a new pairing code. Recorded only when that TV was paired
 * before, so random callers of the open endpoint leave nothing behind, and
 * a paired TV that lost its pairing always does.
 */
export async function noteCodeShown(tokenHash: string, device: string | null): Promise<void> {
  try {
    const before = await prisma.screenEvent.findFirst({
      where: { tv: tvTag(tokenHash), kind: { in: ["paired", "repaired"] } },
      orderBy: { at: "desc" },
      select: { accountId: true, screenName: true, storeId: true },
    })
    if (!before) return
    logger.warn("[screens.event] a paired TV is showing a code again", { screen: before.screenName, tv: tvTag(tokenHash) })
    await recordScreenEvent({ kind: "code", tokenHash, accountId: before.accountId, screenName: before.screenName, storeId: before.storeId, device })
  } catch (err) {
    logger.warn("[screens.event] could not check a new code", { message: err instanceof Error ? err.message : String(err) })
  }
}
