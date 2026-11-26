import { SCREEN_MEDIA_MAX_BYTES, SCREEN_ORIGINAL_MAX_BYTES, SCREEN_PART_BYTES } from "@/lib/screens/limits"

/**
 * Send a picture to Screens at full quality. A picture that fits a 4K screen
 * is sent exactly as it is, in parts when it is big (Vercel refuses a body
 * over 4.5 MB). Only one with more pixels than 4K, or over the size limit, is
 * redrawn for the TV: as a PNG, which loses nothing, or a 100% JPEG only when
 * the PNG would be over the limit. The owner's file is then kept too,
 * untouched, beside the TV's copy.
 */

const MAX_W = 3840
const MAX_H = 2160
const THUMB_W = 640

type Source = ImageBitmap | HTMLImageElement

async function decode(file: Blob): Promise<Source> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file)
    } catch {
      // Fall through to <img>, which some browsers decode where createImageBitmap won't.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function sizeOf(src: Source) {
  return "naturalWidth" in src ? { w: src.naturalWidth, h: src.naturalHeight } : { w: src.width, h: src.height }
}

/** Redrawn in halves, so fine text stays smooth instead of skipping pixels. */
function redraw(src: Source, w: number, h: number): HTMLCanvasElement {
  let from: CanvasImageSource = src
  let { w: cw, h: ch } = sizeOf(src)
  for (;;) {
    const nw = Math.max(w, Math.ceil(cw / 2))
    const nh = Math.max(h, Math.ceil(ch / 2))
    const c = document.createElement("canvas")
    c.width = nw
    c.height = nh
    const ctx = c.getContext("2d")
    if (!ctx) throw new Error("this browser can't resize pictures")
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(from, 0, 0, nw, nh)
    if (nw === w && nh === h) return c
    from = c
    cw = nw
    ch = nh
  }
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((r) => c.toBlob(r, type, quality))
}

/** `original` is the owner's own file, set only when `blob` is a redrawn copy of it. */
export type Prepared = { blob: Blob; width: number; height: number; thumb: Blob | null; original: File | null }

export async function prepareUpload(file: File): Promise<Prepared> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("use a JPG, PNG or WebP picture")
  const src = await decode(file)
  const { w, h } = sizeOf(src)
  const tw = Math.min(THUMB_W, w)
  const thumb = await toBlob(redraw(src, tw, Math.max(1, Math.round((h * tw) / w))), "image/jpeg", 0.82)

  const scale = Math.min(1, MAX_W / w, MAX_H / h)
  if (scale === 1 && file.size <= SCREEN_MEDIA_MAX_BYTES) return { blob: file, width: w, height: h, thumb, original: null }
  if (file.size > SCREEN_ORIGINAL_MAX_BYTES) throw new Error("that picture is over 100 MB. Export a smaller copy")

  const canvas = redraw(src, Math.round(w * scale), Math.round(h * scale))
  const size = { width: canvas.width, height: canvas.height, thumb, original: file }
  const png = await toBlob(canvas, "image/png")
  if (png && png.size <= SCREEN_MEDIA_MAX_BYTES) return { blob: png, ...size }
  for (const quality of [1, 0.97, 0.93]) {
    const jpg = await toBlob(canvas, "image/jpeg", quality)
    if (jpg && jpg.size <= SCREEN_MEDIA_MAX_BYTES) return { blob: jpg, ...size }
  }
  throw new Error("that picture is too large")
}

/** Upload one picture and return its id. Throws with words to show. */
export async function uploadPicture(file: File): Promise<string> {
  const { blob, width, height, thumb, original } = await prepareUpload(file)
  const sent = await Promise.all([sendParts(blob), original ? sendParts(original) : null])
  const [{ upload, parts }, kept] = sent

  const form = new FormData()
  form.set("upload", upload)
  form.set("parts", String(parts))
  if (kept) {
    form.set("original", kept.upload)
    form.set("originalParts", String(kept.parts))
  }
  form.set("name", file.name.replace(/\.[^.]+$/, ""))
  form.set("width", String(width))
  form.set("height", String(height))
  if (thumb) form.set("thumb", thumb, "thumb.jpg")
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("/api/screens/media", { method: "POST", body: form }).catch(() => null)
    const said = ((await res?.json().catch(() => null)) ?? {}) as { id?: string; error?: string }
    if (res?.ok && said.id) return said.id
    // Only a server that says it saved nothing is safe to ask again.
    if (attempt === 1 || res?.status !== 503) throw new Error(said.error ?? "didn't upload")
  }
}

/** Send a file to storage in parts, exactly as it is. */
async function sendParts(blob: Blob): Promise<{ upload: string; parts: number }> {
  const upload = crypto.randomUUID()
  const parts = Math.ceil(blob.size / SCREEN_PART_BYTES)
  const put = async (i: number) => {
    const body = blob.slice(i * SCREEN_PART_BYTES, (i + 1) * SCREEN_PART_BYTES)
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`/api/screens/media/part?upload=${upload}&part=${i}`, { method: "PUT", body }).catch(() => null)
      if (res?.ok) return
      if (attempt === 2 || (res && res.status < 500)) {
        const said = (await res?.json().catch(() => null)) as { error?: string } | null
        throw new Error(said?.error ?? "didn't upload")
      }
    }
  }
  await Promise.all(Array.from({ length: parts }, (_, i) => put(i)))
  return { upload, parts }
}
