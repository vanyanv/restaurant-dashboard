"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { ActiveCheck, CrewSection, CrewView } from "@/lib/checks/crew"
import type { CellStatus } from "@/lib/checks/status"

/**
 * The crew flow, one job per screen: store page -> PIN -> checklist ->
 * review -> done. Built for wet or gloved hands: rows 60px tall, keys 64px,
 * and the bottom bar always names what is left.
 *
 * Ticks and flags are saved on the phone as they happen (localStorage, keyed
 * by store, check and day), so a reload or a dropped signal loses nothing.
 * Photos stay in memory; the page says so if they are lost to a reload.
 */

type Lang = "en" | "es"
type Answer = { done: boolean; flag: string | null }
type Answers = Record<string, Answer>
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
  next: CrewView["next"]
}
type Screen = "home" | "pin" | "list" | "review" | "done"

const T = {
  en: {
    openNow: "Open now",
    overdue: "Overdue · still takes it",
    closes: (t: string) => `Due ${t}`,
    left: (d: string) => `${d} left`,
    lateBy: (d: string) => `${d} late`,
    start: (c: string) => `Start ${c} check`,
    continue: (c: string) => `Continue ${c} check`,
    noneOpen: "No check is open right now",
    nextOpens: (c: string, t: string) => `${c} check opens at ${t}.`,
    allDone: "Every check is done for today.",
    closedToday: "The store is marked closed today. No checks are due.",
    doneBy: (who: string, at: string) => `Done ${at} by ${who}`,
    lateDone: (who: string, at: string, m: number) => `Done ${at} by ${who} · ${m} min late`,
    missed: "Missed",
    opens: (w: string) => w,
    off: "Switched off",
    enterPin: "Enter your PIN",
    pinHelp: "4 digits. Your manager sent it to you.",
    forgot: "Forgot?",
    forgotHelp: "Ask your manager. They can see your PIN in the dashboard.",
    del: "Delete",
    checking: "Checking…",
    hi: (n: string) => `Hi ${n}`,
    of: (a: number, b: number) => `${a} of ${b}`,
    photoReq: "photo · required",
    photoOpt: "photo · optional",
    takePhoto: "Take photo",
    retake: "Photo added · tap to retake",
    problem: "Problem?",
    needsAttention: "Needs attention",
    flagTitle: "What's wrong?",
    flagHelp: "It counts as done and your manager sees the note.",
    flagChips: ["Out of supplies", "Broken", "Ran out of time", "Not needed today"],
    saveFlag: "Save note",
    removeFlag: "Remove note",
    cancel: "Cancel",
    itemsLeft: (n: number) => `${n} item${n === 1 ? "" : "s"} left`,
    photosLeft: (n: number) => `${n} photo${n === 1 ? "" : "s"} left`,
    andJoin: " and ",
    allSet: "Everything is done",
    review: "Review and submit",
    ready: "Ready to submit?",
    back: "‹ Back to list",
    flaggedN: (n: number) => `${n} need${n === 1 ? "s" : ""} attention`,
    lockNote: (c: string, s: string) =>
      `Submitting locks the ${c} check for ${s} for today. Nobody can change it after.`,
    submitAs: (n: string) => `Submit as ${n}`,
    sending: "Sending…",
    doneTitle: (c: string) => `${c} check done`,
    thanks: (n: string) => `Thanks, ${n}. It's saved and locked.`,
    store: "Store",
    submitted: "Submitted",
    onTime: "On time",
    yes: (t: string) => `Yes · due ${t}`,
    no: (m: number) => `No · ${m} min late`,
    nextCheck: "Next check",
    backHome: "Done · back to store page",
    signsOut: (s: number) => `Signs you out in ${s} s`,
    photosLost: "The page reloaded, so take the photos again. Your ticks were saved.",
    notYou: "Not you? Sign out",
    sectionOf: (s: string) => s,
  },
  es: {
    openNow: "Abierta ahora",
    overdue: "Atrasada · todavía se acepta",
    closes: (t: string) => `Vence ${t}`,
    left: (d: string) => `Quedan ${d}`,
    lateBy: (d: string) => `${d} tarde`,
    start: (c: string) => `Empezar revisión de ${c.toLowerCase()}`,
    continue: (c: string) => `Seguir revisión de ${c.toLowerCase()}`,
    noneOpen: "No hay ninguna revisión abierta ahora",
    nextOpens: (c: string, t: string) => `La revisión de ${c.toLowerCase()} abre a las ${t}.`,
    allDone: "Todas las revisiones de hoy están hechas.",
    closedToday: "La tienda está marcada como cerrada hoy. No hay revisiones.",
    doneBy: (who: string, at: string) => `Hecha ${at} por ${who}`,
    lateDone: (who: string, at: string, m: number) => `Hecha ${at} por ${who} · ${m} min tarde`,
    missed: "No se hizo",
    opens: (w: string) => w,
    off: "Apagada",
    enterPin: "Escribe tu PIN",
    pinHelp: "4 dígitos. Tu gerente te lo envió.",
    forgot: "¿Lo olvidaste?",
    forgotHelp: "Pregúntale a tu gerente. Puede ver tu PIN en el panel.",
    del: "Borrar",
    checking: "Revisando…",
    hi: (n: string) => `Hola ${n}`,
    of: (a: number, b: number) => `${a} de ${b}`,
    photoReq: "foto · obligatoria",
    photoOpt: "foto · opcional",
    takePhoto: "Tomar foto",
    retake: "Foto lista · toca para repetir",
    problem: "¿Problema?",
    needsAttention: "Necesita atención",
    flagTitle: "¿Qué pasa?",
    flagHelp: "Cuenta como hecho y tu gerente ve la nota.",
    flagChips: ["Faltan productos", "Roto", "No hubo tiempo", "No hace falta hoy"],
    saveFlag: "Guardar nota",
    removeFlag: "Quitar nota",
    cancel: "Cancelar",
    itemsLeft: (n: number) => `Falta${n === 1 ? "" : "n"} ${n} tarea${n === 1 ? "" : "s"}`,
    photosLeft: (n: number) => `${n} foto${n === 1 ? "" : "s"}`,
    andJoin: " y ",
    allSet: "Todo está hecho",
    review: "Revisar y enviar",
    ready: "¿Listo para enviar?",
    back: "‹ Volver a la lista",
    flaggedN: (n: number) => `${n} necesita${n === 1 ? "" : "n"} atención`,
    lockNote: (c: string, s: string) =>
      `Al enviar, la revisión de ${c.toLowerCase()} de ${s} queda cerrada por hoy. Nadie la puede cambiar.`,
    submitAs: (n: string) => `Enviar como ${n}`,
    sending: "Enviando…",
    doneTitle: (c: string) => `Revisión de ${c.toLowerCase()} lista`,
    thanks: (n: string) => `Gracias, ${n}. Quedó guardada y cerrada.`,
    store: "Tienda",
    submitted: "Enviada",
    onTime: "A tiempo",
    yes: (t: string) => `Sí · vencía ${t}`,
    no: (m: number) => `No · ${m} min tarde`,
    nextCheck: "Siguiente revisión",
    backHome: "Listo · volver a la tienda",
    signsOut: (s: number) => `Se cierra tu sesión en ${s} s`,
    photosLost: "La página se recargó: toma las fotos otra vez. Tus marcas se guardaron.",
    notYou: "¿No eres tú? Salir",
    sectionOf: (s: string) => s,
  },
}

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
  const router = useRouter()
  const view = initial
  const [lang, setLangState] = useState<Lang>("en")
  useEffect(() => setLangState(readLang()), [])
  const setLang = (l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem("checks.lang", l)
    } catch {}
  }
  const t = T[lang]
  const now = useClock(view.serverNow)
  const [screen, setScreen] = useState<Screen>("home")
  const [who, setWho] = useState<Who | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const active = view.active

  const signOut = useCallback(() => {
    setWho(null)
    setReceipt(null)
    setScreen("home")
    router.refresh()
  }, [router])

  return (
    <main className="ct-root ckc" lang={lang}>
      <div className="ckc__col">
        {screen !== "list" && (
          <div className="ckc__top">
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
            <img className="ckc__logo" src="/checks-logo.png" alt="Chris N Eddy's" />
            <LangToggle lang={lang} setLang={setLang} />
          </div>
        )}
        {screen === "home" && (
          <Home view={view} t={t} lang={lang} now={now} onStart={() => setScreen(who ? "list" : "pin")} resume={Boolean(who)} />
        )}
        {screen === "pin" && active && (
          <Pin
            code={code}
            t={t}
            storeName={view.store.name}
            checkLabel={active.label[lang]}
            onBack={() => setScreen("home")}
            onOk={(w) => {
              setWho(w)
              setScreen("list")
            }}
          />
        )}
        {(screen === "list" || screen === "review") && active && who && (
          <Checklist
            code={code}
            t={t}
            lang={lang}
            setLang={setLang}
            view={view}
            active={active}
            who={who}
            now={now}
            screen={screen}
            setScreen={setScreen}
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

type Tx = (typeof T)["en"]

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="ckc__lang" role="group" aria-label="Language / Idioma">
      <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>
        English
      </button>
      <button type="button" aria-pressed={lang === "es"} onClick={() => setLang("es")}>
        Español
      </button>
    </div>
  )
}

const GLYPH: Record<CellStatus, [string, string]> = {
  on_time: ["ck-gl--ok", "✓"],
  late: ["ck-gl--late", "!"],
  missed: ["ck-gl--miss", "✕"],
  closed: ["ck-gl--closed", "–"],
  open: ["ck-gl--open", "◷"],
  upcoming: ["ck-gl--up", "·"],
  off: ["ck-gl--off", "·"],
  before: ["ck-gl--off", ""],
}

function Home({
  view,
  t,
  lang,
  now,
  onStart,
  resume,
}: {
  view: CrewView
  t: Tx
  lang: Lang
  now: number
  onStart: () => void
  resume: boolean
}) {
  const a = view.active
  const overdue = a ? now > a.dueAt : false
  const pct = a ? Math.min(100, Math.max(4, 100 - ((a.dueAt - now) / (a.dueAt - (a.dueAt - 2 * 3600_000))) * 100)) : 0
  return (
    <>
      <span className="ckc__store">{view.store.name}</span>
      {a ? (
        <div className="ckc__hero">
          <span className={`ckc__pill${overdue ? " ckc__pill--warn" : ""}`}>● {overdue ? t.overdue : t.openNow}</span>
          <h1>{lang === "es" ? `Revisión de ${a.label.es.toLowerCase()}` : `${a.label.en} check`}</h1>
          <div className="ckc__bar" aria-hidden>
            <i style={{ width: `${overdue ? 100 : pct}%` }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
            <span className="ckc__dim">{t.closes(a.dueLabel)}</span>
            <b>{overdue ? t.lateBy(durationLabel(now - a.dueAt)) : t.left(durationLabel(a.dueAt - now))}</b>
          </div>
        </div>
      ) : (
        <div className="ckc__hero">
          <h1>{view.closedToday ? t.closedToday : t.noneOpen}</h1>
          {!view.closedToday && (
            <p className="ckc__dim">{view.next ? t.nextOpens(view.next.label[lang], view.next.opensLabel) : t.allDone}</p>
          )}
        </div>
      )}
      <div className="ckc__day">
        {view.rows.map((r) => {
          const [cls, mark] = GLYPH[r.status]
          let sub = t.opens(r.windowLabel)
          if (r.status === "on_time" && r.doneBy && r.doneAt) sub = t.doneBy(r.doneBy, r.doneAt)
          if (r.status === "late" && r.doneBy && r.doneAt) sub = t.lateDone(r.doneBy, r.doneAt, r.late)
          if (r.status === "missed") sub = `${t.missed} · ${r.windowLabel}`
          return (
            <div className="ckc__dl" key={r.kind}>
              <span className={`ck-gl ${cls}`} aria-hidden>
                {mark}
              </span>
              <span>
                {r.status === "open" ? <b>{r.label[lang]}</b> : r.label[lang]}
                <small>{sub}</small>
              </span>
            </div>
          )
        })}
      </div>
      {a && (
        <div className="ckc__push">
          <button type="button" className="ckc__btn" onClick={onStart}>
            {resume ? t.continue(a.label[lang]) : t.start(a.label[lang])}
          </button>
        </div>
      )}
    </>
  )
}

function Pin({
  code,
  t,
  storeName,
  checkLabel,
  onBack,
  onOk,
}: {
  code: string
  t: Tx
  storeName: string
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
        setError("No connection. Try again.")
        setDigits("")
      } finally {
        setBusy(false)
      }
    },
    [code, onOk],
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
      <button type="button" className="ckc__store" style={{ background: "none", border: 0, textAlign: "left", padding: 0 }} onClick={onBack}>
        ‹ {storeName} · {checkLabel}
      </button>
      <div style={{ display: "grid", gap: 4, textAlign: "center", marginTop: 12 }}>
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

function storageKey(code: string, a: ActiveCheck) {
  return `checks.${code}.${a.kind}.${a.day}`
}

function loadAnswers(key: string): Answers {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as Answers
  } catch {}
  return {}
}

function Checklist({
  code,
  t,
  lang,
  setLang,
  view,
  active,
  who,
  now,
  screen,
  setScreen,
  onDone,
  onSignedOut,
}: {
  code: string
  t: Tx
  lang: Lang
  setLang: (l: Lang) => void
  view: CrewView
  active: ActiveCheck
  who: Who
  now: number
  screen: Screen
  setScreen: (s: Screen) => void
  onDone: (r: Receipt) => void
  onSignedOut: () => void
}) {
  const key = storageKey(code, active)
  const [answers, setAnswers] = useState<Answers>({})
  const [loaded, setLoaded] = useState(false)
  const [photos, setPhotos] = useState<Record<string, { blob: Blob; url: string }>>({})
  const [flagFor, setFlagFor] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const [lostPhotos, setLostPhotos] = useState(false)

  useEffect(() => {
    const saved = loadAnswers(key)
    setAnswers(saved)
    setLostPhotos(Object.keys(saved).length > 0 && active.sections.some((s) => s.photoRequired))
    setLoaded(true)
  }, [key, active.sections])

  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(key, JSON.stringify(answers))
    } catch {}
  }, [answers, key, loaded])

  const txt = (en: string, es: string | null) => (lang === "es" && es ? es : en)
  const isDone = (id: string) => Boolean(answers[id]?.done || answers[id]?.flag)

  const stats = useMemo(() => {
    let itemsLeft = 0
    let photosLeft = 0
    const per = active.sections.map((s) => {
      const done = s.items.filter((i) => isDone(i.id)).length
      itemsLeft += s.items.length - done
      if (s.photoRequired && !photos[s.id]) photosLeft += 1
      return { done, total: s.items.length }
    })
    const flagged = Object.values(answers).filter((a) => a.flag).length
    return { itemsLeft, photosLeft, per, flagged }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, photos, active.sections])

  const toggle = (id: string) =>
    setAnswers((a) => {
      const cur = a[id]
      if (cur?.flag) return a
      return { ...a, [id]: { done: !cur?.done, flag: null } }
    })

  const setPhoto = async (sectionId: string, file: File | undefined) => {
    if (!file) return
    const blob = await compress(file)
    setPhotos((p) => {
      if (p[sectionId]) URL.revokeObjectURL(p[sectionId].url)
      return { ...p, [sectionId]: { blob, url: URL.createObjectURL(blob) } }
    })
    setLostPhotos(false)
  }

  const submit = async () => {
    setSending(true)
    setError("")
    try {
      const form = new FormData()
      form.set("pass", who.pass)
      form.set("startedAt", String(who.startedAt))
      form.set("answers", JSON.stringify(answers))
      for (const [sid, p] of Object.entries(photos)) form.set(`photo_${sid}`, p.blob, `${sid}.jpg`)
      const res = await fetch(`/api/checks/${encodeURIComponent(code)}/submit`, { method: "POST", body: form })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "That didn't go through. Try again.")
        if (res.status === 401) window.setTimeout(onSignedOut, 2500)
        return
      }
      try {
        localStorage.removeItem(key)
      } catch {}
      onDone(body.receipt as Receipt)
    } catch {
      setError(lang === "es" ? "Sin conexión. Tus marcas están guardadas; inténtalo otra vez." : "No connection. Your ticks are saved; try again.")
    } finally {
      setSending(false)
    }
  }

  const leftParts = [
    stats.itemsLeft > 0 ? t.itemsLeft(stats.itemsLeft) : "",
    stats.photosLeft > 0 ? t.photosLeft(stats.photosLeft) : "",
  ].filter(Boolean)
  const complete = leftParts.length === 0
  const overdue = now > active.dueAt
  const label = active.label[lang]

  if (screen === "review") {
    return (
      <>
        <div className="ckc__top">
          <button type="button" className="ckc__store" style={{ background: "none", border: 0, padding: 0 }} onClick={() => setScreen("list")}>
            {t.back}
          </button>
          <span className="ckc__store">{overdue ? t.lateBy(durationLabel(now - active.dueAt)) : t.left(durationLabel(active.dueAt - now))}</span>
        </div>
        <h2>{t.ready}</h2>
        <div className="ckc__sum">
          {active.sections.map((s, i) => (
            <div key={s.id}>
              <span className="ck-gl ck-gl--ok" aria-hidden>
                ✓
              </span>
              <span>
                <b>{txt(s.en, s.es)}</b>
                <small>
                  {t.of(stats.per[i].done, stats.per[i].total)}
                  {photos[s.id] ? " · ✓ 📷" : ""}
                </small>
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview blob */}
              {photos[s.id] ? <img src={photos[s.id].url} alt="" /> : <span />}
            </div>
          ))}
          {stats.flagged > 0 && (
            <div className="warn">
              <span className="ck-gl ck-gl--late" aria-hidden>
                <span>!</span>
              </span>
              <span>
                <b>{t.flaggedN(stats.flagged)}</b>
                {active.sections.flatMap((s) =>
                  s.items
                    .filter((i) => answers[i.id]?.flag)
                    .map((i) => (
                      <small key={i.id}>
                        {txt(i.en, i.es)}: {answers[i.id]!.flag}
                      </small>
                    )),
                )}
              </span>
              <span />
            </div>
          )}
        </div>
        <div className="ckc__push">
          <p className="ckc__dim" style={{ margin: 0, fontSize: 13 }}>
            {t.lockNote(label, view.store.name)}
          </p>
          <div className="ckc__err" role="alert">
            {error}
          </div>
          <button type="button" className="ckc__btn" disabled={sending} onClick={submit}>
            {sending ? t.sending : t.submitAs(who.name)}
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="ckc__head">
        <div className="ckc__top">
          <span>
            <b style={{ fontFamily: "var(--display)", fontSize: 18 }}>{t.hi(who.firstName)}</b>{" "}
            <span className="ckc__dim" style={{ fontSize: 13 }}>
              · {label}
            </span>
          </span>
          <LangToggle lang={lang} setLang={setLang} />
        </div>
        <div className="ckc__segs" style={{ gridTemplateColumns: active.sections.map((s) => `${Math.max(1, s.items.length)}fr`).join(" ") }}>
          {active.sections.map((s, i) => (
            <div key={s.id}>
              <div className="ckc__bar ckc__bar--good">
                <i style={{ width: `${stats.per[i].total ? (stats.per[i].done / stats.per[i].total) * 100 : 100}%` }} />
              </div>
              <span className="ck-mono" style={{ fontSize: 9.5 }}>
                {txt(s.en, s.es)} {stats.per[i].done}/{stats.per[i].total}
              </span>
            </div>
          ))}
        </div>
        <span className="ckc__store" style={{ textAlign: "right" }}>
          {overdue ? t.lateBy(durationLabel(now - active.dueAt)) : t.left(durationLabel(active.dueAt - now))}
        </span>
      </div>
      {lostPhotos && <p className="ckc__dim" style={{ margin: 0, fontSize: 13 }}>{t.photosLost}</p>}
      {active.sections.map((s, i) => (
        <SectionBlock
          key={s.id}
          s={s}
          t={t}
          txt={txt}
          stat={stats.per[i]}
          answers={answers}
          photo={photos[s.id]?.url}
          onToggle={toggle}
          onFlag={setFlagFor}
          onPhoto={(f) => setPhoto(s.id, f)}
        />
      ))}
      <div className="ckc__foot">
        <div className="ckc__left">
          <i />
          {complete ? t.allSet : leftParts.join(t.andJoin)}
        </div>
        <button type="button" className="ckc__btn" disabled={!complete} onClick={() => setScreen("review")}>
          {t.review}
        </button>
        <button type="button" className="ckc__flagbtn" style={{ justifySelf: "center" }} onClick={onSignedOut}>
          {t.notYou}
        </button>
      </div>
      {flagFor && (
        <FlagSheet
          t={t}
          current={answers[flagFor]?.flag ?? ""}
          onCancel={() => setFlagFor(null)}
          onSave={(note) => {
            setAnswers((a) => ({ ...a, [flagFor]: { done: true, flag: note } }))
            setFlagFor(null)
          }}
          onRemove={() => {
            setAnswers((a) => ({ ...a, [flagFor]: { done: false, flag: null } }))
            setFlagFor(null)
          }}
        />
      )}
    </>
  )
}

