"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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
  /** Practice while checks are paused: nothing was saved or sent. */
  practice?: boolean
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
    closedItself: (at: string, a: number, b: number) =>
      a === b ? `Closed ${at} · all ${b} tasks done` : a === 0 ? `Closed ${at} · nothing was ticked` : `Closed ${at} · ${a} of ${b} done, ${b - a} missed`,
    closesItself: (at: string, left: string) => `Closes by itself at ${at} · ${left} left`,
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
    more: (task: string) => `More for ${task}`,
    doneWithNote: "Done, with a note",
    takePhoto: "Take the photo",
    closingSoon: (left: string) => `${left} left. Anything not ticked when it closes counts as missed.`,
    queued: (n: number) => `No signal. ${n} tick${n === 1 ? "" : "s"} kept on this phone, sending when it's back.`,
    redo: (note: string) => `Sent back · ${note.replace(/^Redo:?\s*/i, "")}`,
    sectionLeft: (n: number) => (n === 0 ? "Done" : `${n} left`),
    photoRequired: "Photo required · tap to open camera",
    stamp: (at: string, by: string, photo: boolean) => `${at} · ${by}${photo ? " · photo" : ""}`,
    allTasksDone: "All tasks done.",
    comeBack: (from: string, to: string) => `Come back between ${from} and ${to} to submit.`,
    tapSubmit: "Tap Submit below.",
    undoHelp: "Tap a done task to see who did it. Undo is in there, so nobody undoes a task by accident.",
    doneSheetTitle: "Already done",
    doneByAt: (by: string, at: string) => `Done by ${by} at ${at}`,
    doneByYou: (at: string) => `You did this at ${at}`,
    withPhoto: "Photo saved with it.",
    keepDone: "Keep it done",
    addPhoto: "Add the photo",
    undoMine: "Undo, it's not done",
    undoTheirs: (by: string) => `Undo ${by}'s tick`,
    undoWarn: "Only undo if the task really needs doing again.",
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
    practiceTitle: "Practice mode",
    practiceHelp: "Your manager paused checks while you learn. Practice the open check as many times as you like. Nothing is saved or counted.",
    practiceOpen: "Open for practice",
    practiceFrom: (t: string) => `Practice from ${t}`,
    practiceSubmit: (c: string) => `Finish ${c} practice`,
    practiceDoneTitle: (c: string) => `${c} practice done`,
    practiceThanks: (n: string) => `Nice work, ${n}. Nothing was saved, and the list is clear for the next person.`,
  },
  es: {
    openUntil: (from: string, to: string) => `Abierta · se envía de ${from} a ${to}`,
    submitNow: (to: string, left: string) => `Envíala ya · cierra ${to} · quedan ${left}`,
    opensAt: (t: string) => `Abre a las ${t}`,
    sentBy: (at: string, who: string) => `Enviada ${at} por ${who}`,
    missed: "No se hizo",
    closedItself: (at: string, a: number, b: number) =>
      a === b ? `Cerrada ${at} · las ${b} tareas hechas` : a === 0 ? `Cerrada ${at} · no se marcó nada` : `Cerrada ${at} · ${a} de ${b} hechas, faltaron ${b - a}`,
    closesItself: (at: string, left: string) => `Se cierra sola a las ${at} · quedan ${left}`,
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
    more: (task: string) => `Más para ${task}`,
    doneWithNote: "Hecha, con una nota",
    takePhoto: "Tomar la foto",
    closingSoon: (left: string) => `Quedan ${left}. Lo que no esté marcado al cerrar cuenta como no hecho.`,
    queued: (n: number) => `Sin señal. ${n} marca${n === 1 ? "" : "s"} guardada${n === 1 ? "" : "s"} en este teléfono; se envían al volver la señal.`,
    redo: (note: string) => `Devuelta · ${note.replace(/^Redo:?\s*/i, "")}`,
    sectionLeft: (n: number) => (n === 0 ? "Hecha" : `Faltan ${n}`),
    photoRequired: "Foto obligatoria · toca para abrir la cámara",
    stamp: (at: string, by: string, photo: boolean) => `${at} · ${by}${photo ? " · foto" : ""}`,
    allTasksDone: "Todas las tareas están hechas.",
    comeBack: (from: string, to: string) => `Vuelve entre ${from} y ${to} para enviarla.`,
    tapSubmit: "Toca Enviar abajo.",
    undoHelp: "Toca una tarea hecha para ver quién la hizo. Ahí puedes deshacerla, así nadie la quita por error.",
    doneSheetTitle: "Ya está hecha",
    doneByAt: (by: string, at: string) => `La hizo ${by} a las ${at}`,
    doneByYou: (at: string) => `La hiciste tú a las ${at}`,
    withPhoto: "Tiene foto guardada.",
    keepDone: "Dejarla hecha",
    addPhoto: "Agregar la foto",
    undoMine: "Deshacer, no está hecha",
    undoTheirs: (by: string) => `Deshacer la marca de ${by}`,
    undoWarn: "Deshazla solo si de verdad hay que hacerla otra vez.",
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
    practiceTitle: "Modo de práctica",
    practiceHelp: "Tu gerente pausó las revisiones mientras aprendes. Practica la revisión abierta las veces que quieras. No se guarda ni cuenta nada.",
    practiceOpen: "Abierta para practicar",
    practiceFrom: (t: string) => `Práctica desde las ${t}`,
    practiceSubmit: (c: string) => `Terminar práctica de ${c.toLowerCase()}`,
    practiceDoneTitle: (c: string) => `Práctica de ${c.toLowerCase()} terminada`,
    practiceThanks: (n: string) => `Buen trabajo, ${n}. No se guardó nada y la lista quedó limpia para la siguiente persona.`,
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
      <p className="ckc__dim ckb__date">
        {day} · {clock}
      </p>
      {notice && <div className="ckb__alldone ckb__alldone--warn">{notice}</div>}
      {view.practice && !view.closedToday && <PracticeBanner t={t} />}
      {view.closedToday ? (
        <div className="ckc__hero">
          <h2>{t.closedToday}</h2>
        </div>
      ) : (
        view.rows.map((r) => {
          const live = a?.kind === r.kind
          let line = t.opensAt(r.opensLabel)
          let tone = "ckb__tone-dim"
          if (live && a && a.practice) {
            line = t.practiceOpen
            tone = "ckb__tone-good"
          } else if (live && a) {
            const canSubmit = now >= a.submitFrom && now <= a.closesAt
            line = canSubmit
              ? t.submitNow(a.dueLabel, durationLabel(a.dueAt - now))
              : t.openUntil(a.submitFromLabel, a.dueLabel)
            tone = "ckb__tone-good"
          } else if (r.autoClosed && r.doneAt) {
            line = t.closedItself(r.doneAt, r.tasksDone, r.tasksTotal)
            tone = r.tasksDone === r.tasksTotal ? "ckb__tone-good" : "ckb__tone-bad"
          } else if ((r.status === "on_time" || r.status === "late") && r.doneBy && r.doneAt) {
            line = t.sentBy(r.doneAt, r.doneBy)
            tone = "ckb__tone-good"
          } else if (r.status === "missed") {
            line = t.missed
            tone = "ckb__tone-bad"
          } else if (r.status === "closed") line = t.closedNow
          else if (r.status === "off") line = t.off
          else if (r.status === "paused") line = t.practiceFrom(r.opensLabel)
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
              {c && <span className="ckc__dim ckb__progress">{t.progress(c.done, c.total)}</span>}
            </button>
          )
        })
      )}
      {!a && !view.closedToday && (
        <p className="ckc__dim ckb__progress">
          {view.next ? t.nextOpens(view.next.label[lang], view.next.opensLabel) : t.allDone}
        </p>
      )}
      {a && <p className="ckc__dim ckb__help">{t.pickHelp}</p>}
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
      <button type="button" className="ckc__btn ckc__btn--ghost ckb__back" onClick={onBack}>
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

