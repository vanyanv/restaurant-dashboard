/**
 * Photos taken with no signal, kept on the phone until they can be sent.
 *
 * Ticks waiting for signal already live in localStorage, but a photo cannot:
 * localStorage holds strings, a few megabytes in all, and a phone photo is
 * one or two megabytes on its own. Before this, a photo waiting for signal
 * lived only in the page's memory, so a reload (or the phone closing the tab
 * to save memory, which phones do) lost it while its tick survived.
 *
 * IndexedDB stores Blobs directly. One record per (queue, task); a newer
 * photo for the same task replaces the older one. Every call fails soft:
 * private browsing, a full disk or an old browser just means the photo is
 * held in memory as before.
 */

const DB = "crew-checks"
const STORE = "photos"
/** A photo nobody could send in two days belongs to a check that has long closed. */
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000

type Row = { id: string; queue: string; itemId: string; photo: Blob; savedAt: number }

let opening: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null)
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" }).createIndex("queue", "queue")
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const tx = db.transaction(STORE, mode)
          const req = work(tx.objectStore(STORE))
          tx.oncomplete = () => resolve(req ? (req.result as T) : null)
          tx.onerror = () => resolve(null)
          tx.onabort = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

const idOf = (queue: string, itemId: string) => `${queue}|${itemId}`

/** Keep this photo for the task. Resolves true once it is safely on the phone. */
export async function savePhoto(queue: string, itemId: string, photo: Blob): Promise<boolean> {
  const row: Row = { id: idOf(queue, itemId), queue, itemId, photo, savedAt: Date.now() }
  const out = await run("readwrite", (s) => s.put(row))
  return out !== null
}

export async function deletePhoto(queue: string, itemId: string): Promise<void> {
  await run("readwrite", (s) => s.delete(idOf(queue, itemId)))
}

/** Every photo kept for this queue, by task id. Also clears photos too old to matter. */
export async function loadPhotos(queue: string): Promise<Map<string, Blob>> {
  const rows = (await run<Row[]>("readonly", (s) => s.getAll())) ?? []
  const now = Date.now()
  const stale = rows.filter((r) => now - r.savedAt > MAX_AGE_MS)
  if (stale.length > 0) await run("readwrite", (s) => void stale.forEach((r) => s.delete(r.id)))
  return new Map(rows.filter((r) => r.queue === queue && now - r.savedAt <= MAX_AGE_MS).map((r) => [r.itemId, r.photo]))
}
