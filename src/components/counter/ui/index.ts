/**
 * The shared blocks: one component per everyday block, the same on the desk
 * and the phone.
 *
 * Each block lays itself out from its OWN width (CSS container queries in
 * `src/styles/counter-ui.css`), not the screen's, so the same markup is
 * right in a desk column, a phone page or a side panel. Styling reads only
 * the Counter tokens, so a new look (Counter 2) is a token change.
 *
 * A separate entry point from `@/components/counter` because two names
 * (`StoreCard`, `Status`-like pills) already exist there with older
 * meanings; pages move to these one at a time and the old ones are deleted
 * when nothing uses them. Every block is shown at desk and phone width on
 * /dashboard/blocks.
 */
export { Answer } from "./answer"
export { BigNumber, BigNumbers, type BigNumberProps, type VsTone } from "./big-number"
export { Status, type StatusTone } from "./status"
export { Button, ButtonLink, ButtonRow, type ButtonVariant } from "./button"
export { Card } from "./card"
export { StoreCard, StoreCardGrid, type StoreCardProps } from "./store-card"
export { Rows, type RowsColumn, type RowSlot } from "./rows"
export { NeedsYou, type NeedsYouGroup } from "./needs-you"
export { Tabs, type TabItem } from "./tabs"
export { Fold } from "./fold"
