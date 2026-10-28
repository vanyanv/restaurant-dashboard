import type { PhotoFrame } from "@/lib/counter/menu-photos"

/**
 * One plate from the site's photography, in a 3:2 frame (every shot is
 * 720x480, so the frame never letterboxes). The shot is a CSS background so
 * the site's measured framing — zoom and vertical focus — applies exactly as
 * it does on chrisneddys.com. `size="thumb"` loads the 200px file and is what
 * a list row uses; `"full"` loads the 720px one.
 *
 * A recipe with no shot gets a dashed "No photo" frame of the same size, so a
 * row without a picture lines up with the rows that have one.
 */
export function MenuPhoto({
  frame,
  alt,
  size = "thumb",
  className,
}: {
  frame: PhotoFrame | null
  alt: string
  size?: "thumb" | "full"
  className?: string
}) {
  const cls = `mi-photo mi-photo--${size}${className ? ` ${className}` : ""}`
  if (!frame) {
    return (
      <span className={`${cls} mi-photo--none`} role="img" aria-label={`${alt}: no photo on the website`}>
        No photo
      </span>
    )
  }
  return (
    <span
      className={cls}
      role="img"
      aria-label={alt}
      style={{
        backgroundImage: `url(${size === "thumb" ? frame.thumb : frame.full})`,
        backgroundSize: `${frame.zoom}%`,
        backgroundPosition: `50% ${frame.focus}%`,
      }}
    />
  )
}
