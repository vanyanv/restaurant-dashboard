"use client"

import { useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Database, FlaskConical, Layers, LayoutGrid, Lock, Sparkles, type LucideIcon } from "lucide-react"
import { Section } from "@/components/counter"
import { useCountUp } from "@/components/counter/motion/use-count-up"
import { useReducedMotion } from "@/components/counter/motion/use-reduced-motion"
import {
  Answer,
  Button,
  ButtonLink,
  Freshness,
  PageTabs,
  ServiceMark,
  Status,
  Statuses,
  openTab,
  useAct,
  type ActResult,
} from "@/components/counter/ui"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  DeveloperMap,
  DeveloperSections,
  DeveloperSetup,
  DeveloperStack,
  DeveloperSummary,
} from "@/lib/counter/adapters/developer"
import type { StackGroupId } from "@/lib/counter/stack"
import { copyText, selectText } from "./developer-copy"
import { KeysPanel } from "./developer-keys"
import { DeveloperMapView, MapKey } from "./developer-map"

/**
 * The developer portal's four tabs, the same on the desk and the phone:
 * Map, Stack, Keys, New computer.
 *
 * Question: what is this app connected to, and where are its keys?
 *
 * The two route clients (desk and phone) draw their own page title and hand
 * the sections here. The layout answers to this block's own width, so the
 * phone gets cards where the desk gets the drawing with no second markup.
 */

const TAB_PARAM = "tab"

const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/* ── Map ──────────────────────────────────────────────────────────────── */

function MapHead({
  summary,
  paused,
  onPause,
}: {
  summary: DeveloperSummary
  paused: boolean
  onPause: () => void
}) {
  const reduced = useReducedMotion()
  // Counts up to what it already says; the first render is the exact figure.
  const shown = Math.round(useCountUp(summary.onMap))
  const missing = summary.missing.length
  return (
    <div className="dv-head">
      <Answer>
        The app talks to{" "}
        <b>
          {shown} outside {plural(summary.onMap, "service", "services")}
        </b>
        . {summary.ready} {plural(summary.ready, "has its key", "have their keys")} on this server.{" "}
        {missing > 0 ? (
          <b>
            {list(summary.missing)} {plural(missing, "doesn't", "don't")}.
          </b>
        ) : null}
        {summary.elsewhere > 0 ? (
          <>
            {" "}
            {summary.elsewhere} {plural(summary.elsewhere, "keeps its key", "keep theirs")} elsewhere.
          </>
        ) : null}
      </Answer>
      <div className="dv-fresh">
        <Statuses>
          {missing > 0 ? (
            <Status tone="bad">
              {missing} {plural(missing, "needs", "need")} a key
            </Status>
          ) : (
            <Status tone="good">Every key is in place</Status>
          )}
        </Statuses>
        <Freshness />
        {/* Anything that loops has a way to stop it. Left out when the device
            already asked for less motion: there is nothing to pause. */}
        {reduced ? null : (
          <button type="button" className="dv-link" onClick={onPause}>
            {paused ? "Play motion" : "Pause motion"}
          </button>
        )}
      </div>
    </div>
  )
}

