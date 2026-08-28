/**
 * Short, DISTINCT labels for a chart's category axis.
 *
 * The prototype cuts each name to its first word — `m[0].split(' ')[0].slice(0, 6)`
 * in `P.menu.phone()`. On this account that collides immediately: the two
 * biggest sellers are "Signature Double Patty & Cheese Slider (Chris' or
 * Eddy's Way)" and "Signature Slider Fries & Drink Combo", and both become
 * "Signat".
 *
 * ## Two obvious fixes that are both wrong
 *
 * **Growing the label a word at a time until it is unique** makes uniqueness a
 * property of the FULL label while the reader only ever sees the truncated
 * one — "Signature" and "Signature Slider" both cut back to "Signature…".
 * And where the first word does differ it stops there, so "2 Slider Combo" and
 * "1 Slider Combo" become "2" and "1": unique, and meaningless.
 *
 * **Repairing only exact collisions** leaves "Signature D…" beside "Signature
 * S…", which are technically distinct and unreadable in practice. Two labels
 * that agree for all but one character are a collision as far as a reader is
 * concerned.
 *
 * ## What this does
 *
 * Cut every name to the budget FIRST, then group the results by a PREFIX two
 * characters shorter than the budget — so near-collisions group together, not
 * just identical ones — and repair each group by dropping the words its names
 * share at the front. Two names beginning "Signature" lose it and become
 * "Double Pat…" and "Slider Fri…", which is both distinct and readable. The
 * shared prefix is, by definition, the part carrying no information within
 * that group.
 *
 * Lived in `adapters/menu-profit.ts` until Product mix needed the identical
 * thing; moved here rather than copied, because a second copy is a second set
 * of rules for what a chart label is.
 */
export function shortLabels(names: string[], budget: number): string[] {
  const cut = (text: string) =>
    text.length > budget ? `${text.slice(0, budget - 1)}…` : text

  const out = names.map(cut)

  // Group on a prefix SHORTER than the budget: "Signature D" and "Signature S"
  // differ in their last character and would otherwise never be repaired.
  const groupKey = (label: string) => label.slice(0, Math.max(1, budget - 2))
  const groups = new Map<string, number[]>()
  out.forEach((label, i) => {
    const key = groupKey(label)
    groups.set(key, [...(groups.get(key) ?? []), i])
  })

  for (const members of groups.values()) {
    if (members.length < 2) continue
    const words = members.map((i) => names[i].split(/\s+/))
    let shared = 0
    while (
      // Never strip a name down to nothing: stop while every member still has
      // at least one word left after the shared prefix.
      words.every((w) => w.length > shared + 1) &&
      words.every((w) => w[shared] === words[0][shared])
    ) {
      shared += 1
    }
    if (shared === 0) continue
    members.forEach((i, n) => {
      out[i] = cut(words[n].slice(shared).join(" "))
    })
  }

  // Anything still identical after that — the same name twice, under two
  // categories — takes a prime rather than printing two bars a reader cannot
  // tell apart.
  const seen = new Set<string>()
  return out.map((label) => {
    let unique = label
    while (seen.has(unique)) unique += "′"
    seen.add(unique)
    return unique
  })
}
