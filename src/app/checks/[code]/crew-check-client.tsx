"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ActiveCheck, CrewItem, CrewMarkState, CrewView } from "@/lib/checks/crew"
import { shortStoreName } from "@/lib/checks/names"

/**
 * The crew flow, one job per screen: store page -> PIN -> shared checklist ->
 * done. Built for wet or gloved hands: rows 60px tall, keys 64px, and the
 * bottom button always says what is missing.
 *
 * The checklist is one shared form per check per day. Every tap is saved on
 * the server straight away with the person's name and the time, and every
 * phone on the check refreshes every few seconds, so two people can split a
 * list without redoing each other's tasks. Crew can open the list as soon as
 * the check opens; Submit unlocks only inside its window.
 */

type Lang = "en" | "es"
type Who = { pass: string; name: string; firstName: string; startedAt: number }
type Receipt = {
  store: string
  check: { en: string; es: string }
  day: string
  at: string
  by: string
  late: number
  dueLabel: string
  flagged: number
  tasks: number
  photos: number
  people: string[]
  next: CrewView["next"]
}
type Screen = "home" | "pin" | "list" | "done"

const POLL_MS = 6_000

const T = {
  en: {
    openUntil: (from: string, to: string) => `Open · submit ${from} – ${to}`,
    submitNow: (to: string, left: string) => `Submit now · closes ${to} · ${left} left`,
    opensAt: (t: string) => `Opens at ${t}`,
    sentBy: (at: string, who: string) => `Sent ${at} by ${who}`,
    missed: "Missed",
    closedNow: "Closed",
    off: "Switched off",
    progress: (a: number, b: number) => `${a} of ${b} tasks done`,
    noneOpen: "No check is open right now",
    nextOpens: (c: string, t: string) => `${c} opens at ${t}.`,
    allDone: "Every check is done for today.",
    closedToday: "No checks today. The store is marked closed.",
    pickHelp: "Tap the check you're doing. Enter your PIN once, then every tick saves on its own.",
    enterPin: "Enter your PIN",
    pinHelp: "4 digits. Your manager sent it to you.",
    forgot: "Forgot?",
    forgotHelp: "Ask your manager. They can see your PIN in the dashboard.",
    del: "Delete",
    checking: "Checking…",
    hi: (n: string) => `Hi ${n}`,
    doneOf: (a: number, b: number) => `${a} of ${b} done`,
    alsoOn: (names: string) => `Also on it: ${names}`,
    nextUp: (s: string) => `Next up · ${s}`,
    markDone: "Mark done",
    takePhotoFinish: "Take photo to finish",
    photoRequired: "Photo required · tap to open camera",
    stamp: (at: string, by: string, photo: boolean) => `${at} · ${by}${photo ? " · photo" : ""}`,
    allTasksDone: "All tasks done.",
    comeBack: (from: string, to: string) => `Come back between ${from} and ${to} to submit.`,
    tapSubmit: "Tap Submit below.",
    undoHelp: "Tapped by mistake? Tap a done task again to undo it.",
    problem: "Problem?",
    needsAttention: "Needs attention",
    flagTitle: "What's wrong?",
    flagHelp: "It counts as done and your manager sees the note.",
    flagChips: ["Out of supplies", "Broken", "Ran out of time", "Not needed today"],
    saveFlag: "Save note",
    removeFlag: "Remove note",
    cancel: "Cancel",
    submitOpens: (t: string) => `Submit opens at ${t}`,
    left: (n: number, p: number) =>
      [n > 0 ? `${n} task${n === 1 ? "" : "s"} left` : "", p > 0 ? `${p} photo${p === 1 ? "" : "s"} left` : ""].filter(Boolean).join(" · "),
    submitCheck: (c: string) => `Submit ${c} check`,
    sending: "Sending…",
    photoTitle: "Check your photo",
    photoUse: "Looks good, mark done",
    retake: "Retake",
    uploading: "Saving photo…",
    doneTitle: (c: string) => `${c} check sent`,
    thanks: (n: string) => `Thanks, ${n}. It's saved and locked.`,
    store: "Tasks",
    submitted: "Submitted",
    doneBy: "Done by",
    tasks: (n: number, p: number) => `${n} tasks · ${p} photo${p === 1 ? "" : "s"}`,
    nextCheck: "Next check",
    backHome: "Done",
    signsOut: (s: number) => `Signs you out in ${s} s`,
    notYou: "Not you? Sign out",
    offline: "No connection. Try again.",
    closedWhile: "This check just closed or was submitted.",
  },
  es: {
    openUntil: (from: string, to: string) => `Abierta · se envía de ${from} a ${to}`,
    submitNow: (to: string, left: string) => `Envíala ya · cierra ${to} · quedan ${left}`,
    opensAt: (t: string) => `Abre a las ${t}`,
    sentBy: (at: string, who: string) => `Enviada ${at} por ${who}`,
    missed: "No se hizo",
    closedNow: "Cerrada",
    off: "Apagada",
    progress: (a: number, b: number) => `${a} de ${b} tareas hechas`,
    noneOpen: "No hay ninguna revisión abierta ahora",
    nextOpens: (c: string, t: string) => `${c} abre a las ${t}.`,
    allDone: "Todas las revisiones de hoy están hechas.",
    closedToday: "No hay revisiones hoy. La tienda está marcada como cerrada.",
    pickHelp: "Toca la revisión que vas a hacer. Escribe tu PIN una vez y cada marca se guarda sola.",
    enterPin: "Escribe tu PIN",
    pinHelp: "4 dígitos. Tu gerente te lo envió.",
    forgot: "¿Lo olvidaste?",
    forgotHelp: "Pregúntale a tu gerente. Puede ver tu PIN en el panel.",
    del: "Borrar",
    checking: "Revisando…",
    hi: (n: string) => `Hola ${n}`,
    doneOf: (a: number, b: number) => `${a} de ${b} hechas`,
    alsoOn: (names: string) => `También aquí: ${names}`,
    nextUp: (s: string) => `Sigue · ${s}`,
    markDone: "Marcar hecha",
    takePhotoFinish: "Tomar foto para terminar",
    photoRequired: "Foto obligatoria · toca para abrir la cámara",
    stamp: (at: string, by: string, photo: boolean) => `${at} · ${by}${photo ? " · foto" : ""}`,
    allTasksDone: "Todas las tareas están hechas.",
    comeBack: (from: string, to: string) => `Vuelve entre ${from} y ${to} para enviarla.`,
    tapSubmit: "Toca Enviar abajo.",
    undoHelp: "¿Te equivocaste? Toca otra vez una tarea hecha para quitarla.",
    problem: "¿Problema?",
    needsAttention: "Necesita atención",
    flagTitle: "¿Qué pasa?",
    flagHelp: "Cuenta como hecha y tu gerente ve la nota.",
    flagChips: ["Faltan productos", "Roto", "No hubo tiempo", "No hace falta hoy"],
    saveFlag: "Guardar nota",
    removeFlag: "Quitar nota",
    cancel: "Cancelar",
    submitOpens: (t: string) => `Se puede enviar desde las ${t}`,
    left: (n: number, p: number) =>
      [n > 0 ? `Falta${n === 1 ? "" : "n"} ${n} tarea${n === 1 ? "" : "s"}` : "", p > 0 ? `${p} foto${p === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "),
    submitCheck: (c: string) => `Enviar revisión de ${c.toLowerCase()}`,
    sending: "Enviando…",
    photoTitle: "Revisa tu foto",
    photoUse: "Se ve bien, marcar hecha",
    retake: "Repetir",
    uploading: "Guardando foto…",
    doneTitle: (c: string) => `Revisión de ${c.toLowerCase()} enviada`,
    thanks: (n: string) => `Gracias, ${n}. Quedó guardada y cerrada.`,
    store: "Tareas",
    submitted: "Enviada",
    doneBy: "Hecha por",
    tasks: (n: number, p: number) => `${n} tareas · ${p} foto${p === 1 ? "" : "s"}`,
    nextCheck: "Siguiente revisión",
    backHome: "Listo",
    signsOut: (s: number) => `Se cierra tu sesión en ${s} s`,
    notYou: "¿No eres tú? Salir",
    offline: "Sin conexión. Inténtalo otra vez.",
    closedWhile: "Esta revisión se acaba de cerrar o enviar.",
  },
}
type Tx = (typeof T)["en"]

function readLang(): Lang {
  try {
    const saved = localStorage.getItem("checks.lang")
    if (saved === "en" || saved === "es") return saved
  } catch {}
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("es") ? "es" : "en"
}

function durationLabel(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

function useClock(serverNow: number): number {
  const offset = useRef(serverNow - Date.now())
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const tick = () => setNow(Date.now() + offset.current)
    const id = window.setInterval(tick, 15_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/** Shrinks a camera photo to at most 1600px on its long edge, as JPEG. */
async function compress(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.72))
    if (blob) return blob
  } catch {}
  return file
}

export function CrewCheckClient({ code, initial }: { code: string; initial: CrewView }) {
  const [view, setView] = useState<CrewView>(initial)
  const [lang, setLangState] = useState<Lang>("en")
  useEffect(() => setLangState(readLang()), [])
  const setLang = (l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem("checks.lang", l)
    } catch {}
  }
  const t = T[lang]
  const now = useClock(initial.serverNow)
  const [screen, setScreen] = useState<Screen>("home")
  const [who, setWho] = useState<Who | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const active = view.active

  // Keeps every phone on the check in step: others' ticks, the window
  // opening or locking, someone else submitting.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/checks/${encodeURIComponent(code)}/state`, { cache: "no-store" })
      if (res.ok) setView(((await res.json()) as { view: CrewView }).view)
    } catch {}
  }, [code])
  useEffect(() => {
    if (screen === "done") return
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh()
    }, POLL_MS)
    const onShow = () => document.visibilityState === "visible" && void refresh()
    document.addEventListener("visibilitychange", onShow)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onShow)
    }
  }, [refresh, screen])

  const signOut = useCallback(() => {
    setWho(null)
    setReceipt(null)
    setScreen("home")
    void refresh()
  }, [refresh])

  // The check closed or was submitted under someone's feet.
  const listGone = screen === "list" && !active

  return (
    <main className="ct-root ckc ckb" lang={lang}>
      <div className="ckc__col">
        <header className="ckb__band">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src="/checks-logo.png" alt="Chris N Eddy's" />
          <span className="ckb__store">{shortStoreName(view.store.name)}</span>
          <LangToggle lang={lang} setLang={setLang} />
        </header>
        {(screen === "home" || listGone) && (
          <Home
            view={view}
            t={t}
            lang={lang}
            now={now}
            notice={listGone ? t.closedWhile : null}
            onStart={() => setScreen(who && active && who.pass ? "list" : "pin")}
          />
        )}
        {screen === "pin" && active && (
          <Pin
            code={code}
            t={t}
            checkLabel={active.label[lang]}
            onBack={() => setScreen("home")}
            onOk={(w) => {
              setWho(w)
              setScreen("list")
            }}
          />
        )}
        {screen === "list" && active && who && (
          <Checklist
            code={code}
            t={t}
            lang={lang}
            active={active}
            who={who}
            now={now}
            setView={setView}
            onDone={(r) => {
              setReceipt(r)
              setScreen("done")
            }}
            onSignedOut={signOut}
          />
        )}
        {screen === "done" && receipt && <Done t={t} lang={lang} receipt={receipt} firstName={who?.firstName ?? ""} onHome={signOut} />}
      </div>
    </main>
  )
}

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="ckc__lang" role="group" aria-label="Language / Idioma">
      <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>
        EN
      </button>
      <button type="button" aria-pressed={lang === "es"} onClick={() => setLang("es")}>
        ES
      </button>
    </div>
  )
}

