// Crew check photos leave storage after the account's keep time; the rows
// stay and are stamped, and only once storage confirms both copies are gone.

import { describe, it, expect, vi, beforeEach } from "vitest"

type Mark = { id: string; accountId: string; photoKey: string | null; photoPurgedAt: Date | null; at: Date }
type Photo = { id: string; accountId: string; storageKey: string; purgedAt: Date | null; createdAt: Date }

const { db, deleted, refuse, thumb } = vi.hoisted(() => ({
  db: { accounts: [] as Array<{ id: string; checkPhotoKeepDays: number | null }>, marks: [] as Mark[], photos: [] as Photo[] },
  deleted: [] as string[][],
  refuse: new Set<string>(),
  thumb: (k: string) => `${k.replace(/\.[A-Za-z0-9]+$/, "")}.thumb.jpg`,
}))

vi.mock("@/lib/blob", () => ({
  checkThumbKey: thumb,
  async deleteCheckObjects(keys: string[]) {
    deleted.push(keys)
    return new Set(keys.filter((k) => !refuse.has(k)))
  },
}))

vi.mock("@/lib/prisma", () => {
  const acct = (w: { store?: { accountId: string }; submission?: { store: { accountId: string } } }) =>
    w.store?.accountId ?? w.submission?.store.accountId
  return {
    prisma: {
      account: {
        findMany: async ({ where }: { where: { id?: string } }) =>
          db.accounts.filter((a) => a.checkPhotoKeepDays !== null && (!where.id || a.id === where.id)),
      },
      checkMark: {
        findMany: async ({ where, take }: { where: { at: { lt: Date } } & Parameters<typeof acct>[0]; take: number }) =>
          db.marks
            .filter((m) => m.accountId === acct(where) && m.photoKey && !m.photoPurgedAt && m.at < where.at.lt)
            .slice(0, take)
            .map((m) => ({ photoKey: m.photoKey })),
        updateMany: ({ where, data }: { where: { photoKey: { in: string[] } } & Parameters<typeof acct>[0]; data: { photoPurgedAt: Date } }) => {
          for (const m of db.marks)
            if (m.accountId === acct(where) && m.photoKey && where.photoKey.in.includes(m.photoKey) && !m.photoPurgedAt)
              m.photoPurgedAt = data.photoPurgedAt
          return Promise.resolve()
        },
      },
      checkPhoto: {
        findMany: async ({ where, take }: { where: { createdAt: { lt: Date } } & Parameters<typeof acct>[0]; take: number }) =>
          db.photos
            .filter((p) => p.accountId === acct(where) && !p.purgedAt && p.createdAt < where.createdAt.lt)
            .slice(0, take)
            .map((p) => ({ storageKey: p.storageKey })),
        updateMany: ({ where, data }: { where: { storageKey: { in: string[] } } & Parameters<typeof acct>[0]; data: { purgedAt: Date } }) => {
          for (const p of db.photos)
            if (p.accountId === acct(where) && where.storageKey.in.includes(p.storageKey) && !p.purgedAt) p.purgedAt = data.purgedAt
          return Promise.resolve()
        },
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    },
  }
})

import { purgeOldCheckPhotos } from "@/lib/checks/photo-retention"

const now = new Date("2026-11-27T08:30:00Z")
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)

beforeEach(() => {
  db.accounts = [{ id: "a1", checkPhotoKeepDays: 7 }, { id: "a2", checkPhotoKeepDays: null }]
  db.marks = [
    { id: "m-old", accountId: "a1", photoKey: "checks/s1/old.jpg", photoPurgedAt: null, at: daysAgo(8) },
    { id: "m-new", accountId: "a1", photoKey: "checks/s1/new.jpg", photoPurgedAt: null, at: daysAgo(2) },
    { id: "m-none", accountId: "a1", photoKey: null, photoPurgedAt: null, at: daysAgo(20) },
    { id: "m-other", accountId: "a2", photoKey: "checks/s9/x.jpg", photoPurgedAt: null, at: daysAgo(30) },
  ]
  db.photos = [
    // The closed check's copy of the old mark photo: same key.
    { id: "p-old", accountId: "a1", storageKey: "checks/s1/old.jpg", purgedAt: null, createdAt: daysAgo(7.9) },
    // A section photo from before per-task photos.
    { id: "p-section", accountId: "a1", storageKey: "checks/s1/sec.jpg", purgedAt: null, createdAt: daysAgo(30) },
  ]
  deleted.length = 0
  refuse.clear()
})

describe("purgeOldCheckPhotos", () => {
  it("deletes photos and small copies past the keep time, once per key, and stamps every row holding them", async () => {
    const out = await purgeOldCheckPhotos({ now, accountId: null })
    expect(out).toEqual([{ accountId: "a1", keepDays: 7, photos: 2, capped: false }])
    expect(deleted.flat().sort()).toEqual(
      ["checks/s1/old.jpg", "checks/s1/old.thumb.jpg", "checks/s1/sec.jpg", "checks/s1/sec.thumb.jpg"].sort(),
    )
    expect(db.marks.find((m) => m.id === "m-old")!.photoPurgedAt).toEqual(now)
    expect(db.photos.every((p) => p.purgedAt?.getTime() === now.getTime())).toBe(true)
    // Newer photos and other rows stay.
    expect(db.marks.find((m) => m.id === "m-new")!.photoPurgedAt).toBeNull()
  })

  it("leaves an account with no keep time set alone", async () => {
    await purgeOldCheckPhotos({ now, accountId: null })
    expect(db.marks.find((m) => m.id === "m-other")!.photoPurgedAt).toBeNull()
    expect(deleted.flat()).not.toContain("checks/s9/x.jpg")
  })

  it("an owner's manual run touches only their account", async () => {
    db.accounts[1].checkPhotoKeepDays = 7
    await purgeOldCheckPhotos({ now, accountId: "a1" })
    expect(db.marks.find((m) => m.id === "m-other")!.photoPurgedAt).toBeNull()
  })

  it("never keeps less than the floor, whatever is stored", async () => {
    db.accounts[0].checkPhotoKeepDays = 1
    await purgeOldCheckPhotos({ now, accountId: null })
    expect(db.marks.find((m) => m.id === "m-new")!.photoPurgedAt).toBeNull()
  })

  it("does not stamp a row whose file storage would not delete, and reports the failure", async () => {
    refuse.add("checks/s1/sec.thumb.jpg")
    await expect(purgeOldCheckPhotos({ now, accountId: null })).rejects.toThrow(/could not be deleted/)
    expect(db.photos.find((p) => p.id === "p-section")!.purgedAt).toBeNull()
    expect(db.marks.find((m) => m.id === "m-old")!.photoPurgedAt).toEqual(now)
  })

  it("does nothing when nothing is old enough", async () => {
    db.marks = db.marks.filter((m) => m.id === "m-new")
    db.photos = []
    expect(await purgeOldCheckPhotos({ now, accountId: null })).toEqual([{ accountId: "a1", keepDays: 7, photos: 0, capped: false }])
    expect(deleted).toEqual([])
  })
})
