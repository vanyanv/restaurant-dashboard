"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireOwnerStore } from "@/lib/auth-scope"
import { checkLink } from "@/lib/checks/crew"
import { sendPinEmail } from "@/lib/checks/email"
import {
  isUniqueViolation,
  newCheckCode,
  isWeakPin,
  OWNER_OFF,
  pickPin,
  syncCrewFromHarri,
} from "@/lib/checks/setup"
import { dayToDb } from "@/lib/checks/time"

/**
 * The owner's write path for store checks. Every action starts from
 * `requireOwnerStore`, which checks the session, owner access and that the
 * store is in the caller's account, so a crafted id from another tenant is
 * refused before anything is read.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

const KIND = z.enum(["MORNING", "TRANSITION", "EVENING"])
const text = (max: number) => z.string().trim().max(max)

const ChecklistInput = z.object({
  storeId: z.string().min(1),
  kind: KIND,
  // Past 1439 opens after midnight and still counts for the night before.
  opensAtMin: z.number().int().min(0).max(1440 + 6 * 60 - 1, "A check that opens after midnight has to open before 6:00 am"),
  dueAtMin: z.number().int().min(1).max(1440 + 6 * 60),
  /** Empty, or seven due times (Sunday first) for stores whose close moves by night. */
  dueByWeekday: z.array(z.number().int().min(1).max(1440 + 6 * 60)).refine((a) => a.length === 0 || a.length === 7, "Set a due time for every day").optional(),
  graceMin: z.number().int().min(0).max(240),
  enabled: z.boolean(),
  sections: z
    .array(
      z.object({
        nameEn: text(60).min(1, "Every section needs a name"),
        nameEs: text(60),
        photoRequired: z.boolean(),
        hintEn: text(120),
        hintEs: text(120),
        items: z.array(z.object({ en: text(140).min(1, "An item is empty"), es: text(140) })).max(40),
      }),
    )
    .min(1, "A check needs at least one section")
    .max(8),
})

function revalidateChecks() {
  revalidatePath("/dashboard/checks", "layout")
}

function fail(err: unknown): ActionResult {
  if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Check the form" }
  if (err instanceof Error && ["Unauthorized", "Forbidden", "Store not found"].includes(err.message)) {
    return { ok: false, error: err.message }
  }
  console.error("[checks.action]", err)
  return { ok: false, error: "Couldn't save. Try again." }
}

export async function saveChecklist(raw: z.input<typeof ChecklistInput>): Promise<ActionResult> {
  try {
    const input = ChecklistInput.parse(raw)
    // Seven equal days are the same as none, and keep the summary short.
    const byDay = input.dueByWeekday ?? []
    const dueByWeekday = byDay.every((d) => d === input.dueAtMin) ? [] : byDay
    for (const due of [input.dueAtMin, ...dueByWeekday]) {
      if (due <= input.opensAtMin) return { ok: false, error: "The due time has to be after the open time" }
      // One day's window, grace included, must close before the next day's opens.
      if (due + input.graceMin - input.opensAtMin >= 1440) {
        return { ok: false, error: "The check window, with its late time, has to be shorter than a day" }
      }
    }
    await requireOwnerStore(input.storeId)
    const tpl = await prisma.checkTemplate.findUnique({
      where: { storeId_kind: { storeId: input.storeId, kind: input.kind } },
      select: { id: true },
    })
    if (!tpl) return { ok: false, error: "That check doesn't exist yet. Reload the page." }
    await prisma.$transaction([
      prisma.checkSection.deleteMany({ where: { templateId: tpl.id } }),
      prisma.checkTemplate.update({
        where: { id: tpl.id },
        data: {
          opensAtMin: input.opensAtMin,
          dueAtMin: input.dueAtMin,
          dueByWeekday,
          graceMin: input.graceMin,
          enabled: input.enabled,
          sections: {
            create: input.sections.map((s, si) => ({
              position: si,
              nameEn: s.nameEn,
              nameEs: s.nameEs || null,
              photoRequired: s.photoRequired,
              photoHintEn: s.hintEn || null,
              photoHintEs: s.hintEs || null,
              items: {
                create: s.items.map((i, ii) => ({ position: ii, textEn: i.en, textEs: i.es || null })),
              },
            })),
          },
        },
      }),
    ])
    revalidateChecks()
    return { ok: true, message: "Saved. The next check uses this list." }
  } catch (err) {
    return fail(err)
  }
}

