import type { VolumeBucket } from "../lib/bucket-volume"

interface Props {
  bucket: VolumeBucket
}

const LABEL: Record<VolumeBucket, string> = {
  busy: "busy",
  normal: "normal",
  slow: "slow",
}

export function DayBadge({ bucket }: Props) {
  return (
    <span className={`decisions-day-badge is-${bucket}`}>{LABEL[bucket]}</span>
  )
}