function counts(a: ActiveCheck) {
  const state = new Map(a.marks.map((m) => [m.itemId, m]))
  let done = 0
  let total = 0
  let photosLeft = 0
  for (const s of a.sections) {
    for (const i of s.items) {
      total += 1
      const m = state.get(i.id)
      if (m?.done) done += 1
      else if (i.photoRequired) photosLeft += 1
    }
  }
  return { done, total, photosLeft, state }
}

function Home({
  view,
  t,
  lang,
  now,
  notice,
  onStart,
}: {
  view: CrewView
  t: Tx
  lang: Lang
  now: number
  notice: string | null
  onStart: () => void
}) {
  const a = view.active
  const day = new Date(now).toLocaleDateString(lang === "es" ? "es-US" : "en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "short",
    day: "numeric",
  })
  const clock = new Date(now)
    .toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" })
    .toLowerCase()
  return (
    <>
      <p className="ckc__dim" style={{ margin: "4px 16px 0", fontSize: 14 }}>
        {day} · {clock}
      </p>
      {notice && <div className="ckb__alldone" style={{ background: "var(--warn-wash)", color: "var(--warn)", borderColor: "var(--accent-hi)" }}>{notice}</div>}
      {view.closedToday ? (
        <div className="ckc__hero">
          <h2>{t.closedToday}</h2>
        </div>
      ) : (
        view.rows.map((r) => {
          const live = a?.kind === r.kind
          let line = t.opensAt(r.opensLabel)
          let tone = "ckb__tone-dim"
          if (live && a) {
            const canSubmit = now >= a.submitFrom && now <= a.closesAt
            line = canSubmit
              ? t.submitNow(a.dueLabel, durationLabel(a.dueAt - now))
              : t.openUntil(a.submitFromLabel, a.dueLabel)
            tone = "ckb__tone-good"
          } else if ((r.status === "on_time" || r.status === "late") && r.doneBy && r.doneAt) {
            line = t.sentBy(r.doneAt, r.doneBy)
            tone = "ckb__tone-good"
          } else if (r.status === "missed") {
            line = t.missed
            tone = "ckb__tone-bad"
          } else if (r.status === "closed") line = t.closedNow
          else if (r.status === "off") line = t.off
          const c = live && a ? counts(a) : null
          return (
            <button key={r.kind} type="button" className="ckb__card" data-live={live} disabled={!live} onClick={onStart}>
              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2>{r.label[lang]}</h2>
                {live ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <rect x="5" y="11" width="14" height="9" rx="1" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                )}
              </span>
              <span className={`ckb__line ${tone}`}>{line}</span>
              {c && <span className="ckc__dim" style={{ fontSize: 13.5 }}>{t.progress(c.done, c.total)}</span>}
            </button>
          )
        })
      )}
      {!a && !view.closedToday && (
        <p className="ckc__dim" style={{ fontSize: 14 }}>
          {view.next ? t.nextOpens(view.next.label[lang], view.next.opensLabel) : t.allDone}
        </p>
      )}
      {a && <p className="ckc__dim" style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: "auto" }}>{t.pickHelp}</p>}
    </>
  )
}

