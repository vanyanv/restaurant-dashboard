import { Panel } from "@/components/mobile/panel"

type MobileLoadingProps = {
  route: string
  dept: string
  title: string
  toolbar?: "home" | "pnl" | "none"
  cells?: 2 | 3
  panelTitle?: string
  rows?: number
  chart?: boolean
  chat?: boolean
}

export function MobileRouteLoading({
  route,
  dept,
  title,
  toolbar = "none",
  cells = 2,
  panelTitle = "Loading",
  rows = 5,
  chart = false,
  chat = false,
}: MobileLoadingProps) {
  if (chat) {
    return (
      <div className="m-chat-shell" data-perf-shell={route}>
        <div className="m-chat-toolbar">
          <div className="m-skel-line m-skel-line--select" />
          <div className="m-skel-button" />
        </div>
        <div className="m-chat-body">
          <div className="chat-thread">
            <div className="chat-empty">
              <div className="chat-empty__intro">
                <div className="m-skel-line m-skel-line--cap" />
                <div className="m-skel-line m-skel-line--title" />
                <div className="m-skel-line m-skel-line--body" />
              </div>
              <div className="chat-empty__suggestions">
                <div className="m-skel-pill" />
                <div className="m-skel-pill" />
                <div className="m-skel-pill" />
              </div>
            </div>
          </div>
          <div className="chat-input-shell">
            <div className="chat-input-row">
              <div className="m-skel-line m-skel-line--input" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-perf-shell={route}>
      {toolbar !== "none" ? (
        <div className="m-toolbar">
          {toolbar === "home" ? (
            <div className="m-loading-store">
              <div className="m-skel-line m-skel-line--cap" />
              <div className="m-skel-line m-skel-line--select" />
            </div>
          ) : null}
          <div className="m-segmented">
            {Array.from({ length: toolbar === "pnl" ? 6 : 5 }).map((_, i) => (
              <div key={i} className="m-segmented__item">
                <span className="m-skel-line m-skel-line--segment" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <header className="m-page-head">
        <div className="m-page-head__dept">{dept}</div>
        <h1 className="m-page-head__title">{title}</h1>
        <div className="m-skel-line m-skel-line--sub" />
        <div className="m-page-head__rule" />
      </header>

      <div className={`m-masthead ${cells === 3 ? "m-masthead--three" : "m-masthead--two"}`}>
        {Array.from({ length: cells }).map((_, i) => (
          <div key={i} className="m-masthead__cell">
            <div className="m-skel-line m-skel-line--cap" />
            <div className="m-skel-line m-skel-line--value" />
            <div className="m-skel-line m-skel-line--meta" />
          </div>
        ))}
      </div>

      {chart ? (
        <div className="m-chart-frame m-loading-chart">
          <div className="m-skel-line m-skel-line--cap" />
          <div className="m-loading-chart__plot" />
        </div>
      ) : null}

      {rows > 0 ? (
        <div style={{ marginTop: 14 }}>
          <Panel dept={`${rows} ROWS`} title={panelTitle} flush>
            {Array.from({ length: rows }).map((_, i) => (
              <div
                key={i}
                className="inv-line"
                style={{ gridTemplateColumns: "1fr auto" }}
              >
                <span className="inv-line__name">
                  <span className="m-skel-line m-skel-line--row-title" />
                  <span className="m-skel-line m-skel-line--meta" />
                </span>
                <span className="m-skel-line m-skel-line--amount" />
              </div>
            ))}
          </Panel>
        </div>
      ) : null}
    </div>
  )
}
