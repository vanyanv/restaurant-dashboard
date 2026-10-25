import { randomBytes, randomInt } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { DEFAULT_TEMPLATES } from "./defaults"

/**
 * First-use setup and the Harri crew sync. Both are idempotent: they run on
 * page loads and from the Harri cron, and a second run changes nothing.
 */

/** "Van Nuys" -> "van-nuys". */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "store"
  )
}

/** The store's public code: its name plus six random characters. */
export function newCheckCode(storeName: string): string {
  const token = randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 6).toLowerCase()
  return `${slugify(storeName)}-${token}`
}

/** Gives the store a check code and default checklists if it has none. */
export async function ensureCheckSetup(storeId: string): Promise<void> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, checkCode: true, _count: { select: { checkTemplates: true } } },
  })
  if (!store) return

  if (!store.checkCode) {
    await prisma.store.updateMany({
      where: { id: storeId, checkCode: null },
      data: { checkCode: newCheckCode(store.name) },
    })
  }

  if (store._count.checkTemplates < DEFAULT_TEMPLATES.length) {
    for (const t of DEFAULT_TEMPLATES) {
      const exists = await prisma.checkTemplate.findUnique({
        where: { storeId_kind: { storeId, kind: t.kind } },
        select: { id: true },
      })
      if (exists) continue
      try {
        await prisma.checkTemplate.create({
          data: {
            storeId,
            kind: t.kind,
            opensAtMin: t.opensAtMin,
            dueAtMin: t.dueAtMin,
            graceMin: t.graceMin,
            sections: {
              create: t.sections.map((s, si) => ({
                position: si,
                nameEn: s.nameEn,
                nameEs: s.nameEs,
                photoRequired: s.photoRequired,
                photoHintEn: s.photoHintEn,
                photoHintEs: s.photoHintEs,
                items: {
                  create: s.items.map(([en, es], ii) => ({ position: ii, textEn: en, textEs: es })),
                },
              })),
            },
          },
        })
      } catch (err) {
        // Two first loads racing: the other one created it. Anything else is real.
        if (!isUniqueViolation(err)) throw err
      }
    }
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002"
}

/** A 4-digit PIN not in `taken`. Never 0000-style repeats or 1234-style runs. */
export function pickPin(taken: Set<string>): string {
  for (let i = 0; i < 2000; i++) {
    const pin = String(randomInt(0, 10_000)).padStart(4, "0")
    if (taken.has(pin) || isWeakPin(pin)) continue
    return pin
  }
  throw new Error("This store has run out of PINs")
}

export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1{3}$/.test(pin)) return true
  const d = pin.split("").map(Number)
  const up = d.every((v, i) => i === 0 || v === d[i - 1] + 1)
  const down = d.every((v, i) => i === 0 || v === d[i - 1] - 1)
  return up || down
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin)
}

/** Harri statuses that mean the person still works here. */
export function harriIsActive(status: string | null): boolean {
  if (!status) return true
  return !/terminat|inactive|separat|disabled|deleted|archiv/i.test(status)
}

/** Why a crew member is off when an owner switched them off. The sync never undoes it. */
export const OWNER_OFF = "Turned off by owner"

export type CrewSyncResult = { added: number; reactivated: number; deactivated: number; updated: number }

/**
 * Brings a store's Harri crew in line with `HarriEmployee`.
 *
 *   - new active Harri people get a crew row and a fresh PIN
 *   - people Harri marks inactive (or no longer lists) are switched off and
 *     their PIN freed
 *   - someone who comes back gets a new PIN
 *   - names and email follow Harri; an owner's PIN is never touched
 *
 * Crew the owner added by hand are left alone.
 */
export async function syncCrewFromHarri(storeId: string): Promise<CrewSyncResult> {
  const [employees, crew] = await Promise.all([
    prisma.harriEmployee.findMany({
      where: { storeId },
      select: { userId: true, firstName: true, lastName: true, email: true, status: true },
    }),
    prisma.crewMember.findMany({
      where: { storeId },
      select: {
        id: true, source: true, harriUserId: true, pin: true, active: true,
        firstName: true, lastName: true, email: true, inactiveReason: true,
      },
    }),
  ])

  const taken = new Set(crew.map((c) => c.pin).filter((p): p is string => p !== null))
  const byHarri = new Map(crew.filter((c) => c.harriUserId !== null).map((c) => [c.harriUserId!, c]))
  const seen = new Set<number>()
  const result: CrewSyncResult = { added: 0, reactivated: 0, deactivated: 0, updated: 0 }

  for (const e of employees) {
    seen.add(e.userId)
    const name = (e.firstName ?? "").trim()
    if (!name) continue
    const active = harriIsActive(e.status)
    const existing = byHarri.get(e.userId)
    const lastName = e.lastName?.trim() || null
    const email = e.email?.trim() || null

    if (!existing) {
      if (!active) continue
      const pin = pickPin(taken)
      taken.add(pin)
      await prisma.crewMember.create({
        data: { storeId, source: "HARRI", harriUserId: e.userId, firstName: name, lastName, email, pin },
      })
      result.added += 1
      continue
    }

    if (active && !existing.active && existing.inactiveReason !== OWNER_OFF) {
      const pin = pickPin(taken)
      taken.add(pin)
      await prisma.crewMember.update({
        where: { id: existing.id },
        data: { active: true, inactiveReason: null, pin, firstName: name, lastName, email },
      })
      result.reactivated += 1
      continue
    }
    if (!existing.active) continue
    if (!active) {
      await deactivate(existing.id, "Inactive in Harri")
      if (existing.pin) taken.delete(existing.pin)
      result.deactivated += 1
      continue
    }
    if (existing.firstName !== name || existing.lastName !== lastName || existing.email !== email) {
      await prisma.crewMember.update({
        where: { id: existing.id },
        data: { firstName: name, lastName, email },
      })
      result.updated += 1
    }
  }

  for (const c of crew) {
    if (c.source !== "HARRI" || c.harriUserId === null || !c.active) continue
    if (seen.has(c.harriUserId)) continue
    await deactivate(c.id, "No longer in Harri")
    result.deactivated += 1
  }

  return result
}

async function deactivate(id: string, reason: string) {
  await prisma.crewMember.update({
    where: { id },
    data: { active: false, inactiveReason: reason, pin: null },
  })
}
