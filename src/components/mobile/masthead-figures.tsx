export type MastheadCell = {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
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
      {cells.map((cell) => (
        <div key={cell.label} className="m-masthead__cell">
          <div className="m-masthead__label">{cell.label}</div>
          <div className="m-masthead__value">{cell.value}</div>
          {cell.sub ? <div className="m-masthead__sub">{cell.sub}</div> : null}
        </div>
      ))}
    </div>
  )
}
