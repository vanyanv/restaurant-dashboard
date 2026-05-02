/**
 * Small filled square the size of a printer's color-register mark. Used
 * inline next to a system label to identify the subsystem by ink hue.
 * 6px on the bridge; 8px on drilldown headings.
 */
export function RegisterMark({
  color,
  size = 6,
}: {
  color: string
  size?: number
}) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        backgroundColor: color,
        verticalAlign: "middle",
      }}
    />
  )
}
