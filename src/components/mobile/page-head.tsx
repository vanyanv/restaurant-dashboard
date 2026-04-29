type PageHeadProps = {
  dept: string
  title: string
  sub?: React.ReactNode
  rule?: boolean
}

export function PageHead({ dept, title, sub, rule = true }: PageHeadProps) {
  return (
    <header className="m-page-head dock-in dock-in-1">
      <div className="m-page-head__dept">{dept}</div>
      <h1 className="m-page-head__title">{title}</h1>
      {sub ? <div className="m-page-head__sub">{sub}</div> : null}
      {rule ? <div className="m-page-head__rule" /> : null}
    </header>
  )
}
