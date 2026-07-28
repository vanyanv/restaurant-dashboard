import Link from "next/link"

export type MastheadCell = {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  /** Optional navigation target — when set, the whole cell renders as a
   *  link (e.g. a home-page glance figure drilling into its own page). */
  href?: string
}

type Props = {
  cells: MastheadCell[]
  className?: string
}

export function MastheadFigures({ cells, className = "" }: Props) {
  const layout =
    cells.length === 3 ? "m-masthead--three" : "m-masthead--two"
  return (
    <div className={`m-masthead ${layout} dock-in dock-in-2 ${className}`}>
      {cells.map((cell) => {
        const content = (
          <>
            <div className="m-masthead__label">{cell.label}</div>
            <div className="m-masthead__value">{cell.value}</div>
            {cell.sub ? <div className="m-masthead__sub">{cell.sub}</div> : null}
          </>
        )
        return cell.href ? (
          <Link
            key={cell.label}
            href={cell.href}
            prefetch={false}
            className="m-masthead__cell m-masthead__cell--link"
          >
            {content}
          </Link>
        ) : (
          <div key={cell.label} className="m-masthead__cell">
            {content}
          </div>
        )
      })}
    </div>
  )
}
