// tests/styles/fixtures/counter-lint/comments.tsx
// Proves FIX 1: comments are stripped before matching, and the reported
// line number still points at the real violation, not the comment near it.
export const NOTE = 1 // #fbf6ee was the old paper colour
/* block comment mentioning #1a1613 opens on a code line */ export const OTHER = 2

export function C() {
  return <div className="bg-sky-500" /> // was #1a1613 before Counter
}
