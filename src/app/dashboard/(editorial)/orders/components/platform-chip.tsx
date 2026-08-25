"use client"

export const PLATFORM_LABELS: Record<string, string> = {
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  uber: "Uber Eats",
  uber_eats: "Uber Eats",
  grubhub: "Grubhub",
  chownow: "ChowNow",
  "bnm-web": "Direct Web",
  bnm_web: "Direct Web",
  "css-pos": "In-Store",
  css_pos: "In-Store",
}

export function formatPlatform(slug: string): string {
  return PLATFORM_LABELS[slug] ?? slug.replace(/[-_]/g, " ")
}

export function PlatformStamp({
  platform,
  size = "sm",
}: {
  platform: string
  size?: "sm" | "md"
}) {
  return (
    <span
      className={`platform-stamp ${size === "md" ? "stamp-md" : ""}`}
      data-platform={platform.toLowerCase()}
    >
      {formatPlatform(platform)}
    </span>
  )
}
