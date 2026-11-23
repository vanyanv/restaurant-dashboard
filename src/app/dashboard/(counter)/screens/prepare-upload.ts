/**
 * Get an image ready to send: anything bigger than a 4K screen, or heavier
 * than the upload limit, is redrawn as a 3840 px-wide JPEG in the browser.
 * Vercel refuses a request over 4.5 MB, and a TV gains nothing from more
 * pixels than it has.
 */

const MAX_W = 3840
const MAX_H = 2160
/** Keep well under Vercel's 4.5 MB body limit (the form adds a little). */
const MAX_BYTES = 3.8 * 1024 * 1024

export type Prepared = { blob: Blob; filename: string; width: number; height: number }

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
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

function sizeOf(src: ImageBitmap | HTMLImageElement) {
  return "naturalWidth" in src ? { w: src.naturalWidth, h: src.naturalHeight } : { w: src.width, h: src.height }
}

export async function prepareUpload(file: File): Promise<Prepared> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("use a JPG, PNG or WebP image")
  const src = await decode(file)
  const { w, h } = sizeOf(src)
  const scale = Math.min(1, MAX_W / w, MAX_H / h)
  if (scale === 1 && file.size <= MAX_BYTES) {
    return { blob: file, filename: file.name, width: w, height: h }
  }

  const tw = Math.round(w * scale)
  const th = Math.round(h * scale)
  const canvas = document.createElement("canvas")
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("this browser can't resize images")
  ctx.drawImage(src, 0, 0, tw, th)

  for (const quality of [0.9, 0.82, 0.72, 0.6]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality))
    if (blob && blob.size <= MAX_BYTES) {
      return { blob, filename: file.name.replace(/\.[^.]+$/, "") + ".jpg", width: tw, height: th }
    }
  }
  throw new Error("still too large after shrinking")
}
