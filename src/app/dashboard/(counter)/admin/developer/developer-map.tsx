"use client"

import { CloudDownload, Database, Inbox, Server, SlidersHorizontal, Sparkles, Store, Wrench, type LucideIcon } from "lucide-react"
import { ServiceMark } from "@/components/counter/ui"
import type { ConnectionGroupId } from "@/lib/counter/connections"
import type { ConnectionStatus, DeveloperMap, DeveloperMapConnection } from "@/lib/counter/adapters/developer"
import { HUB, layoutMap, type PlacedGroup } from "./map-layout"

/** What a status dot means, in words. Shown in the key under the map and on every card. */
export const STATUS_WORDS: Record<ConnectionStatus, string> = {
  ready: "Key set on this server",
  missing: "No key on this server",
  elsewhere: "Kept elsewhere",
}

const GROUP_ICONS: Record<ConnectionGroupId, LucideIcon> = {
  data: Database,
  outside: CloudDownload,
  mail: Inbox,
  ai: Sparkles,
  hosting: Server,
  apps: Store,
  settings: SlidersHorizontal,
  tools: Wrench,
}

/** One dot per direction data runs: toward the app, away from it, or one each way. */
function Travel({ g, index }: { g: PlacedGroup; index: number }) {
  // The wire is drawn from the app outward, so "out" follows it and "in" runs it backwards.
  const ways = g.flow === "both" ? (["out", "in"] as const) : ([g.flow] as const)
  return (
    <>
      {ways.map((way, n) => (
        <path
          key={way}
          className="dv-travel"
          data-way={way}
          pathLength={1}
          d={g.wire}
          style={{ ["--i" as string]: index + n * 3 }}
        />
      ))}
    </>
  )
}

function MapRow({ c, x, y, w, moving }: { c: DeveloperMapConnection; x: number; y: number; w: number; moving: boolean }) {
  const dx = x + w - 16
  return (
    <>
      <line className="dv-sep" x1={x} x2={x + w} y1={y - 2} y2={y - 2} />
      <ServiceMark icon={c.icon} x={x + 12} y={y + 3} size={16} />
      <text className="dv-st" x={x + 36} y={y + 15.5}>
        {c.name}
      </text>
      <text className="dv-sn" x={dx - 12} y={y + 15} textAnchor="end">
        {c.does}
      </text>
      {/* A missing key calls for attention: a slow ring, only while motion is on. */}
      {moving && c.missingKeys.length > 0 ? <circle className="dv-ring" cx={dx} cy={y + 11} r={4} /> : null}
      <circle className="dv-d" data-status={c.status} cx={dx} cy={y + 11} r={4} />
    </>
  )
}

/**
 * The connections map: the app in the middle, wired to each group of outside
 * services.
 *
 * Two forms of the same list, switched by the page's own width (a container
 * query in `counter-developer.css`): the drawing on a wide page, stacked
 * cards on a phone. The cards are also the drawing's text: on a wide page
 * they stay in the page for a screen reader, hidden from sight, so the
 * picture is never the only place a fact lives.
 *
 * `moving` is the one switch for everything that loops (the dots on the
 * wires, the ring on a missing key). The page turns it off under reduced
 * motion and when "Pause motion" is pressed, and then none of it is drawn.
 */
export function DeveloperMapView({ map, moving }: { map: DeveloperMap; moving: boolean }) {
  const layout = layoutMap(map.groups)
  const total = map.groups.reduce((n, g) => n + g.connections.length, 0)
  return (
    <div className="dv-map">
      <svg
        className="dv-map__svg"
        viewBox={`0 0 ${layout.w} ${layout.h}`}
        role="img"
        aria-label={`Map of the dashboard and the ${total} outside services it connects to. The same list follows as text.`}
      >
        {layout.groups.map((g, i) => {
          const GroupIcon = GROUP_ICONS[g.group.id]
          return (
            <g key={g.group.id} className="dv-grp">
              <path className="dv-wire" pathLength={1} d={g.wire} />
              {moving ? <Travel g={g} index={i} /> : null}
              <g className="dv-grp__box" style={{ ["--i" as string]: i }}>
                <rect className="dv-box" x={g.x} y={g.y} width={g.w} height={g.h} rx={8} />
                <GroupIcon className="dv-gi" x={g.x + 12} y={g.y + 10} width={14} height={14} aria-hidden="true" />
                <text className="dv-gt" x={g.x + 33} y={g.y + 21}>
                  {g.group.label}
                </text>
                {g.group.connections.map((c, r) => (
                  <MapRow key={c.id} c={c} x={g.x} y={g.rows[r].y} w={g.w} moving={moving} />
                ))}
              </g>
            </g>
          )
        })}
        <rect className="dv-hub" x={HUB.x} y={layout.cy - HUB.h / 2} width={HUB.w} height={HUB.h} rx={8} />
        <text className="dv-hub__t" x={HUB.x + HUB.w / 2} y={layout.cy - 4} textAnchor="middle">
          The dashboard
        </text>
        <text className="dv-hub__s" x={HUB.x + HUB.w / 2} y={layout.cy + 16} textAnchor="middle">
          desk · phone · TV feed
        </text>
      </svg>

      <div className="dv-groups">
        {map.groups.map((g) => {
          const GroupIcon = GROUP_ICONS[g.id]
          return (
            <section key={g.id} className="dv-block" aria-label={g.label}>
              <header className="dv-block__h">
                <strong className="dv-withico">
                  <GroupIcon width={14} height={14} aria-hidden="true" />
                  {g.label}
                </strong>
                <span className="dv-mono">{g.connections.length}</span>
              </header>
              <ul className="dv-list">
                {g.connections.map((c) => (
                  <li key={c.id} className="dv-row">
                    <span className="dv-tile">
                      <ServiceMark icon={c.icon} />
                    </span>
                    <div className="dv-grow">
                      <div className="dv-name">{c.name}</div>
                      <div className="dv-sub">
                        {c.does} · {STATUS_WORDS[c.status]}
                      </div>
                      {c.missingKeys.length > 0 ? (
                        <div className="dv-sub dv-sub--bad">
                          Missing: <span className="dv-kname">{c.missingKeys.join(", ")}</span>
                        </div>
                      ) : null}
                    </div>
                    <span className="dv-dot" data-status={c.status} aria-hidden="true">
                      {moving && c.missingKeys.length > 0 ? <i className="dv-dot__ring" /> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** The key under the map: what each dot colour means, in words. */
export function MapKey() {
  return (
    <ul className="dv-legend" aria-label="What the dots mean">
      {(["ready", "missing", "elsewhere"] as const).map((s) => (
        <li key={s}>
          <span className="dv-dot" data-status={s} aria-hidden="true" />
          {s === "elsewhere" ? "Kept elsewhere (on GitHub, or no key needed)" : STATUS_WORDS[s]}
        </li>
      ))}
    </ul>
  )
}