function Pin({
  code,
  t,
  checkLabel,
  onBack,
  onOk,
}: {
  code: string
  t: Tx
  checkLabel: string
  onBack: () => void
  onOk: (w: Who) => void
}) {
  const [digits, setDigits] = useState("")
  const [error, setError] = useState("")
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)
  const [help, setHelp] = useState(false)

  const submit = useCallback(
    async (pin: string) => {
      setBusy(true)
      setError("")
      try {
        const res = await fetch(`/api/checks/${encodeURIComponent(code)}/pin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(body.error ?? "That didn't work. Try again.")
          setShake(true)
          setDigits("")
          window.setTimeout(() => setShake(false), 400)
          return
        }
        onOk(body as Who)
      } catch {
        setError(t.offline)
        setDigits("")
      } finally {
        setBusy(false)
      }
    },
    [code, onOk, t.offline],
  )

  // The fourth digit sends the PIN. Sent from here, never from inside a
  // state updater: React may run an updater twice, and that was two requests.
  const press = (d: string) => {
    if (busy || digits.length >= 4) return
    setError("")
    const next = digits + d
    setDigits(next)
    if (next.length === 4) void submit(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === "Backspace") setDigits((c) => c.slice(0, -1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <>
      <button type="button" className="ckc__btn ckc__btn--ghost" style={{ width: "auto", justifySelf: "start", minHeight: 44, fontFamily: "var(--sans)", fontSize: 14, fontWeight: 600 }} onClick={onBack}>
        ‹ {checkLabel}
      </button>
      <div style={{ display: "grid", gap: 4, textAlign: "center", marginTop: 8 }}>
        <h2>{t.enterPin}</h2>
        <p className="ckc__dim" style={{ margin: 0, fontSize: 14 }}>
          {help ? t.forgotHelp : t.pinHelp}
        </p>
      </div>
      <div className={`ckc__dots${shake ? " shake" : ""}`} aria-label={`${digits.length} of 4 digits entered`} role="status">
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className={i < digits.length ? "f" : i === digits.length ? "cur" : ""} />
        ))}
      </div>
      <div className="ckc__err" role="alert">
        {busy ? t.checking : error}
      </div>
      <div className="ckc__pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} aria-label={d}>
            {d}
          </button>
        ))}
        <button type="button" className="x" onClick={() => setHelp(true)}>
          {t.forgot}
        </button>
        <button type="button" onClick={() => press("0")} aria-label="0">
          0
        </button>
        <button type="button" className="x" onClick={() => setDigits((c) => c.slice(0, -1))} aria-label={t.del}>
          ⌫ {t.del}
        </button>
      </div>
    </>
  )
}

function Checklist({
  code,
  t,
  lang,
  active,
  who,
  now,
  setView,
  onDone,
  onSignedOut,
}: {
  code: string
  t: Tx
  lang: Lang
  active: ActiveCheck
  who: Who
  now: number
  setView: (v: CrewView) => void
  onDone: (r: Receipt) => void
  onSignedOut: () => void
}) {
  /** Taps sent but not answered yet, shown as if they had landed. */
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [flagFor, setFlagFor] = useState<CrewItem | null>(null)
  const [photoFor, setPhotoFor] = useState<{ item: CrewItem; blob: Blob; url: string } | null>(null)
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const camera = useRef<HTMLInputElement>(null)
  const cameraFor = useRef<CrewItem | null>(null)

  const txt = (en: string, es: string | null) => (lang === "es" && es ? es : en)
  const base = counts(active)
  const stateOf = (id: string): { done: boolean; mark: CrewMarkState | undefined } => {
    const mark = base.state.get(id)
    return { done: id in pending ? pending[id] : Boolean(mark?.done), mark }
  }
  const done = active.sections.reduce((n, s) => n + s.items.filter((i) => stateOf(i.id).done).length, 0)
  const photosLeft = active.sections.reduce((n, s) => n + s.items.filter((i) => i.photoRequired && !stateOf(i.id).done).length, 0)
  const tasksLeft = base.total - done - photosLeft
  const canSubmit = now >= active.submitFrom && now <= active.closesAt
  const others = active.people.filter((p) => p !== who.name)
  const next = useMemo(() => {
    for (const s of active.sections) {
      for (const i of s.items) {
        const mark = base.state.get(i.id)
        const isDone = i.id in pending ? pending[i.id] : Boolean(mark?.done)
        if (!isDone) return { item: i, section: txt(s.en, s.es) }
      }
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pending, lang])

  const send = async (item: CrewItem, opts: { done: boolean; note?: string; photo?: Blob }) => {
    setError("")
    setPending((p) => ({ ...p, [item.id]: opts.done }))
    try {
      const form = new FormData()
      form.set("pass", who.pass)
      form.set("itemId", item.id)
      form.set("done", opts.done ? "1" : "0")
      if (opts.note) form.set("note", opts.note)
      if (opts.photo) form.set("photo", opts.photo, `${item.id}.jpg`)
      const res = await fetch(`/api/checks/${encodeURIComponent(code)}/mark`, { method: "POST", body: form })
      const body = (await res.json().catch(() => ({}))) as { error?: string; view?: CrewView }
      if (body.view) setView(body.view)
      if (!res.ok) {
        setError(body.error ?? t.offline)
        if (res.status === 401) window.setTimeout(onSignedOut, 2500)
      }
      return res.ok
    } catch {
      setError(t.offline)
      return false
    } finally {
      setPending((p) => {
        const { [item.id]: _, ...rest } = p
        return rest
      })
    }
  }

  const openCamera = (item: CrewItem) => {
    cameraFor.current = item
    camera.current?.click()
  }
  const tap = (item: CrewItem) => {
    const s = stateOf(item.id)
    if (s.done) void send(item, { done: false })
    else if (item.photoRequired) openCamera(item)
    else void send(item, { done: true })
  }

  const submit = async () => {
    setSending(true)
    setError("")
    try {
      const res = await fetch(`/api/checks/${encodeURIComponent(code)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pass: who.pass }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; view?: CrewView; receipt?: Receipt }
      if (!res.ok || !body.receipt) {
        if (body.view) setView(body.view)
        setError(body.error ?? t.offline)
        if (res.status === 401) window.setTimeout(onSignedOut, 2500)
        return
      }
      onDone(body.receipt)
    } catch {
      setError(t.offline)
    } finally {
      setSending(false)
    }
  }

  const label = active.label[lang]
  const leftText = t.left(tasksLeft, photosLeft)

  return (
    <>
      <div className="ckc__head" style={{ marginTop: 0, padding: "12px 16px", top: 0 }}>
        <div className="ckc__top">
          <span>
            <b style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 400 }}>{label}</b>{" "}
            <span className="ckc__dim" style={{ fontSize: 13 }}>
              · {t.hi(who.firstName)}
            </span>
          </span>
          <button type="button" className="ckc__flagbtn" onClick={onSignedOut}>
            {t.notYou}
          </button>
        </div>
        <div className="ckb__segs" aria-hidden>
          {active.sections.flatMap((s) => s.items).map((i) => (
            <i key={i.id} className={stateOf(i.id).done ? "f" : ""} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5 }}>
          <span className="ckc__dim">{t.doneOf(done, base.total)}</span>
          {others.length > 0 && (
            <span className="ckb__who">
              <i />
              {t.alsoOn(others.join(", "))}
            </span>
          )}
        </div>
      </div>

      {next ? (
        <div className="ckb__next">
          <span className="ck-mono">{t.nextUp(next.section)}</span>
          <b>{txt(next.item.en, next.item.es)}</b>
          {next.item.photoRequired ? (
            <button type="button" className="ckc__btn" onClick={() => openCamera(next.item)}>
              <CameraIcon /> {t.takePhotoFinish}
            </button>
          ) : (
            <button type="button" className="ckc__btn ckc__btn--light" onClick={() => void send(next.item, { done: true })}>
              ✓ {t.markDone}
            </button>
          )}
        </div>
      ) : (
        <div className="ckb__alldone">
          {t.allTasksDone} {canSubmit ? t.tapSubmit : t.comeBack(active.submitFromLabel, active.dueLabel)}
        </div>
      )}

      {active.sections.map((s) => (
        <section key={s.id} style={{ display: "grid", gap: 8 }} aria-label={txt(s.en, s.es)}>
          <div className="ckc__sect">
            <b>{txt(s.en, s.es)}</b>
            <span className="ck-mono">
              {s.items.filter((i) => stateOf(i.id).done).length} / {s.items.length}
            </span>
          </div>
          {s.items.map((i) => {
            const { done: isDone, mark } = stateOf(i.id)
            const flagged = isDone && Boolean(mark?.note) && !(i.id in pending)
            const cls = `ckc__row${isDone ? " done" : ""}${flagged ? " is-flag" : ""}${!isDone && i.photoRequired ? " cam" : ""}`
            return (
              <div key={i.id} style={{ display: "grid", gap: 2 }}>
                <button type="button" className={cls} aria-pressed={isDone} onClick={() => tap(i)}>
                  <span className="ck">{flagged ? "!" : isDone ? "✓" : i.photoRequired ? <CameraIcon size={16} /> : ""}</span>
                  <span>
                    {txt(i.en, i.es)}
                    {isDone && mark && !(i.id in pending) && (
                      <span className="ckb__stamp">{t.stamp(mark.at, mark.by, mark.hasPhoto)}</span>
                    )}
                    {flagged && (
                      <small>
                        {t.needsAttention} · {mark!.note}
                      </small>
                    )}
                    {!isDone && i.photoRequired && <span className="ckb__need">{t.photoRequired}</span>}
                  </span>
                </button>
                {!isDone && (
                  <button type="button" className="ckc__flagbtn" onClick={() => setFlagFor(i)}>
                    {t.problem}
                  </button>
                )}
              </div>
            )
          })}
        </section>
      ))}
      <p className="ckc__dim" style={{ fontSize: 12.5 }}>{t.undoHelp}</p>

      <div className="ckc__foot" style={{ padding: "10px 16px max(14px, env(safe-area-inset-bottom, 0px))" }}>
        <div className="ckc__err" role="alert" style={{ minHeight: error ? 20 : 0 }}>
          {error}
        </div>
        {!canSubmit ? (
          <button type="button" className="ckc__btn" disabled>
            {t.submitOpens(active.submitFromLabel)}
          </button>
        ) : leftText ? (
          <button type="button" className="ckc__btn" disabled>
            {leftText}
          </button>
        ) : (
          <button type="button" className="ckc__btn" disabled={sending} onClick={submit}>
            {sending ? t.sending : t.submitCheck(label)}
          </button>
        )}
      </div>

      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          const item = cameraFor.current
          if (!file || !item) return
          const blob = await compress(file)
          setPhotoFor({ item, blob, url: URL.createObjectURL(blob) })
        }}
      />
      {photoFor && (
        <PhotoSheet
          t={t}
          title={txt(photoFor.item.en, photoFor.item.es)}
          url={photoFor.url}
          onRetake={() => {
            URL.revokeObjectURL(photoFor.url)
            const item = photoFor.item
            setPhotoFor(null)
            openCamera(item)
          }}
          onUse={async () => {
            const ok = await send(photoFor.item, { done: true, photo: photoFor.blob })
            if (ok) {
              URL.revokeObjectURL(photoFor.url)
              setPhotoFor(null)
            }
          }}
          onCancel={() => {
            URL.revokeObjectURL(photoFor.url)
            setPhotoFor(null)
          }}
          error={error}
        />
      )}
      {flagFor && (
        <FlagSheet
          t={t}
          current={stateOf(flagFor.id).mark?.note ?? ""}
          onCancel={() => setFlagFor(null)}
          onSave={(note) => {
            void send(flagFor, { done: true, note })
            setFlagFor(null)
          }}
          onRemove={() => {
            void send(flagFor, { done: false })
            setFlagFor(null)
          }}
        />
      )}
    </>
  )
}

function CameraIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 7h4l2-3h6l2 3h4v13H3z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function PhotoSheet({
  t,
  title,
  url,
  error,
  onUse,
  onRetake,
  onCancel,
}: {
  t: Tx
  title: string
  url: string
  error: string
  onUse: () => Promise<void>
  onRetake: () => void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="ckc__sheet" role="dialog" aria-modal="true" aria-label={t.photoTitle} onClick={busy ? undefined : onCancel}>
      <div onClick={(e) => e.stopPropagation()}>
        <span className="ck-mono">{t.photoTitle}</span>
        <h2>{title}</h2>
        {/* eslint-disable-next-line @next/next/no-img-element -- local preview blob */}
        <img className="ckb__preview" src={url} alt="" />
        <div className="ckc__err" role="alert">
          {busy ? t.uploading : error}
        </div>
        <button
          type="button"
          className="ckc__btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await onUse()
            setBusy(false)
          }}
        >
          {busy ? t.uploading : t.photoUse}
        </button>
        <button type="button" className="ckc__btn ckc__btn--ghost" disabled={busy} onClick={onRetake}>
          {t.retake}
        </button>
      </div>
    </div>
  )
}

function FlagSheet({
  t,
  current,
  onSave,
  onRemove,
  onCancel,
}: {
  t: Tx
  current: string
  onSave: (note: string) => void
  onRemove: () => void
  onCancel: () => void
}) {
  const [note, setNote] = useState(current)
  return (
    <div className="ckc__sheet" role="dialog" aria-modal="true" aria-label={t.flagTitle} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()}>
        <h2>{t.flagTitle}</h2>
        <p className="ckc__dim" style={{ margin: 0, fontSize: 13 }}>
          {t.flagHelp}
        </p>
        <div className="ckc__chips">
          {t.flagChips.map((c) => (
            <button key={c} type="button" onClick={() => setNote(c)}>
              {c}
            </button>
          ))}
        </div>
        <textarea value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} aria-label={t.flagTitle} />
        <button type="button" className="ckc__btn" disabled={!note.trim()} onClick={() => onSave(note.trim())}>
          {t.saveFlag}
        </button>
        {current ? (
          <button type="button" className="ckc__btn ckc__btn--ghost" onClick={onRemove}>
            {t.removeFlag}
          </button>
        ) : (
          <button type="button" className="ckc__btn ckc__btn--ghost" onClick={onCancel}>
            {t.cancel}
          </button>
        )}
      </div>
    </div>
  )
}

