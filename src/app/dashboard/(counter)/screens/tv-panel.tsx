"use client"

import { useEffect, useRef, useState } from "react"
import { ModalDialog } from "@/components/counter/modal-dialog"
import { Button, ButtonRow, Fold, Notice, useAct } from "@/components/counter/ui"
import type { ScreenRow, ScreensData, SlideRow, TimeRow } from "@/lib/counter/adapters/screens"
import { addTime, removeScreen, removeTime, updateScreen, updateTime } from "@/lib/counter/actions/screens"
import { EVERY_DAY, SLIDE_SECONDS_DEFAULT, SLIDE_SECONDS_MAX, SLIDE_SECONDS_MIN, windowWords } from "@/lib/screens/limits"
import { useTvDrag } from "./use-tv-drag"
import { Face, FilePick, NoteBar, plural, type Change } from "./screens-client"

const PRESETS = [
  { name: "Lunch", days: EVERY_DAY, start: 11 * 60, end: 15 * 60 },
  { name: "Late night", days: EVERY_DAY, start: 22 * 60, end: 4 * 60 },
  { name: "Weekend", days: 0b1000001, start: 0, end: 0 },
]
const PICTURES_SHOWN = 8

function words(error: string) {
  return error === "network" ? "Couldn't reach the server. Try again." : error
}

function seenWords(iso: string | null): string {
  if (!iso) return "It hasn't checked in yet."
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 60) return `Last seen ${Math.max(1, mins)} min ago.`
  if (mins < 48 * 60) return `Last seen ${Math.round(mins / 60)} h ago.`
  return `Last seen ${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`
}

