import { monoLabel, number } from "./styles"

type Redis = {
  available: { keys: boolean; memory: boolean; commands: boolean }
  keys: number
  memoryBytes: number | null
  memoryMaxBytes: number | null
  memoryPct: number | null
  commandsToday: number | null
  commandsLimit: number | null
  commandsPct: number | null
}

type Prefix = {
  keyPrefix: string
  hits: number
  misses: number
  writes: number
  busts: number
  failures: number
  hitPct: number
  sample: number
}

export function CachePanel({
  redis,
  prefixes,
}: {
  redis: Redis
  prefixes: Prefix[]
}) {
  const memColor =
    redis.memoryPct !== null && redis.memoryPct >= 80
      ? "var(--accent)"
      : "var(--ink)"
  const cmdColor =
    redis.commandsPct !== null && redis.commandsPct >= 80
      ? "var(--accent)"
      : "var(--ink)"

  return (
    <section className="inv-panel">
      <div
        className="inv-panel__head"
        style={{ display: "flex", alignItems: "baseline", gap: 12 }}
      >
        <span className="inv-panel__dept">CACHE</span>
        {!redis.available.keys ? (
          <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
            redis unavailable
          </span>
        ) : (
          <span style={{ ...monoLabel }}>
            <span style={{ color: "var(--ink-muted)" }}>
              keys {redis.keys.toLocaleString()}
            </span>
            {redis.available.memory && redis.memoryPct !== null && (
              <>
                {" · "}
                <span style={{ color: memColor }}>
                  mem {redis.memoryPct.toFixed(0)}%
                </span>
              </>
            )}
            {redis.available.commands && redis.commandsPct !== null && (
              <>
                {" · "}
                <span style={{ color: cmdColor }}>
                  cmd {redis.commandsPct.toFixed(0)}%
                </span>
              </>
            )}
          </span>
        )}
      </div>

      {prefixes.length === 0 ? (
        <p style={{ ...monoLabel, color: "var(--ink-faint)", marginTop: 12 }}>
          no cache activity yet
        </p>
      ) : (
        <div>
          {prefixes.map((p) => {
            const lowHit = p.hitPct < 30 && p.sample > 100
            return (
              <div
                key={p.keyPrefix}
                className="inv-row"
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "120px 70px 80px 80px 80px 80px 80px",
                  gap: 16,
                  alignItems: "baseline",
                }}
              >
                <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>
                  {p.keyPrefix}
                </span>
                <span
                  style={{
                    ...number,
                    color: lowHit ? "var(--accent)" : "var(--ink)",
                  }}
                >
                  {p.hitPct.toFixed(0)}%
                </span>
                <span style={{ ...number }}>{p.hits}</span>
                <span style={{ ...number }}>{p.misses}</span>
                <span style={{ ...number, color: "var(--ink-muted)" }}>
                  {p.writes}
                </span>
                <span style={{ ...number, color: "var(--ink-muted)" }}>
                  {p.busts}
                </span>
                <span
                  style={{
                    ...number,
                    color:
                      p.failures > 0 ? "var(--accent)" : "var(--ink-muted)",
                  }}
                >
                  {p.failures}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