function Done({
  t,
  lang,
  receipt,
  firstName,
  onHome,
}: {
  t: Tx
  lang: Lang
  receipt: Receipt
  firstName: string
  onHome: () => void
}) {
  const [left, setLeft] = useState(10)
  useEffect(() => {
    const id = window.setInterval(() => setLeft((s) => s - 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => {
    if (left <= 0) onHome()
  }, [left, onHome])
  const day = new Date(`${receipt.day}T12:00:00Z`).toLocaleDateString(lang === "es" ? "es-US" : "en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  })
  return (
    <>
      <div className="ckc__done">
        <div className="ckc__big" aria-hidden>
          ✓
        </div>
        <h1>{t.doneTitle(receipt.check[lang])}</h1>
        <p className="ckc__dim" style={{ margin: 0 }}>
          {t.thanks(firstName)}
        </p>
        <div className="ckc__receipt">
          <div>
            <span className="ckc__dim">{t.submitted}</span>
            <b>
              {day} · {receipt.at}
            </b>
          </div>
          {receipt.people.length > 0 && (
            <div>
              <span className="ckc__dim">{t.doneBy}</span>
              <b>{receipt.people.join(", ")}</b>
            </div>
          )}
          <div>
            <span className="ckc__dim">{t.store}</span>
            <b>{t.tasks(receipt.tasks, receipt.photos)}</b>
          </div>
          {receipt.next && (
            <div>
              <span className="ckc__dim">{t.nextCheck}</span>
              <b>
                {receipt.next.label[lang]} · {receipt.next.opensLabel}
              </b>
            </div>
          )}
        </div>
      </div>
      <div className="ckc__push">
        <button type="button" className="ckc__btn ckc__btn--ghost" onClick={onHome}>
          {t.backHome}
        </button>
        <p className="ck-mono" style={{ textAlign: "center", margin: 0 }}>
          {t.signsOut(Math.max(0, left))}
        </p>
      </div>
    </>
  )
}