/** A tick that could not reach the server, kept until the signal is back. */
type Queued = { itemId: string; done: boolean; note?: string; seen?: string; photo?: Blob }
/** In the last 15 minutes before a check closes itself, the header turns yellow and the phone buzzes once. */
const CLOSING_SOON_MS = 15 * 60_000
const FLUSH_MS = 5_000

function queueKey(code: string, a: ActiveCheck) {
  return `checks.queue.${code}.${a.kind}.${a.day}`
}
function readQueue(key: string): Queued[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Queued[]) : []
  } catch {
    return []
  }
}
function writeQueue(key: string, q: Queued[]) {
  try {
    // Photos stay in memory only; a reload keeps the ticks, not the pictures.
    const plain = q.filter((x) => !x.photo)
    if (plain.length === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(plain))
  } catch {}
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
  const qKey = queueKey(code, active)
  /** Ticks kept on the phone while there is no signal, oldest first. */
  const queue = useRef<Queued[]>(readQueue(qKey))
  /** Taps sent but not answered yet, or waiting for signal, shown as if they had landed. */
  const [pending, setPending] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(queue.current.map((q) => [q.itemId, q.done])),
  )
  const [queued, setQueued] = useState(queue.current.length)
  /** The task being flagged, with the note and mark it had when the sheet opened. */
  const [flagFor, setFlagFor] = useState<{ item: CrewItem; note: string; seen?: string } | null>(null)
  /** A done task someone tapped: shows who did it, and undo is a second, deliberate tap. */
  const [doneFor, setDoneFor] = useState<CrewItem | null>(null)
  /** The ⋯ menu on a task not done yet: a note, or the photo. */
  const [menuFor, setMenuFor] = useState<CrewItem | null>(null)
  const [photoFor, setPhotoFor] = useState<{ item: CrewItem; blob: Blob; url: string } | null>(null)
  /** Sections folded or unfolded by hand; untouched ones fold when they are all done. */
  const [folded, setFolded] = useState<Record<string, boolean>>({})
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
  // Someone else undid the task while this sheet was open: nothing left to keep.
  const doneForGone = doneFor !== null && !base.state.get(doneFor.id)?.done
  useEffect(() => {
    if (doneForGone) setDoneFor(null)
  }, [doneForGone])
  const done = active.sections.reduce((n, s) => n + s.items.filter((i) => stateOf(i.id).done).length, 0)
  const photosLeft = active.sections.reduce((n, s) => n + s.items.filter((i) => i.photoRequired && !stateOf(i.id).done).length, 0)
  const tasksLeft = base.total - done - photosLeft
  const canSubmit = active.practice || (now >= active.submitFrom && now <= active.closesAt)
  const others = active.people.filter((p) => p !== who.name)
  const leftMs = active.closesAt - now
  const closingSoon = !active.practice && leftMs > 0 && leftMs <= CLOSING_SOON_MS && done < base.total

  // One buzz when the last 15 minutes start, on phones that can.
  const buzzed = useRef(false)
  useEffect(() => {
    if (!closingSoon || buzzed.current) return
    buzzed.current = true
    try {
      navigator.vibrate?.([200, 100, 200])
    } catch {}
  }, [closingSoon])

  const clearPending = (id: string) =>
    setPending((p) => {
      const { [id]: _, ...rest } = p
      return rest
    })

  /** One request. "offline" means it never reached the server and can be tried again. */
  const post = async (q: Queued): Promise<"ok" | "refused" | "offline"> => {
    try {
      const form = new FormData()
      form.set("pass", who.pass)
      form.set("itemId", q.itemId)
      form.set("done", q.done ? "1" : "0")
      if (q.note) form.set("note", q.note)
      if (q.seen) form.set("seen", q.seen)
      if (q.photo) form.set("photo", q.photo, `${q.itemId}.jpg`)
      const res = await fetch(`/api/checks/${encodeURIComponent(code)}/mark`, { method: "POST", body: form })
      const body = (await res.json().catch(() => ({}))) as { error?: string; view?: CrewView }
      // A gateway error with no answer from the app is the network's, not the app saying no.
      if (res.status >= 502 && !body.error) return "offline"
      if (body.view) setView(body.view)
      if (!res.ok) {
        setError(body.error ?? t.offline)
        if (res.status === 401) window.setTimeout(onSignedOut, 2500)
        return "refused"
      }
      return "ok"
    } catch {
      return "offline"
    }
  }

  const keep = (q: Queued) => {
    // The newest tap on a task replaces any older one still waiting.
    queue.current = [...queue.current.filter((x) => x.itemId !== q.itemId), q]
    writeQueue(qKey, queue.current)
    setQueued(queue.current.length)
  }

  const flushing = useRef(false)
  const flush = useCallback(async () => {
    if (flushing.current || queue.current.length === 0) return
    flushing.current = true
    try {
      while (queue.current.length > 0) {
        const q = queue.current[0]
        const r = await post(q)
        if (r === "offline") break
        queue.current = queue.current.slice(1)
        writeQueue(qKey, queue.current)
        setQueued(queue.current.length)
        // A newer tap on the same task may be waiting behind this one.
        if (!queue.current.some((x) => x.itemId === q.itemId)) clearPending(q.itemId)
      }
    } finally {
      flushing.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qKey])
  useEffect(() => {
    if (queued === 0) return
    const id = window.setInterval(() => void flush(), FLUSH_MS)
    window.addEventListener("online", flush)
    void flush()
    return () => {
      window.clearInterval(id)
      window.removeEventListener("online", flush)
    }
  }, [queued, flush])

  const send = async (item: CrewItem, opts: { done: boolean; note?: string; photo?: Blob; seen?: string }) => {
    setError("")
    setPending((p) => ({ ...p, [item.id]: opts.done }))
    const q: Queued = { itemId: item.id, ...opts }
    // Behind a tick still waiting for signal: wait in line, so they land in order.
    if (queue.current.length > 0) {
      keep(q)
      return true
    }
    const r = await post(q)
    if (r === "offline") {
      keep(q)
      return true
    }
    clearPending(item.id)
    return r === "ok"
  }

  const openCamera = (item: CrewItem) => {
    cameraFor.current = item
    camera.current?.click()
  }
  const tap = (item: CrewItem) => {
    const s = stateOf(item.id)
    if (s.done) {
      // Never untick on one tap: another person's phone may have just ticked
      // it. Show who did it; undo is a separate button.
      if (!(item.id in pending)) setDoneFor(item)
    }
    else if (item.photoRequired) openCamera(item)
    else void send(item, { done: true })
  }

  const submit = async () => {
    setSending(true)
    setError("")
    try {
      await flush()
      if (queue.current.length > 0) {
        setError(t.queued(queue.current.length))
        return
      }
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
  const closeAt = new Date(active.closesAt).toLocaleTimeString(lang === "es" ? "es-US" : "en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  }).toLowerCase()

  return (
    <>
      <div className={`ckc__head${closingSoon ? " ckb__head--soon" : ""}`} style={{ marginTop: 0, padding: "12px 16px", top: 0 }}>
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
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, flexWrap: "wrap" }}>
          <b>{t.doneOf(done, base.total)}</b>
          {!active.practice && leftMs > 0 && (
            <span className="ckb__count" role="timer">
              {t.closesItself(closeAt, durationLabel(leftMs))}
            </span>
          )}
        </div>
        {closingSoon && (
          <div className="ckb__soon" role="alert">
            {t.closingSoon(durationLabel(leftMs))}
          </div>
        )}
        {others.length > 0 && (
          <span className="ckb__who" style={{ fontSize: 13 }}>
            <i />
            {t.alsoOn(others.join(", "))}
          </span>
        )}
      </div>

      {active.practice && <PracticeBanner t={t} />}
      {queued > 0 && (
        <div className="ckb__queued" role="status">
          {t.queued(queued)}
        </div>
      )}

      {done === base.total && (
        <div className="ckb__alldone">
          {t.allTasksDone} {canSubmit ? t.tapSubmit : t.comeBack(active.submitFromLabel, active.dueLabel)}
        </div>
      )}

      {active.sections.map((s) => {
        const left = s.items.filter((i) => !stateOf(i.id).done).length
        const isFolded = folded[s.id] ?? left === 0
        const name = txt(s.en, s.es)
        return (
          <section key={s.id} className="ckb__sec" aria-label={name}>
            <button
              type="button"
              className={`ckb__sechead${left === 0 ? " done" : ""}`}
              aria-expanded={!isFolded}
              onClick={() => setFolded((f) => ({ ...f, [s.id]: !isFolded }))}
            >
              <b>{name}</b>
              <span className="ck-mono">
                {s.items.length - left} / {s.items.length} · {t.sectionLeft(left)}
              </span>
              <span className="ckb__caret" aria-hidden>
                ›
              </span>
            </button>
            {!isFolded &&
              s.items.map((i) => {
                const { done: isDone, mark } = stateOf(i.id)
                const waiting = i.id in pending
                const flagged = isDone && Boolean(mark?.note) && !waiting
                // The owner sent a photo back: the untick carries their note.
                const redo = !isDone && !waiting && mark && !mark.done && mark.note ? mark.note : null
                const task = txt(i.en, i.es)
                const cls = `ckc__row${isDone ? " done" : ""}${flagged ? " is-flag" : ""}${!isDone && i.photoRequired ? " cam" : ""}${redo ? " is-redo" : ""}`
                return (
                  <div key={i.id} className="ckb__task">
                    <button type="button" className={cls} aria-pressed={isDone} onClick={() => tap(i)}>
                      <span className="ck">{flagged ? "!" : isDone ? "✓" : i.photoRequired ? <CameraIcon size={16} /> : ""}</span>
                      <span>
                        {task}
                        {isDone && mark && !waiting && <span className="ckb__stamp">{t.stamp(mark.at, mark.by, mark.hasPhoto)}</span>}
                        {flagged && (
                          <small>
                            {t.needsAttention} · {mark!.note}
                          </small>
                        )}
                        {redo && <small className="ckb__redo">{t.redo(redo)}</small>}
                        {!isDone && i.photoRequired && <span className="ckb__need">{t.photoRequired}</span>}
                      </span>
                    </button>
                    {!isDone && (
                      <button type="button" className="ckb__more" aria-label={t.more(task)} onClick={() => setMenuFor(i)}>
                        ⋯
                      </button>
                    )}
                  </div>
                )
              })}
          </section>
        )
      })}
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
            {sending ? t.sending : active.practice ? t.practiceSubmit(label) : t.submitCheck(label)}
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
      {menuFor && (
        <TaskMenu
          t={t}
          title={txt(menuFor.en, menuFor.es)}
          photo={menuFor.photoRequired}
          onNote={() => {
            const mark = stateOf(menuFor.id).mark
            setFlagFor({ item: menuFor, note: "", seen: mark?.markId })
            setMenuFor(null)
          }}
          onPhoto={() => {
            const item = menuFor
            setMenuFor(null)
            openCamera(item)
          }}
          onCancel={() => setMenuFor(null)}
        />
      )}
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
          current={flagFor.note}
          onCancel={() => setFlagFor(null)}
          onSave={(note) => {
            void send(flagFor.item, { done: true, note })
            setFlagFor(null)
          }}
          onRemove={() => {
            void send(flagFor.item, { done: false, seen: flagFor.seen })
            setFlagFor(null)
          }}
        />
      )}
      {doneFor && (() => {
        const mark = stateOf(doneFor.id).mark
        if (!mark?.done) return null
        return (
          <DoneSheet
            t={t}
            title={txt(doneFor.en, doneFor.es)}
            mark={mark}
            mine={mark.by === who.name}
            onPhoto={doneFor.photoRequired && !mark.hasPhoto ? () => {
              const item = doneFor
              setDoneFor(null)
              openCamera(item)
            } : undefined}
            onKeep={() => setDoneFor(null)}
            onUndo={() => {
              void send(doneFor, { done: false, seen: mark.markId })
              setDoneFor(null)
            }}
          />
        )
      })()}
    </>
  )
}

