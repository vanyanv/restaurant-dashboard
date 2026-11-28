/**
 * Which outside service a host belongs to, for the `out:<service>` counts.
 *
 * `null` means "do not count as an outside call": Upstash is counted as Redis
 * commands, and the app calling itself is not an outside call. An unknown host
 * is "other", never its own name, so the set of metrics cannot grow.
 */
const SUFFIXES: [suffix: string, service: string][] = [
  ["openai.com", "openai"],
  ["googleapis.com", "gemini"],
  ["resend.com", "resend"],
  ["pusher.com", "pusher"],
  ["r2.cloudflarestorage.com", "r2"],
  ["microsoft.com", "microsoft"],
  ["microsoftonline.com", "microsoft"],
  ["tryotter.com", "otter"],
  ["harri.com", "harri"],
  ["predicthq.com", "predicthq"],
  ["open-meteo.com", "open-meteo"],
  ["github.com", "github"],
  ["vercel.com", "vercel"],
]

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

const matches = (host: string, suffix: string): boolean =>
  host === suffix || host.endsWith("." + suffix)

export function serviceOfHost(rawHost: string): string | null {
  const host = rawHost.toLowerCase()
  if (matches(host, "upstash.io")) return null
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return null
  if (host === hostOf(process.env.NEXTAUTH_URL) || host === hostOf(process.env.VERCEL_URL)) return null
  if (host === hostOf(process.env.SHOP_API_URL)) return "shop"
  for (const [suffix, service] of SUFFIXES) if (matches(host, suffix)) return service
  return "other"
}
