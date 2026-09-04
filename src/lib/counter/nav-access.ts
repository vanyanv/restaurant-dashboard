import { NAV_GROUPS, type NavGroup } from "./nav"

/**
 * Which rail destinations the signed-in account may actually reach.
 *
 * ## Why this exists
 *
 * `src/app/dashboard/(counter)/admin/layout.tsx` redirects anyone who is not a
 * DEVELOPER out of `/dashboard/admin/**` to `/dashboard/forbidden`, and its
 * docblock quotes the design's own sub for the page it guards: "Developer only
 * · NOT VISIBLE TO THE OWNER". Only the first half of that shipped. The gate
 * was real; every navigation surface went on drawing "Monitoring" under Admin
 * for every account, so the owner of this product had a permanent item in
 * their sidebar and in their ⌘K palette whose only destination was a wall.
 *
 * A link that always refuses is worse than an absent one twice over: it costs
 * a page load to learn nothing, and it teaches a reader that this product's
 * navigation is not to be trusted.
 *
 * ## Why it is a module and not a line in each surface
 *
 * The palette's own docblock states the invariant it has to keep: "A palette
 * that lists a page the rail does not is worse than one that lists nothing."
 * Two copies of this test is exactly how that sentence stops being true. Both
 * `Rail` and `AskSurface` call this, so they cannot drift.
 *
 * ## Why a segment and not a list of item ids
 *
 * The rule is the same one the gate enforces, expressed against the same
 * route segment, so an admin page added later is hidden by the rule that gates
 * it with nothing to remember.
 */
export const DEVELOPER_ONLY_SEGMENT = "/dashboard/admin"

/**
 * `NAV_GROUPS`, with anything this reader cannot open removed — and with any
 * group left empty removed too, because a caption with nothing under it is a
 * section that exists only to announce a section is missing.
 *
 * `isDeveloper` is optional and absent means NO. A surface that does not know
 * who is reading cannot know whether to offer a restricted door, and the safe
 * answer when you do not know is not to.
 */
export function visibleNavGroups(isDeveloper?: boolean): NavGroup[] {
  if (isDeveloper) return [...NAV_GROUPS]
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.href.startsWith(DEVELOPER_ONLY_SEGMENT)),
  })).filter((group) => group.items.length > 0)
}