function MapBody({ map, paused, monitoringHref }: { map: DeveloperMap; paused: boolean; monitoringHref: string }) {
  const reduced = useReducedMotion()
  const missing = map.groups.flatMap((g) => g.connections).filter((c) => c.missingKeys.length > 0)
  return (
    <div className="dv-panel cu-stack">
      <DeveloperMapView map={map} moving={!reduced && !paused} />
      <MapKey />
      {missing.length > 0 ? (
        <section className="dv-block dv-missing" aria-label="Missing keys">
          <header className="dv-block__h">
            <strong>Missing on this server</strong>
            <button type="button" className="dv-link" onClick={() => openTab("keys", TAB_PARAM)}>
              Open Keys
            </button>
          </header>
          <ul className="dv-list">
            {missing.map((c) => (
              <li key={c.id} className="dv-row">
                <span className="dv-tile">
                  <ServiceMark icon={c.icon} />
                </span>
                <div className="dv-grow">
                  <div className="dv-name">{c.name}</div>
                  <div className="dv-sub">
                    <span className="dv-kname">{c.missingKeys.join(", ")}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="dv-block">
        <div className="dv-row">
          <div className="dv-grow">
            <div className="dv-name">Are the timed jobs running?</div>
            <div className="dv-sub">That has its own page, under Monitoring.</div>
          </div>
          <ButtonLink href={monitoringHref}>Open Monitoring</ButtonLink>
        </div>
      </div>
    </div>
  )
}

/* ── Stack ────────────────────────────────────────────────────────────── */

const STACK_ICONS: Record<StackGroupId, LucideIcon> = {
  framework: Layers,
  data: Database,
  interface: LayoutGrid,
  signin: Lock,
  ai: Sparkles,
  testing: FlaskConical,
}

function StackBody({ stack }: { stack: DeveloperStack }) {
  const lead = (stack.groups[0]?.rows ?? []).slice(0, 2).map((r) => (r.version ? `${r.name} ${r.version}` : r.name))
  return (
    <div className="dv-panel cu-stack">
      <Answer>
        {lead.length > 0 ? (
          <>
            Built on <b>{list(lead)}</b>.{" "}
          </>
        ) : null}
        Versions are read from the project's package list each time the app is built.
      </Answer>
      <div className="dv-stack">
        {stack.groups.map((g) => {
          const GroupIcon = STACK_ICONS[g.id]
          return (
            <section key={g.id} className="dv-block" aria-label={g.label}>
              <header className="dv-block__h">
                <strong className="dv-withico">
                  <GroupIcon width={14} height={14} aria-hidden="true" />
                  {g.label}
                </strong>
              </header>
              <ul className="dv-list">
                {g.rows.map((r) => (
                  <li key={r.name} className="dv-row">
                    <span className="dv-tile">
                      <ServiceMark icon={r.icon} />
                    </span>
                    <div className="dv-grow dv-name">{r.name}</div>
                    {r.version ? (
                      <span className="dv-ver">{r.version}</span>
                    ) : (
                      <span className="dv-ver dv-ver--none">no package</span>
                    )}
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

/* ── New computer ─────────────────────────────────────────────────────── */

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
const inWords = (n: number) => NUMBER_WORDS[n] ?? String(n)

/** How many by-hand key names show before "Show all". */
const BY_HAND_CAP = 8

function SetupBody({ setup }: { setup: DeveloperSetup }) {
  const { act, stateOf } = useAct()
  const [said, setSaid] = useState<string | null>(null)
  const [allByHand, setAllByHand] = useState(false)
  const steps = useRef<HTMLOListElement>(null)

  const copy = (index: number, command: string) => {
    setSaid(null)
    act(
      `step:${index}`,
      async (): Promise<ActResult> => ((await copyText(command)) ? { ok: true } : { ok: false, error: "clipboard" }),
      {
        onFailed: () => {
          selectText(steps.current?.querySelectorAll("code")[index] ?? null)
          setSaid("Couldn't copy from here. The command is selected: copy it by hand.")
        },
      },
    )
  }

  // The warning's first sentence is the rule; the rest is the reason.
  const cut = setup.warning.indexOf(". ")
  const rule = cut === -1 ? setup.warning : setup.warning.slice(0, cut + 1)
  const reason = cut === -1 ? "" : setup.warning.slice(cut + 1)
  const byHand = allByHand ? setup.byHand : setup.byHand.slice(0, BY_HAND_CAP)

  return (
    <div className="dv-panel cu-stack">
      <Answer>
        A new computer is{" "}
        <b>
          {inWords(setup.steps.length)} {plural(setup.steps.length, "command", "commands")}
        </b>
        {setup.byHand.length > 0
          ? `, then ${setup.byHand.length} ${plural(setup.byHand.length, "key", "keys")} Vercel can't hand over.`
          : "."}
      </Answer>

      <ol className="dv-steps" ref={steps}>
        {setup.steps.map((s, i) => (
          <li key={s.command}>
            <div>
              <p>{s.explain}</p>
              <div className="dv-cmd">
                <code>{s.command}</code>
                <Button state={stateOf(`step:${i}`)} doneLabel="Copied" onClick={() => copy(i, s.command)} aria-label={`Copy: ${s.command}`}>
                  Copy
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className={`dv-said${said ? " cu-notice cu-notice--bad" : ""}`} role="status">
        {said ?? "\u00a0"}
      </p>

      {setup.byHand.length > 0 ? (
        <section className="dv-block" aria-label="Then add by hand">
          <header className="dv-block__h">
            <strong>Then add by hand</strong>
            <button type="button" className="dv-link" onClick={() => openTab("keys", TAB_PARAM)}>
              Open Keys
            </button>
          </header>
          <div className="dv-row">
            <div className="dv-grow dv-sub">
              Only the timed jobs on GitHub hold these, and GitHub never shows a saved secret. Ask whoever set them, or make new ones.
            </div>
          </div>
          <ul className="dv-byhand">
            {byHand.map((name) => (
              <li key={name} className="dv-pill">
                {name}
              </li>
            ))}
          </ul>
          {setup.byHand.length > BY_HAND_CAP ? (
            <div className="dv-row">
              <Button onClick={() => setAllByHand((a) => !a)}>
                {allByHand ? "Show fewer" : `Show all ${setup.byHand.length}`}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <p className="dv-note dv-note--bad" role="note">
        <b>{rule}</b>
        {reason}
      </p>
    </div>
  )
}

/* ── The page ─────────────────────────────────────────────────────────── */

export function DeveloperView({
  sections,
  monitoringHref,
}: {
  sections: SectionSources<DeveloperSections>
  /** Where "are the timed jobs running" is answered, on this surface. */
  monitoringHref: string
}) {
  // "Pause motion" stops everything that loops on the map.
  const [paused, setPaused] = useState(false)
  // PageTabs keeps every panel in the page and hides the closed ones. The
  // Keys panel is mounted under the open tab's name, so leaving the tab
  // throws away any revealed value with the rest of its state.
  const tab = useSearchParams().get(TAB_PARAM) ?? "map"
  // A section that failed offers "Try again": every section is rebuilt on
  // each request, so asking for the page again is the retry.
  const router = useRouter()
  const retry = () => router.refresh()

  return (
    <div className="dv">
      <PageTabs
        label="Developer portal views"
        param={TAB_PARAM}
        tabs={[
          {
            key: "map",
            label: "Map",
            content: (
              <div className="dv-panel cu-stack">
                <Section bare title="Developer portal" data={sections.summary} onRetry={retry}>
                  {(s) => <MapHead summary={s} paused={paused} onPause={() => setPaused((p) => !p)} />}
                </Section>
                <Section bare title="Connections" data={sections.map} onRetry={retry}>
                  {(m) => <MapBody map={m} paused={paused} monitoringHref={monitoringHref} />}
                </Section>
              </div>
            ),
          },
          {
            key: "stack",
            label: "Stack",
            content: (
              <Section bare title="Stack" data={sections.stack} onRetry={retry}>
                {(s) => <StackBody stack={s} />}
              </Section>
            ),
          },
          {
            key: "keys",
            label: "Keys",
            content: (
              <Section bare title="Keys" data={sections.keys} onRetry={retry}>
                {(k) => <KeysPanel key={tab === "keys" ? "open" : "closed"} keys={k} />}
              </Section>
            ),
          },
          {
            key: "setup",
            label: "New computer",
            content: (
              <Section bare title="New computer" data={sections.setup} onRetry={retry}>
                {(s) => <SetupBody setup={s} />}
              </Section>
            ),
          },
        ]}
      />
    </div>
  )
}
