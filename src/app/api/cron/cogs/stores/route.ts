import { NextResponse } from "next/server"
import { withCronAuth } from "@/lib/cron-auth"
import { listCogsSweepStores } from "@/lib/cogs-sweep-job"

/**
 * The active store ids a COGS sweep would visit. The scheduled sweeps read
 * this list on the GitHub Actions runner now (`scripts/sweep-cogs.ts`); the
 * endpoint stays for a sweep triggered by hand.
 */
export const GET = withCronAuth(async (request) => {
  const url = new URL(request.url)
  const force = url.searchParams.get("force") === "true"
  return NextResponse.json(
    await listCogsSweepStores({ force, triggeredBy: "github-actions" }),
  )
})
