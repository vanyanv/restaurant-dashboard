/**
 * Shrinks a photo in the browser to at most `edge` px on its long side, as
 * JPEG, before it goes up. Falls back to the file as it is when the browser
 * can't decode it, and the server decides.
 */
export async function shrinkPhoto(file: File, edge = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.78))
    if (blob) return blob
  } catch {}
  return file
}
