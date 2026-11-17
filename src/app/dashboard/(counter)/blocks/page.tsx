import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { PageHead } from "@/components/counter"
import { BlocksCatalogue } from "./blocks-catalogue"

export const dynamic = "force-dynamic"

/**
 * /dashboard/blocks: every shared block (`@/components/counter/ui`) shown
 * twice, in a desk-width frame and a 390 px phone frame, from the same
 * markup. Not in the nav; it is the catalogue in place of Storybook (owner
 * chose no Storybook, 2026-11-17) and the page the fidelity check shoots.
 * The figures are fixed examples, labelled as such on the page.
 */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  return (
    <>
      <PageHead title="Shared blocks" sub="Every shared block at desk and phone width" />
      <BlocksCatalogue />
      <span hidden data-perf-ready="/dashboard/blocks" />
    </>
  )
}
