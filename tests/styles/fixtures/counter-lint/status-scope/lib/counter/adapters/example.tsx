// Fixture path deliberately contains "/lib/counter/" to prove FIX 3:
// no-status-branch does not apply here. An adapter CONSTRUCTS SectionData
// and is free to branch on an ordinary HTTP response status.
export function fetchSection(response: { status: number }) {
  if (response.status === 404) return null
  return response
}