/** The ⋯ on a task not done yet: finish it with a note, or take its photo. */
function TaskMenu({
  t,
  title,
  photo,
  onNote,
  onPhoto,
  onCancel,
}: {
  t: Tx
  title: string
  photo: boolean
  onNote: () => void
  onPhoto: () => void
  onCancel: () => void
}) {
  return (
    <div className="ckc__sheet" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {photo && (
          <button type="button" className="ckc__btn" onClick={onPhoto}>
            <CameraIcon /> {t.takePhoto}
          </button>
        )}
        <button type="button" className={`ckc__btn${photo ? " ckc__btn--light" : ""}`} onClick={onNote}>
          {t.doneWithNote}
        </button>
        <p className="ckc__dim" style={{ margin: 0, fontSize: 13 }}>
          {t.flagHelp}
        </p>
        <button type="button" className="ckc__btn ckc__btn--ghost" onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
    </div>
  )
}

/** Said on the store page and over the list while the owner has checks paused. */
function PracticeBanner({ t }: { t: Tx }) {
  return (
    <div className="ckb__practice" role="note">
      <b>{t.practiceTitle}</b>
      <span>{t.practiceHelp}</span>
    </div>
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

function DoneSheet({
  t,
  title,
  mark,
  mine,
  onKeep,
  onUndo,
  onPhoto,
}: {
  t: Tx
  title: string
  mark: CrewMarkState
  mine: boolean
  onKeep: () => void
  onUndo: () => void
  /** A photo task finished with a note: the photo can still be added. */
  onPhoto?: () => void
}) {
  return (
    <div className="ckc__sheet" role="dialog" aria-modal="true" aria-label={t.doneSheetTitle} onClick={onKeep}>
      <div onClick={(e) => e.stopPropagation()}>
        <h2>{t.doneSheetTitle}</h2>
        <b>{title}</b>
        <p className="ckc__dim" style={{ margin: 0, fontSize: 14 }}>
          {mine ? t.doneByYou(mark.at) : t.doneByAt(mark.by, mark.at)}
          {mark.hasPhoto ? ` ${t.withPhoto}` : ""}
        </p>
        {mark.note && (
          <p className="ckc__dim" style={{ margin: 0, fontSize: 13 }}>
            {t.needsAttention} · {mark.note}
          </p>
        )}
        <button type="button" className="ckc__btn" onClick={onKeep}>
          ✓ {t.keepDone}
        </button>
        {onPhoto && (
          <button type="button" className="ckc__btn ckc__btn--light" onClick={onPhoto}>
            <CameraIcon /> {t.addPhoto}
          </button>
        )}
        <button type="button" className="ckc__btn ckc__btn--ghost" onClick={onUndo}>
          {mine ? t.undoMine : t.undoTheirs(mark.by)}
        </button>
        <p className="ckc__dim" style={{ margin: 0, fontSize: 12.5 }}>
          {t.undoWarn}
        </p>
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
        <h1>{receipt.practice ? t.practiceDoneTitle(receipt.check[lang]) : t.doneTitle(receipt.check[lang])}</h1>
        <p className="ckc__dim" style={{ margin: 0 }}>
          {receipt.practice ? t.practiceThanks(firstName) : t.thanks(firstName)}
        </p>
        <div className="ckc__receipt">
          <div>
            <span className="ckc__dim">{receipt.practice ? t.practiceTitle : t.submitted}</span>
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
