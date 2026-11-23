import { Skeleton } from "@/components/counter/state/skeleton"

/**
 * The section skeleton, for a block that is not a `Section`: a `next/dynamic`
 * block's `loading`, while its code downloads. It holds the same height
 * `Section` holds for a loading figure, so the page under it does not jump
 * when the block lands (`no-empty-dynamic-loading`, 2026-11-23). States stay
 * behind `surface/`; this is the one way out for the skeleton.
 */
export function LoadingBlock() {
  return <Skeleton />
}