/** Copies one store's checklist (window and items) onto every other store. */
export async function copyChecklistToOtherStores(input: { storeId: string; kind: string }): Promise<ActionResult> {
  try {
    const kind = KIND.parse(input.kind)
    await requireOwnerStore(input.storeId)
    const source = await prisma.checkTemplate.findUnique({
      where: { storeId_kind: { storeId: input.storeId, kind } },
      include: { sections: { orderBy: { position: "asc" }, include: { items: { orderBy: { position: "asc" } } } }, store: { select: { accountId: true } } },
    })
    if (!source) return { ok: false, error: "Nothing to copy yet" }
    const targets = await prisma.store.findMany({
      where: { accountId: source.store.accountId, isActive: true, id: { not: input.storeId } },
      select: { id: true },
    })
    for (const t of targets) {
      const sections = source.sections.map((s) => ({
        nameEn: s.nameEn,
        nameEs: s.nameEs ?? "",
        photoRequired: s.photoRequired,
        hintEn: s.photoHintEn ?? "",
        hintEs: s.photoHintEs ?? "",
        items: s.items.map((i) => ({ en: i.textEn, es: i.textEs ?? "" })),
      }))
      const existing = await prisma.checkTemplate.findUnique({
        where: { storeId_kind: { storeId: t.id, kind } },
        select: { id: true },
      })
      if (!existing) {
        await prisma.checkTemplate.create({
          data: { storeId: t.id, kind, opensAtMin: source.opensAtMin, dueAtMin: source.dueAtMin, graceMin: source.graceMin },
        })
      }
      const r = await saveChecklist({
        storeId: t.id,
        kind,
        opensAtMin: source.opensAtMin,
        dueAtMin: source.dueAtMin,
        dueByWeekday: source.dueByWeekday,
        graceMin: source.graceMin,
        enabled: source.enabled,
        sections,
      })
      if (!r.ok) return r
    }
    revalidateChecks()
    return { ok: true, message: `Copied to ${targets.length} other store${targets.length === 1 ? "" : "s"}.` }
  } catch (err) {
    return fail(err)
  }
}

export async function setStoreClosed(input: { storeId: string; day: string; closed: boolean }): Promise<ActionResult> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) || Number.isNaN(dayToDb(input.day).getTime())) {
      return { ok: false, error: "Bad date" }
    }
    await requireOwnerStore(input.storeId)
    const businessDate = dayToDb(input.day)
    if (input.closed) {
      await prisma.checkClosure.upsert({
        where: { storeId_businessDate: { storeId: input.storeId, businessDate } },
        create: { storeId: input.storeId, businessDate },
        update: {},
      })
      // A missed alert raised before the owner said "closed" no longer applies.
      await prisma.alert.updateMany({
        where: { storeId: input.storeId, source: "STORE_CHECK", occurredOn: businessDate, status: "OPEN" },
        data: { status: "DISMISSED", explanation: "Store closed that day" },
      })
    } else {
      await prisma.checkClosure.deleteMany({ where: { storeId: input.storeId, businessDate } })
    }
    revalidateChecks()
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// ─── Crew ───────────────────────────────────────────────────────────────────

const CrewInput = z.object({
  firstName: text(40).min(1, "First name is required"),
  lastName: text(40),
  email: z.union([z.literal(""), z.string().trim().email("That email doesn't look right").max(120)]),
  pin: z.union([
    z.literal(""),
    z
      .string()
      .regex(/^\d{4}$/, "A PIN is exactly 4 digits")
      .refine((p) => !isWeakPin(p), "Too easy to guess. Skip repeats like 1111 and runs like 1234."),
  ]),
})

async function crewInAccount(crewId: string) {
  const crew = await prisma.crewMember.findUnique({
    where: { id: crewId },
    select: { id: true, storeId: true, firstName: true, email: true, pin: true, active: true, store: { select: { name: true, checkCode: true } } },
  })
  if (!crew) throw new Error("Store not found")
  await requireOwnerStore(crew.storeId)
  return crew
}

async function takenPins(storeId: string, exceptId?: string): Promise<Set<string>> {
  const rows = await prisma.crewMember.findMany({
    where: { storeId, pin: { not: null }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { pin: true },
  })
  return new Set(rows.map((r) => r.pin!))
}

export async function addCrewMember(raw: { storeId: string } & z.input<typeof CrewInput>): Promise<ActionResult> {
  try {
    const input = CrewInput.parse(raw)
    await requireOwnerStore(raw.storeId)
    const taken = await takenPins(raw.storeId)
    if (input.pin && taken.has(input.pin)) return { ok: false, error: "Someone at this store already has that PIN" }
    const pin = input.pin || pickPin(taken)
    await prisma.crewMember.create({
      data: {
        storeId: raw.storeId,
        source: "MANUAL",
        firstName: input.firstName,
        lastName: input.lastName || null,
        email: input.email || null,
        pin,
      },
    })
    revalidateChecks()
    return { ok: true, message: `Added. PIN ${pin}.` }
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "Someone at this store already has that PIN" }
    return fail(err)
  }
}