function SectionBlock({
  s,
  t,
  txt,
  stat,
  answers,
  photo,
  onToggle,
  onFlag,
  onPhoto,
}: {
  s: CrewSection
  t: Tx
  txt: (en: string, es: string | null) => string
  stat: { done: number; total: number }
  answers: Answers
  photo: string | undefined
  onToggle: (id: string) => void
  onFlag: (id: string) => void
  onPhoto: (f: File | undefined) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const hint = txt(s.hintEn ?? "", s.hintEs)
  return (
    <section style={{ display: "grid", gap: 8 }} aria-label={txt(s.en, s.es)}>
      <div className="ckc__sect">
        <b>{txt(s.en, s.es)}</b>
        <span className="ck-mono">{t.of(stat.done, stat.total)}</span>
      </div>
      {s.items.map((i) => {
        const a = answers[i.id]
        const flagged = Boolean(a?.flag)
        const done = Boolean(a?.done) && !flagged
        return (
          <div key={i.id} style={{ display: "grid", gap: 2 }}>
            <button
              type="button"
              className={`ckc__row${done ? " done" : ""}${flagged ? " is-flag" : ""}`}
              aria-pressed={done || flagged}
              onClick={() => (flagged ? onFlag(i.id) : onToggle(i.id))}
            >
              <span className="ck">{flagged ? "!" : done ? "✓" : ""}</span>
              <span>
                {txt(i.en, i.es)}
                {flagged && (
                  <small>
                    {t.needsAttention} · {a!.flag}
                  </small>
                )}
              </span>
            </button>
            {!flagged && (
              <button type="button" className="ckc__flagbtn" onClick={() => onFlag(i.id)}>
                {t.problem}
              </button>
            )}
          </div>
        )
      })}
      {(s.photoRequired || s.items.length === 0) && (
        <>
          <button type="button" className={`ckc__photo${photo ? " has" : ""}`} onClick={() => input.current?.click()}>
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview blob
              <img src={photo} alt="" />
            ) : (
              <span className="cam" aria-hidden>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
              </span>
            )}
            <span>
              <b>
                {txt(s.en, s.es)} {s.photoRequired ? t.photoReq : t.photoOpt}
              </b>
              <br />
              <span className="ckc__dim" style={{ fontSize: 13 }}>
                {photo ? t.retake : hint || t.takePhoto}
              </span>
            </span>
          </button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              onPhoto(e.target.files?.[0])
              e.target.value = ""
            }}
          />
        </>
      )}
    </section>
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
            <span className="ckc__dim">{t.store}</span>
            <b>{receipt.store}</b>
          </div>
          <div>
            <span className="ckc__dim">{t.submitted}</span>
            <b>
              {day} · {receipt.at}
            </b>
          </div>
          <div>
            <span className="ckc__dim">{t.onTime}</span>
            <b className={receipt.late > 0 ? "ck-tone-warn" : "ck-tone-good"}>
              {receipt.late > 0 ? t.no(receipt.late) : t.yes(receipt.dueLabel)}
            </b>
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
