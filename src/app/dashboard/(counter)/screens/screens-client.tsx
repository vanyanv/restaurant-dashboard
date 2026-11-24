"use client"

import { createContext, startTransition, useContext, useEffect, useOptimistic, useRef, useState, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { PageHead, Section, usePageChrome } from "@/components/counter"
import { Answer, BigNumber, Button, ButtonRow, Status, useAct, type StatusTone } from "@/components/counter/ui"
import { useUrlParam } from "@/components/counter/keep/use-url-param"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { MediaRow, ScreenRow, ScreensData, ScreensSections, SlideRow } from "@/lib/counter/adapters/screens"
import { deleteMedia, identifyScreens, setPictures } from "@/lib/counter/actions/screens"
import { IDENTIFY_MS, SLIDE_SECONDS_DEFAULT } from "@/lib/screens/limits"
import { AddTv } from "./add-tv"
import { uploadPicture } from "./prepare-upload"
import { TvPanel } from "./tv-panel"
import { useTvDrag } from "./use-tv-drag"

/**
 * Screens: every TV as it looks now, with the pictures beside them. Put a
 * picture on a TV by dragging it there (or a file from the computer), or tap
 * the picture and then the TVs; open a TV for everything else. A picture
 * stays up until it is changed. Every change saves at once and can be undone.
 *
 * One client for the desk and the phone; it lays itself out from its own
 * width (`src/styles/counter-screens.css`).
 */
export function ScreensClient({ sections }: { sections: SectionSources<ScreensSections> }) {
  usePageChrome({ leaf: "Screens" })
  // Held above the section, so the note survives the refresh that shows the new pictures.
  const note = useState<Note | null>(null)
  return (
    <NoteContext.Provider value={note}>
      <PageHead title="Screens" sub="TV menu boards in every store" />
      {/* `keep`: saves refresh the data while a TV's panel is open. */}
      <Section bare keep title="Screens" data={sections.screens}>
        {(d) => <Body data={d} />}
      </Section>
      <NoteBar />
    </NoteContext.Provider>
  )
}

/** One list on one screen, and what it should hold. `timeId` null: the usual pictures. */
export type Change = { screenId: string; timeId: string | null; slides: SlideRow[]; was?: string[] }
type Note = { words: string; undo?: Change[]; bad?: boolean; busy?: boolean }

const NoteContext = createContext<[Note | null, (n: Note | null) => void]>([null, () => {}])

const ALL = "all"
const PICTURES_SHOWN = 8

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

const STATE: Record<ScreenRow["state"], { tone: StatusTone; words: string }> = {
  on: { tone: "good", words: "On" },
  off: { tone: "bad", words: "Off" },
  waiting: { tone: "wait", words: "Waiting" },
}

export function Face({ m }: { m: MediaRow | undefined }) {
  return (
    <span className="sc-face">
      {m ? <img src={m.url} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="sc-face__none">Nothing here yet</span>}
    </span>
  )
}

function applyChanges(data: ScreensData, changes: Change[]): ScreensData {
  return {
    ...data,
    screens: data.screens.map((s) => {
      const mine = changes.filter((c) => c.screenId === s.id)
      if (mine.length === 0) return s
      const base = mine.find((c) => c.timeId === null)
      return {
        ...s,
        slides: base ? base.slides : s.slides,
        times: s.times.map((t) => {
          const c = mine.find((x) => x.timeId === t.id)
          return c ? { ...t, slides: c.slides } : t
        }),
      }
    }),
  }
}

/** What those lists hold now, so the change can be put back. */
function before(data: ScreensData, changes: Change[]): Change[] {
  return changes.map((c) => {
    const s = data.screens.find((x) => x.id === c.screenId)
    const list = c.timeId ? s?.times.find((t) => t.id === c.timeId)?.slides : s?.slides
    return { screenId: c.screenId, timeId: c.timeId, slides: list ?? [], was: c.slides.map((x) => x.mediaId) }
  })
}

/** What a TV shows this minute, and which of its lists that is. */
export function showing(s: ScreenRow): { timeId: string | null; slides: SlideRow[]; during: string | null } {
  const t = s.times.find((x) => x.id === s.onNow)
  return t ? { timeId: t.id, slides: t.slides, during: t.name } : { timeId: null, slides: s.slides, during: null }
}

const one = (mediaId: string): SlideRow[] => [{ mediaId, seconds: SLIDE_SECONDS_DEFAULT }]

function Body({ data: saved }: { data: ScreensData }) {
  const router = useRouter()
  const [data, showNow] = useOptimistic(saved, applyChanges)
  const [storeParam, setStore] = useUrlParam("store", ALL)
  const pairCode = useSearchParams().get("pair") ?? ""
  // A scanned code opens the form once; it leaves the URL at once, so a reload or Back does not reopen it.
  const [scanned] = useState(pairCode)
  const [adding, setAdding] = useState(Boolean(pairCode))
  useEffect(() => {
    if (!pairCode) return
    const url = new URL(window.location.href)
    url.searchParams.delete("pair")
    // `null`, not history.state: with Next's own state object the router skips the change
    // and the next save would put `?pair=` back.
    window.history.replaceState(null, "", url.pathname + url.search)
  }, [pairCode])
  const [openId, setOpenId] = useState<string | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [identifying, setIdentifying] = useState(false)
  const [, setNote] = useContext(NoteContext)
  // What is on screen when an upload ends, not when it began.
  const latest = useRef(data)
  useEffect(() => {
    latest.current = data
  })

  const view = data.stores.some((s) => s.id === storeParam) ? storeParam : ALL
  const has = (id: string) => data.screens.some((s) => s.storeId === id)
  // Stores with TVs first.
  const stores = data.stores.filter((s) => view === ALL || s.id === view).sort((a, b) => Number(has(b.id)) - Number(has(a.id)))
  const media = new Map(data.media.map((m) => [m.id, m]))
  const inView = data.screens.filter((s) => view === ALL || s.storeId === view)
  const on = inView.filter((s) => s.state === "on").length
  const off = inView.filter((s) => s.state === "off")
  const fullName = (s: ScreenRow) => `${data.stores.find((x) => x.id === s.storeId)?.name ?? "Store"}, ${s.name}`
  const open = data.screens.find((s) => s.id === openId)
  const picked = pick ? media.get(pick) : undefined

  const stopPicking = () => {
    setPick(null)
    setChosen([])
  }

  /** Show it at once, save it, and offer it back. */
  const change = (wanted: Change[], words: string) => {
    if (wanted.length === 0) return
    const undo = before(latest.current, wanted)
    const changes = wanted.map((c, i) => ({ ...c, was: undo[i].slides.map((x) => x.mediaId) }))
    setNote({ words, undo })
    startTransition(async () => {
      showNow(changes)
      const r = await setPictures(changes).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Try again." }))
      if (!r.ok) setNote({ words: r.error, bad: true })
    })
  }

  const putOn = (ids: string[], slides: SlideRow[]) => {
    const targets = latest.current.screens.filter((s) => ids.includes(s.id))
    if (targets.length === 0 || slides.length === 0) return
    const what = slides.length === 1 ? (media.get(slides[0].mediaId)?.name ?? "The new picture") : plural(slides.length, "picture")
    const where = targets.length === 1 ? fullName(targets[0]) : plural(targets.length, "screen")
    // It lands on what the TV is showing now, which is what was dropped on.
    const during = [...new Set(targets.map((s) => showing(s).during).filter((x) => x !== null))]
    change(
      targets.map((s) => ({ screenId: s.id, timeId: showing(s).timeId, slides })),
      `${what} is going on ${where}${during.length ? `, for ${during.join(" and ")} only` : ""}. On the TV within 30 seconds.`,
    )
    stopPicking()
  }

  const copied = (screenId: string) => {
    const s = data.screens.find((x) => x.id === screenId)
    return s ? showing(s).slides : []
  }

  const targetsOf = (to: [string, string] | null): string[] => {
    if (to?.[0] === "tv") return [to[1]]
    if (to?.[0] === "store") return data.screens.filter((s) => s.storeId === to[1]).map((s) => s.id)
    return []
  }

  const addFiles = async (list: File[], to: [string, string] | null = null): Promise<string[]> => {
    const ids: string[] = []
    const failed: string[] = []
    for (const [i, file] of list.entries()) {
      setNote({ words: list.length > 1 ? `Sending ${i + 1} of ${list.length} at full quality…` : "Sending at full quality…", busy: true })
      try {
        ids.push(await uploadPicture(file))
      } catch (err) {
        failed.push(`${file.name}: ${err instanceof Error ? err.message : "didn't upload"}`)
      }
    }
    const targets = targetsOf(to)
    if (ids.length && targets.length) putOn(targets, ids.map((mediaId) => ({ mediaId, seconds: SLIDE_SECONDS_DEFAULT })))
    else if (ids.length) setNote({ words: `${plural(ids.length, "picture")} added.` })
    if (failed.length) setNote({ words: failed.join(". "), bad: true })
    // Uploads go through a route, not an action; this brings the new pictures in.
    if (ids.length) router.refresh()
    return ids
  }

  useTvDrag({
    enabled: !pick && !open && !adding,
    onDrop: (item, to) => {
      const ids = targetsOf(to).filter((x) => !(item.kind === "tv" && x === item.id))
      putOn(ids, item.kind === "pic" ? one(item.id) : copied(item.id))
    },
    onFiles: (list, to) => void addFiles(list, to),
  })

  useEffect(() => {
    if (!identifying) return
    const t = setTimeout(() => setIdentifying(false), IDENTIFY_MS)
    return () => clearTimeout(t)
  }, [identifying])

  const identify = () => {
    const next = !identifying
    setIdentifying(next)
    setNote(next ? { words: "Each TV will show its own name within 30 seconds." } : null)
    startTransition(async () => {
      const r = await identifyScreens(next)
      if (!r.ok) {
        setIdentifying(!next)
        setNote({ words: r.error, bad: true })
      }
    })
  }

  let sentence: string
  if (inView.length === 0) sentence = "No TVs yet. Open the app on a TV and tap Add a TV."
  else if (off.length) sentence = `${off.map(fullName).slice(0, 2).join(" and ")}${off.length > 2 ? ` and ${off.length - 2} more` : ""} ${off.length === 1 ? "is" : "are"} off. Check power, then Wi-Fi.`
  else if (on === inView.length) sentence = inView.length === 1 ? "The TV is on." : `All ${inView.length} TVs are on.`
  else sentence = `${on} of ${plural(inView.length, "TV")} ${on === 1 ? "is" : "are"} on. The rest haven't checked in yet.`

  return (
    <div className="sc">
      {data.stores.length > 1 ? (
        <div className="sc-ws" role="group" aria-label="Store">
          <button type="button" className="sc-chip" aria-pressed={view === ALL} onClick={() => setStore(ALL)}>
            All {data.stores.length} stores
          </button>
          {data.stores.map((s) => (
            <button key={s.id} type="button" className="sc-chip" aria-pressed={view === s.id} onClick={() => setStore(s.id)}>
              {s.name}
            </button>
          ))}
        </div>
      ) : null}

      <Answer>{sentence}</Answer>
      <div className="sc-head">
        {inView.length ? <BigNumber label="TVs on" value={`${on} of ${inView.length}`} /> : <span />}
        <ButtonRow>
          {inView.length > 1 ? <Button onClick={identify} aria-pressed={identifying}>{identifying ? "Stop showing names" : "Which TV is which?"}</Button> : null}
          <Button variant="primary" onClick={() => setAdding(true)}>Add a TV</Button>
        </ButtonRow>
      </div>

      <div className="sc-board">
        <div className="sc-stores">
          {picked ? (
            <PickBar
              m={picked}
              count={chosen.length}
              onShow={() => putOn(chosen, one(picked.id))}
              onCancel={stopPicking}
            />
          ) : null}
          {stores.map((st) => {
            const rows = data.screens.filter((s) => s.storeId === st.id)
            return (
              <section key={st.id} className="sc-store" aria-label={st.name}>
                <div className="sc-store__h" data-sc-drop={rows.length ? `store:${st.id}` : undefined}>
                  <b>{st.name}</b>
                  {rows.length > 1 && picked ? (
                    <Button variant="quiet" onClick={() => setChosen((c) => [...new Set([...c, ...rows.map((r) => r.id)])])}>
                      Choose all {rows.length}
                    </Button>
                  ) : (
                    <span className="sc-sub sc-store__n">{rows.length ? plural(rows.length, "TV") : "No TVs yet"}</span>
                  )}
                  {rows.length ? <span className="sc-store__drop">{rows.length === 1 ? "Drop here" : `Drop here for all ${rows.length} TVs`}</span> : null}
                </div>
                {rows.length ? (
                  <ul className="sc-tvs">
                    {rows.map((s) => (
                      <Tv
                        key={s.id}
                        s={s}
                        media={media}
                        label={fullName(s)}
                        picking={Boolean(picked)}
                        chosen={chosen.includes(s.id)}
                        onPress={() =>
                          picked
                            ? setChosen((c) => (c.includes(s.id) ? c.filter((x) => x !== s.id) : [...c, s.id]))
                            : setOpenId(s.id)
                        }
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            )
          })}
        </div>
        <Tray data={data} pick={pick} onPick={(id) => { setChosen([]); setPick(pick === id ? null : id) }} onFiles={(l) => void addFiles(l)} />
      </div>

      {open ? (
        <TvPanel
          key={open.id}
          s={open}
          name={fullName(open)}
          data={data}
          onClose={() => setOpenId(null)}
          onChange={change}
          onFiles={addFiles}
        />
      ) : null}
      {adding ? (
        <AddTv
          data={data}
          code={scanned}
          storeId={view === ALL ? null : view}
          onClose={() => setAdding(false)}
          onAdded={(id) => { setAdding(false); setOpenId(id) }}
        />
      ) : null}
    </div>
  )
}

function Tv({ s, media, label, picking, chosen, onPress }: {
  s: ScreenRow
  media: Map<string, MediaRow>
  label: string
  picking: boolean
  chosen: boolean
  onPress: () => void
}) {
  const { slides, during } = showing(s)
  const first = slides[0] ? media.get(slides[0].mediaId) : undefined
  const st = STATE[s.state]
  const others = s.times.filter((t) => t.slides.length > 0 && t.id !== s.onNow)
  const badge = during ? `${during} now` : others.length ? `+ ${others[0].name}${others.length > 1 ? ` and ${others.length - 1} more` : ""}` : null
  return (
    <li className="sc-tv" data-off={s.state === "off" ? "" : undefined} data-chosen={chosen ? "" : undefined}>
      <button
        type="button"
        className="sc-set"
        onClick={onPress}
        aria-pressed={picking ? chosen : undefined}
        aria-label={picking ? `${label}, choose` : `${label}, open`}
        data-sc-drag={slides.length ? `tv:${s.id}` : undefined}
        data-sc-drop={`tv:${s.id}`}
      >
        <Face m={first} />
        {badge ? <span className="sc-badge">{badge}</span> : null}
        {picking ? <span className="sc-tick" aria-hidden>{chosen ? "✓" : ""}</span> : null}
        <span className="sc-over" aria-hidden>{slides.length ? "Show this instead" : "Show here"}</span>
      </button>
      <span className="sc-tv__cap">
        <span className="sc-tv__name">
          <b>{s.name}</b>
          <span className="sc-sub">
            {slides.length === 0 ? "No picture yet" : slides.length === 1 ? `${first?.name ?? "Picture"}, stays up` : `${slides.length} pictures, taking turns`}
          </span>
        </span>
        <Status tone={st.tone} plain>{st.words}</Status>
      </span>
    </li>
  )
}

function PickBar({ m, count, onShow, onCancel }: { m: MediaRow; count: number; onShow: () => void; onCancel: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const { act, stateOf, error } = useAct()
  return (
    <div className="sc-pick">
      <span>
        <b>{m.name}</b>. Tap the TVs you want it on.
        {confirm && m.screens ? ` It is on ${plural(m.screens, "screen")} now, which would lose it.` : ""}
        {error ? ` ${error === "network" ? "Couldn't reach the server." : error}` : ""}
      </span>
      <ButtonRow>
        <Button variant="primary" disabled={count === 0} onClick={onShow}>{count ? `Show it on ${count}` : "Show it"}</Button>
        {confirm ? (
          <Button state={stateOf("del")} onClick={() => act("del", () => deleteMedia(m.id), { onDone: onCancel })}>Yes, delete it</Button>
        ) : (
          <Button variant="quiet" onClick={() => setConfirm(true)}>Delete picture</Button>
        )}
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
      </ButtonRow>
    </div>
  )
}

export function FilePick({ children, className, multiple, onFiles, drop }: {
  children: ReactNode
  className: string
  multiple?: boolean
  onFiles: (files: File[]) => void
  drop?: string
}) {
  return (
    <label className={className} data-sc-drop={drop}>
      {children}
      <input
        type="file"
        className="sc-file"
        accept="image/jpeg,image/png,image/webp"
        multiple={multiple}
        onChange={(e) => {
          const list = [...(e.target.files ?? [])]
          e.target.value = ""
          if (list.length) onFiles(list)
        }}
      />
    </label>
  )
}

function Tray({ data, pick, onPick, onFiles }: { data: ScreensData; pick: string | null; onPick: (id: string) => void; onFiles: (l: File[]) => void }) {
  const [all, setAll] = useState(false)
  const list = all ? data.media : data.media.slice(0, PICTURES_SHOWN)
  return (
    <aside className="sc-tray" aria-label="Pictures">
      <div className="sc-tray__h">
        <h2>Pictures</h2>
        <span className="sc-sub">{data.media.length}</span>
      </div>
      <FilePick className="sc-add" multiple onFiles={onFiles} drop="tray">
        <b>Add pictures</b>
        <span className="sc-sub sc-mouse">Drop files here, or straight on a TV</span>
      </FilePick>
      {data.media.length === 0 ? <p className="sc-sub">JPG, PNG or WebP, 3840 × 2160 looks best. Sent at full quality.</p> : null}
      <ul className="sc-pics">
        {list.map((m) => (
          <li key={m.id}>
            <button type="button" className="sc-pic" aria-pressed={pick === m.id} onClick={() => onPick(m.id)} data-sc-drag={`pic:${m.id}`}>
              <Face m={m} />
              <span className="sc-pic__n">{m.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {data.media.length > PICTURES_SHOWN ? (
        <Button variant="quiet" onClick={() => setAll((a) => !a)}>{all ? "Show fewer" : `Show all ${data.media.length}`}</Button>
      ) : null}
      {data.media.length ? (
        <>
          <p className="sc-sub sc-mouse">Drag a picture onto a TV, or click it and then click the TVs. Drag one TV onto another to copy it.</p>
          <p className="sc-sub sc-touch">Tap a picture, then tap the TVs you want it on.</p>
        </>
      ) : null}
    </aside>
  )
}

/** The line after a change, with Undo. A dialog draws its own: the page behind it can't be reached. */
export function NoteBar({ dialog }: { dialog?: boolean }) {
  const [note, setNote] = useContext(NoteContext)
  useEffect(() => {
    if (dialog || !note || note.busy) return
    const t = setTimeout(() => setNote(null), note.bad ? 12_000 : 8_000)
    return () => clearTimeout(t)
  }, [dialog, note, setNote])
  const undo = note?.undo
  return (
    <div className={dialog ? "sc-note sc-note--dlg" : "sc-note"} role="status" aria-live="polite">
      {note ? (
        <div className="sc-note__in" data-bad={note.bad ? "" : undefined}>
          <span>{note.words}</span>
          {undo ? (
            <button
              type="button"
              onClick={() => {
                setNote({ words: "Putting it back…", busy: true })
                startTransition(async () => {
                  const r = await setPictures(undo).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Try again." }))
                  setNote(r.ok ? { words: "Put back." } : { words: r.error, bad: true })
                })
              }}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
