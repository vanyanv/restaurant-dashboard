// Fixture path deliberately mimics an app route (outside lib/counter) to
// prove FIX 3 didn't widen the exemption: a page still can't branch on
// SectionData.status.
export function Example({ section }: { section: { status: string } }) {
  if (section.status === "loading") return null
  return null
}
