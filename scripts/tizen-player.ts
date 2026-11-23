/**
 * Writes the Samsung app's player (tizen-app/index.html) from the same source
 * as the /tv page, pointed at the live dashboard. Run after changing
 * src/lib/screens/player-html.ts: `npx tsx scripts/tizen-player.ts`.
 * tests/lib/screens/player-html.test.ts fails while the two differ.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { DASHBOARD_ORIGIN, playerHtml } from "../src/lib/screens/player-html"

const out = join(__dirname, "..", "tizen-app", "index.html")
writeFileSync(out, playerHtml({ base: DASHBOARD_ORIGIN, app: true }))
console.log(`Wrote ${out}`)