/** One TV: what it shows, when, and its name. Everything saves as it changes. */
export function TvPanel({ s, name, data, onClose, onChange, onFiles }: {
  s: ScreenRow
  name: string
  data: ScreensData
  onClose: () => void
  onChange: (changes: Change[], words: string) => void
  onFiles: (files: File[]) => Promise<string[]>
}) {
  const [timeId, setTimeId] = useState<string | null>(s.onNow)
  const [turns, setTurns] = useState(false)
  const [all, setAll] = useState(false)
  const { act, error, busy } = useAct()

  const time = s.times.find((t) => t.id === timeId) ?? null
  const slides = time ? time.slides : s.slides
  const many = turns || slides.length > 1
  const media = new Map(data.media.map((m) => [m.id, m]))
  const pool = data.media.filter((m) => m.storeId === null || m.storeId === s.storeId)
  const shown = all ? pool : pool.slice(0, PICTURES_SHOWN)
  const nameOf = (id: string) => media.get(id)?.name ?? "Picture"

  const set = (next: SlideRow[], say: string) => onChange([{ screenId: s.id, timeId: time?.id ?? null, slides: next }], say)
  const dialog = useRef<HTMLDivElement>(null)
  // An upload can take a while; it is added to the list as it is when it ends.
  const now = useRef(s)
  useEffect(() => {
    now.current = s
  })
  const move = (from: number, to: number, button?: string) => {
    if (from === to || to < 0 || to >= slides.length || !slides[from]) return
    const next = [...slides]
    next.splice(to, 0, ...next.splice(from, 1))
    set(next, `${nameOf(slides[from].mediaId)} is now number ${to + 1}.`)
    // The row moved; keep the keyboard on it so the next press keeps moving it.
    const key = keys[from]
    if (button)
      setTimeout(() => {
        const row = dialog.current?.querySelector(`[data-sc-key="${key}"]`)
        const again = row?.querySelector<HTMLButtonElement>(`[data-sc-btn="${button}"]`)
        ;(again && !again.disabled ? again : row?.querySelector<HTMLButtonElement>("[data-sc-btn=pic]"))?.focus()
      }, 60)
  }
  const add = (ids: string[], to = time?.id ?? null, turnsToo = many, what = nameOf(ids[0])) => {
    const list = (to ? now.current.times.find((t) => t.id === to)?.slides : now.current.slides) ?? []
    const fresh = ids.map((mediaId) => ({ mediaId, seconds: SLIDE_SECONDS_DEFAULT }))
    onChange(
      [{ screenId: s.id, timeId: to, slides: turnsToo ? [...list, ...fresh] : fresh }],
      turnsToo ? `${what} added to ${name}. On the TV within 30 seconds.` : `${what} is going on ${name}. On the TV within 30 seconds.`,
    )
  }
  const upload = (files: File[]) => {
    const to = time?.id ?? null
    void onFiles(many ? files : files.slice(0, 1)).then((ids) => {
      if (ids.length) add(ids, to, many, ids.length === 1 ? "The new picture" : plural(ids.length, "picture"))
    })
  }
  // A name for each place in the list that stays with its picture when it moves.
  const seen = new Map<string, number>()
  const keys = slides.map((x) => {
    const n = seen.get(x.mediaId) ?? 0
    seen.set(x.mediaId, n + 1)
    return `${x.mediaId}.${n}`
  })

  useTvDrag({
    slides: true,
    enabled: true,
    onDrop: (item, [kind, to]) => {
      if (kind === "slide") move(Number(item.id), Number(to))
    },
  })

  return (
    <ModalDialog
      className="sc-dlg"
      aria-labelledby="sc-dlg-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sc-dlg__in" ref={dialog}>
        <div className="sc-dlg__h">
          <h1 id="sc-dlg-title">{name}</h1>
          <button type="button" className="sc-icon" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {s.state === "off" ? <Notice tone="bad">{`This TV is off. ${seenWords(s.lastSeenAt)} Check it has power, then its Wi-Fi. It starts playing again by itself.`}</Notice> : null}

        <div className="sc-when" role="group" aria-label="When">
          <button type="button" className="sc-chip" aria-pressed={time === null} onClick={() => { setTimeId(null); setTurns(false) }}>
            Usual pictures
          </button>
          {s.times.map((t) => (
            <button key={t.id} type="button" className="sc-chip" aria-pressed={t.id === timeId} onClick={() => { setTimeId(t.id); setTurns(false) }}>
              {t.name}
            </button>
          ))}
          {PRESETS.filter((p) => !s.times.some((t) => t.name === p.name)).map((p) => (
            <button
              key={p.name}
              type="button"
              className="sc-chip sc-chip--add"
              disabled={busy}
              onClick={() =>
                act("time", async () => {
                  const r = await addTime({ screenId: s.id, ...p })
                  if (r.ok && r.id) setTimeId(r.id)
                  return r
                })
              }
            >
              + {p.name}
            </button>
          ))}
        </div>
        {time ? <TimeEdit key={time.id} t={time} onRemoved={() => setTimeId(null)} /> : null}
        {time && time.slides.length === 0 ? <p className="sc-sub">Until you add a picture here, the usual ones keep showing.</p> : null}
        {error ? <p className="sc-err" role="alert">{words(error)}</p> : null}

        {slides.length ? (
          <ol className="sc-slides">
            {slides.map((x, i) => (
              <li key={keys[i]} data-sc-key={keys[i]} className="sc-slide" data-sc-drop={`slide:${i}`}>
                <button
                  type="button"
                  className="sc-slide__pic"
                  data-sc-btn="pic"
                  aria-label={`${nameOf(x.mediaId)}, picture ${i + 1} of ${slides.length}${slides.length > 1 ? ". Drag to move, or press the left and right arrow keys" : ""}`}
                  data-sc-drag={slides.length > 1 ? `slide:${i}` : undefined}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft") move(i, i - 1, "pic")
                    if (e.key === "ArrowRight") move(i, i + 1, "pic")
                  }}
                >
                  <Face m={media.get(x.mediaId)} />
                </button>
                <span className="sc-slide__n">{nameOf(x.mediaId)}</span>
                {slides.length > 1 ? (
                  <span className="sc-slide__b">
                    <button type="button" className="sc-icon" disabled={i === 0} aria-label="Move earlier" data-sc-btn="earlier" onClick={() => move(i, i - 1, "earlier")}>←</button>
                    <label className="sc-secs">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={SLIDE_SECONDS_MIN}
                        max={SLIDE_SECONDS_MAX}
                        defaultValue={x.seconds}
                        key={x.seconds}
                        aria-label={`Seconds for ${nameOf(x.mediaId)}`}
                        onBlur={(e) => {
                          const v = Number(e.target.value)
                          if (v && v !== x.seconds) set(slides.map((y, k) => (k === i ? { ...y, seconds: v } : y)), "Time changed.")
                        }}
                      />
                      <span>s</span>
                    </label>
                    <button type="button" className="sc-icon" disabled={i === slides.length - 1} aria-label="Move later" data-sc-btn="later" onClick={() => move(i, i + 1, "later")}>→</button>
                  </span>
                ) : (
                  <span className="sc-sub">Stays up</span>
                )}
                <Button variant="quiet" onClick={() => set(slides.filter((_, k) => k !== i), `${nameOf(x.mediaId)} taken off.`)}>Take off</Button>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="sc-dlg__row">
          <span className="sc-sub">
            {many ? "Tap pictures to add them. They take turns." : "Tap a picture to show it. It stays up until you change it."}
          </span>
          <Button
            variant="quiet"
            onClick={() => {
              if (slides.length > 1) set(slides.slice(0, 1), `${name} shows one picture now.`)
              setTurns(!many)
            }}
          >
            {many ? "Show just one" : "Take turns with more"}
          </Button>
        </div>
        <FilePick className="sc-add" multiple={many} onFiles={upload}>
          <b>Take or choose a photo</b>
        </FilePick>
        <ul className="sc-pics sc-pics--dlg">
          {shown.map((m) => (
            <li key={m.id}>
              <button type="button" className="sc-pic" onClick={() => add([m.id])}>
                <Face m={m} />
                <span className="sc-pic__n">{m.name}</span>
              </button>
            </li>
          ))}
        </ul>
        {pool.length > PICTURES_SHOWN ? (
          <Button variant="quiet" onClick={() => setAll((a) => !a)}>{all ? "Show fewer" : `Show all ${pool.length}`}</Button>
        ) : null}

        <Fold summary="Name, store and unpair">
          <Settings s={s} data={data} onGone={onClose} />
        </Fold>
        <div className="sc-dlg__row">
          <span className="sc-sub">Saves as you go.</span>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
        <NoteBar dialog />
      </div>
    </ModalDialog>
  )
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const toClock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
const toMinute = (v: string) => {
  const [h, m] = v.split(":").map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

function TimeEdit({ t, onRemoved }: { t: TimeRow; onRemoved: () => void }) {
  const [w, setW] = useState({ days: t.days, start: t.start, end: t.end })
  const { act, stateOf, error } = useAct()
  const save = (next: typeof w) => {
    setW(next)
    if (next.days === 0) return
    act("save", () => updateTime({ timeId: t.id, name: t.name, ...next }))
  }
  return (
    <div className="sc-time">
      <div className="sc-days" role="group" aria-label="Days">
        {DAYS.map((d, i) => (
          <button key={d} type="button" className="sc-chip" aria-pressed={Boolean(w.days & (1 << i))} onClick={() => save({ ...w, days: w.days ^ (1 << i) })}>
            {d}
          </button>
        ))}
      </div>
      <div className="sc-dlg__row">
        <span className="sc-clock">
          <input type="time" aria-label="From" value={toClock(w.start)} onChange={(e) => { const v = toMinute(e.target.value); if (v !== null) save({ ...w, start: v }) }} />
          <span>to</span>
          <input type="time" aria-label="Until" value={toClock(w.end)} onChange={(e) => { const v = toMinute(e.target.value); if (v !== null) save({ ...w, end: v }) }} />
        </span>
        <Button variant="quiet" state={stateOf("remove")} onClick={() => act("remove", () => removeTime(t.id), { onDone: onRemoved })}>
          Remove {t.name}
        </Button>
      </div>
      <span className="sc-sub">{w.days === 0 ? "Pick at least one day." : `Shows ${windowWords(w)}, then goes back by itself. If two times overlap, the newer one shows.`}</span>
      {error ? <p className="sc-err" role="alert">{words(error)}</p> : null}
    </div>
  )
}

function Settings({ s, data, onGone }: { s: ScreenRow; data: ScreensData; onGone: () => void }) {
  const [name, setName] = useState(s.name)
  const [storeId, setStoreId] = useState(s.storeId)
  const [confirm, setConfirm] = useState(false)
  const { act, stateOf, error, busy } = useAct()
  return (
    <div className="sc-fields">
      <label className="sc-field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </label>
      <label className="sc-field">
        <span>Store</span>
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          {data.stores.map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>
      </label>
      <p className="sc-sub">{s.device ? `${s.device}. ` : ""}{s.state === "on" ? "" : seenWords(s.lastSeenAt)}</p>
      {error ? <p className="sc-err" role="alert">{words(error)}</p> : null}
      {confirm ? <p className="sc-sub">The TV goes back to showing a code, and its pictures stay in Pictures.</p> : null}
      <ButtonRow>
        <Button disabled={busy} state={stateOf("save")} doneLabel="Saved" onClick={() => act("save", () => updateScreen({ screenId: s.id, name, storeId }), { done: "Saved" })}>
          Save name and store
        </Button>
        {confirm ? (
          <Button disabled={busy} state={stateOf("remove")} onClick={() => act("remove", () => removeScreen(s.id), { onDone: onGone })}>Yes, unpair it</Button>
        ) : (
          <Button variant="quiet" onClick={() => setConfirm(true)}>Unpair</Button>
        )}
      </ButtonRow>
    </div>
  )
}
