type PanelProps = {
  dept?: string
  title?: string
  readOnly?: boolean
  className?: string
  flush?: boolean
  children: React.ReactNode
}

export function Panel({
  dept,
  title,
  readOnly,
  className = "",
  flush = false,
  children,
}: PanelProps) {
  const head = dept || title
  return (
    <section
      className={`inv-panel${flush ? " inv-panel--flush" : ""} ${className}`}
    >
      {readOnly ? (
        <div className="m-readonly-note">Best edited on desktop</div>
      ) : null}
      {head ? (
        <div className="inv-panel__head">
          {dept ? <span className="inv-panel__dept">{dept}</span> : null}
          {title ? <span className="inv-panel__title">{title}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