export async function updateCrewMember(raw: { crewId: string } & z.input<typeof CrewInput>): Promise<ActionResult> {
  try {
    const input = CrewInput.parse(raw)
    const crew = await crewInAccount(raw.crewId)
    if (input.pin && input.pin !== crew.pin) {
      if (!crew.active) return { ok: false, error: "Turn this person on before giving them a PIN" }
      const taken = await takenPins(crew.storeId, crew.id)
      if (taken.has(input.pin)) return { ok: false, error: "Someone at this store already has that PIN" }
    }
    await prisma.crewMember.update({
      where: { id: crew.id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName || null,
        email: input.email || null,
        ...(input.pin && crew.active ? { pin: input.pin } : {}),
      },
    })
    revalidateChecks()
    return { ok: true, message: "Saved." }
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "Someone at this store already has that PIN" }
    return fail(err)
  }
}

export async function setCrewActive(input: { crewId: string; active: boolean }): Promise<ActionResult> {
  try {
    const crew = await crewInAccount(input.crewId)
    if (input.active === crew.active) return { ok: true }
    if (input.active) {
      const pin = pickPin(await takenPins(crew.storeId, crew.id))
      await prisma.crewMember.update({ where: { id: crew.id }, data: { active: true, inactiveReason: null, pin } })
      revalidateChecks()
      return { ok: true, message: `Turned on with PIN ${pin}.` }
    }
    await prisma.crewMember.update({
      where: { id: crew.id },
      data: { active: false, inactiveReason: OWNER_OFF, pin: null },
    })
    revalidateChecks()
    return { ok: true, message: "Turned off. Their PIN no longer works." }
  } catch (err) {
    return fail(err)
  }
}

export async function emailCrewPin(input: { crewId: string }): Promise<ActionResult> {
  try {
    const crew = await crewInAccount(input.crewId)
    if (!crew.active || !crew.pin) return { ok: false, error: "This person has no PIN" }
    if (!crew.email) return { ok: false, error: "Add an email first" }
    const sent = await sendPinEmail({
      to: crew.email,
      firstName: crew.firstName,
      storeName: crew.store.name,
      pin: crew.pin,
      link: crew.store.checkCode ? checkLink(crew.store.checkCode) : "",
    })
    if (!sent.ok) return { ok: false, error: sent.reason }
    await prisma.crewMember.update({ where: { id: crew.id }, data: { pinEmailedAt: new Date() } })
    revalidateChecks()
    return { ok: true, message: `Sent to ${crew.email}.` }
  } catch (err) {
    return fail(err)
  }
}

/**
 * Pulls the store's roster from Harri, then hands out and takes back PINs.
 * The Harri call can fail (expired login, Harri down); the PIN sync still
 * runs on the roster already stored, and the message says which happened.
 */
export async function syncStoreCrew(input: { storeId: string }): Promise<ActionResult> {
  try {
    await requireOwnerStore(input.storeId)
    let harriNote = ""
    const brands = await prisma.harriBrand.findMany({ where: { storeId: input.storeId, active: true }, select: { brandId: true } })
    if (brands.length > 0) {
      try {
        // The roster refresh only looks up people it has already seen in
        // shifts or clock alerts. A store linked to Harri today has neither,
        // so pull the last eight weeks of schedule (and the published weeks
        // ahead) first; otherwise its first sync finds nobody.
        const { runHarriScheduleSync } = await import("@/lib/harri-schedule-sync")
        const day = 24 * 60 * 60 * 1000
        const schedule = await runHarriScheduleSync({
          storeId: input.storeId,
          startDate: new Date(Date.now() - 56 * day),
          endDate: new Date(Date.now() + 14 * day),
          triggeredBy: "manual",
        })
        if (schedule.weeksOk === 0) {
          harriNote = " Harri didn't send this store's schedule, so its crew may be missing. Check the Harri login can see this location."
        }
        const { refreshHarriEmployees } = await import("@/lib/harri-employee-sync")
        for (const b of brands) {
          await refreshHarriEmployees({ storeId: input.storeId, brandId: b.brandId, triggeredBy: "manual" })
        }
      } catch (err) {
        console.warn("[checks.sync] Harri refresh failed", err)
        harriNote = " Harri didn't answer, so this used the roster from the last sync."
      }
    }
    const r = await syncCrewFromHarri(input.storeId)
    revalidateChecks()
    const parts = [
      r.added && `${r.added} added`,
      r.reactivated && `${r.reactivated} back`,
      r.deactivated && `${r.deactivated} turned off`,
      r.updated && `${r.updated} updated`,
    ].filter(Boolean)
    return { ok: true, message: `${parts.length ? parts.join(", ") : "No changes"}.${harriNote}` }
  } catch (err) {
    return fail(err)
  }
}

/** A new poster link for the store. Every poster printed before stops working. */
export async function rotateCheckLink(input: { storeId: string }): Promise<ActionResult> {
  try {
    const store = await requireOwnerStore(input.storeId)
    await prisma.store.update({ where: { id: store.id }, data: { checkCode: newCheckCode(store.name) } })
    revalidateChecks()
    return { ok: true, message: "New link made. Print the new poster; the old one no longer works." }
  } catch (err) {
    return fail(err)
  }
}

