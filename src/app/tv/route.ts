import { playerHtml } from "@/lib/screens/player-html"

/**
 * What a browser or a Samsung display's URL Launcher opens. The Samsung app
 * (tizen-app/) carries its own copy of the same player; see player-html.ts.
 * No sign-in; see /api/tv/content.
 */
const HTML = playerHtml({ base: "", app: false })

export function GET() {
  return new Response(HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  })
}
