"use client"

import { createContext, useContext, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { PageHead, Section, useCounterTransition, usePageChrome } from "@/components/counter"
import {
  Answer,
  BigNumber,
  Button,
  ButtonRow,
  Card,
  PageTabs,
  Status,
  useAct,
  type StatusTone,
} from "@/components/counter/ui"
import { useUrlParam } from "@/components/counter/keep/use-url-param"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { MediaRow, PlaylistRow, ScreenRow, ScreensData, ScreensSections } from "@/lib/counter/adapters/screens"
import {
  claimScreen,
  createPlaylist,
  deleteMedia,
  deletePlaylist,
  removeScreen,
  savePlaylist,
  updateScreen,
} from "@/lib/counter/actions/screens"
import { SLIDE_SECONDS_DEFAULT } from "@/lib/screens/limits"
import { prepareUpload } from "./prepare-upload"

/**
 * Screens: the TVs in every store, what each plays, and the images.
 *
 * Each store is a workspace (`?store=`); "All stores" shows them side by
 * side. Three tabs: Screens, Playlists, Images. One client for the desk and
 * the phone; rows become stacked cards from the container's own width
 * (`src/styles/counter-screens.css`).
 */
export function ScreensClient({ sections }: { sections: SectionSources<ScreensSections> }) {
  usePageChrome({ leaf: "Screens" })
  const { pending } = useCounterTransition()
  // Held above the section, so the upload's outcome survives the refresh that shows the new images.
  const upload = useState<string | null>(null)
  return (
    <UploadNote.Provider value={upload}>
      <PageHead title="Screens" sub="TV menu boards in every store" />
      <Section bare title="Screens" data={sections.screens} pending={pending}>
        {(d) => <Body data={d} />}
      </Section>
    </UploadNote.Provider>
  )
}

const UploadNote = createContext<[string | null, (s: string | null) => void]>([null, () => {}])

const ALL = "all"

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

function storeName(data: ScreensData, id: string | null) {
  if (!id) return "All stores"
  return data.stores.find((s) => s.id === id)?.name ?? "Another store"
}

const STATE: Record<ScreenRow["state"], { tone: StatusTone; words: string }> = {
  on: { tone: "good", words: "On" },
  off: { tone: "bad", words: "Off" },
  waiting: { tone: "wait", words: "Waiting for the TV" },
}

function seenWords(iso: string | null): string {
  if (!iso) return "not heard from yet"
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return "seen just now"
  if (mins < 60) return `seen ${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `seen ${hrs} h ago`
  return `seen ${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
}

function Body({ data }: { data: ScreensData }) {
  const [storeParam, setStore] = useUrlParam("store", ALL)
  const view = data.stores.some((s) => s.id === storeParam) ? storeParam : ALL
  const [pairing, setPairing] = useState(false)

  const inView = (storeId: string | null) => view === ALL || storeId === null || storeId === view
  const screens = data.screens.filter((s) => view === ALL || s.storeId === view)
  const on = screens.filter((s) => s.state === "on").length
  const off = screens.filter((s) => s.state === "off")
  const where = view === ALL ? "" : ` in ${storeName(data, view)}`
  const empty = data.stores.filter((st) => (view === ALL || st.id === view) && !data.screens.some((s) => s.storeId === st.id))

  let sentence: string
  if (screens.length === 0) sentence = `No screens are paired${where} yet. Turn on the TV, open the Screens app and type the code it shows.`
  else if (off.length === 0 && on === screens.length) sentence = screens.length === 1 ? `The one screen${where} is on.` : `All ${screens.length} screens${where} are on.`
  else if (off.length === 0) sentence = `${on} of ${plural(screens.length, "screen")}${where} ${on === 1 ? "is" : "are"} on. The rest haven't checked in since pairing.`
  else sentence = `${off.map((s) => s.name).slice(0, 2).join(" and ")}${off.length > 2 ? ` and ${off.length - 2} more` : ""} ${off.length === 1 ? "is" : "are"} off. Check the TV is on and online.`
  if (screens.length > 0 && empty.length > 0 && view === ALL) sentence += ` ${empty.map((s) => s.name).join(" and ")} ${empty.length === 1 ? "has" : "have"} no screens yet.`

  return (
    <div className="sc">
      <div className="sc-ws" role="group" aria-label="Store">
        {data.stores.length > 1 ? (
          <button type="button" className="sc-chip" aria-pressed={view === ALL} onClick={() => setStore(ALL)}>
            All {data.stores.length} stores
          </button>
        ) : null}
        {data.stores.map((s) => (
          <button key={s.id} type="button" className="sc-chip" aria-pressed={view === s.id} onClick={() => setStore(s.id)}>
            {s.name}
          </button>
        ))}
      </div>

      <Answer>{sentence}</Answer>
      <div className="sc-head">
        {screens.length ? <BigNumber label="Screens on" value={`${on} of ${screens.length}`} /> : <span />}
        <Button variant="primary" onClick={() => setPairing((p) => !p)} aria-expanded={pairing}>
          {pairing ? "Close" : "Pair a screen"}
        </Button>
      </div>

      {pairing ? <PairForm data={data} view={view} onDone={() => setPairing(false)} /> : null}

      <PageTabs
        label="Screens views"
        tabs={[
          { key: "screens", label: `Screens · ${screens.length}`, content: <ScreensTab data={data} view={view} onPair={() => setPairing(true)} /> },
          {
            key: "playlists",
            label: `Playlists · ${data.playlists.filter((p) => inView(p.storeId)).length}`,
            content: <PlaylistsTab data={data} view={view} />,
          },
          {
            key: "images",
            label: `Images · ${data.media.filter((m) => inView(m.storeId)).length}`,
            content: <ImagesTab data={data} view={view} />,
          },
        ]}
      />
    </div>
  )
}

/* ---------------------------------------------------------------- pairing */

function playlistsFor(data: ScreensData, storeId: string): PlaylistRow[] {
  return data.playlists.filter((p) => p.storeId === null || p.storeId === storeId)
}

function PairForm({ data, view, onDone }: { data: ScreensData; view: string; onDone: () => void }) {
  const [code, setCode] = useState("")
  const [storeId, setStoreId] = useState(view !== ALL ? view : (data.stores[0]?.id ?? ""))
  const [name, setName] = useState("")
  const options = playlistsFor(data, storeId)
  const [playlistId, setPlaylistId] = useState<string>(options[0]?.id ?? "")
  const { act, stateOf, error } = useAct()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    act(
      "pair",
      () => claimScreen({ code, storeId, name, playlistId: playlistId || null }),
      { done: "Paired", onDone: () => setTimeout(onDone, 900) },
    )
  }

  return (
    <Card className="sc-form" caption="Pair a screen">
      <form onSubmit={submit} className="sc-fields">
        <p className="sc-note">On the TV, open the Screens app. It shows a 6-digit code. Type it here.</p>
        <label className="sc-field">
          <span>Code on the TV</span>
          <input
            className="sc-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="482 913"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={9}
            required
          />
        </label>
        <label className="sc-field">
          <span>Store</span>
          <select
            value={storeId}
            onChange={(e) => {
              setStoreId(e.target.value)
              setPlaylistId(playlistsFor(data, e.target.value)[0]?.id ?? "")
            }}
          >
            {data.stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="sc-field">
          <span>Screen name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Left screen" maxLength={60} required />
        </label>
        <label className="sc-field">
          <span>Show</span>
          <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
            <option value="">Nothing yet</option>
            {playlistsFor(data, storeId).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        {error ? <p className="sc-err" role="alert">{error === "network" ? "Couldn't reach the server. Try again." : error}</p> : null}
        <ButtonRow>
          <Button type="submit" variant="primary" state={stateOf("pair")} doneLabel="Paired">Pair screen</Button>
          <Button variant="quiet" onClick={onDone}>Cancel</Button>
        </ButtonRow>
      </form>
    </Card>
  )
}

/* ---------------------------------------------------------------- screens */

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  return (
    <span className="sc-thumb">
      {src ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" />
      ) : (
        <span className="sc-thumb__none">Nothing yet</span>
      )}
    </span>
  )
}

function ScreensTab({ data, view, onPair }: { data: ScreensData; view: string; onPair: () => void }) {
  const stores = data.stores.filter((s) => view === ALL || s.id === view)
  return (
    <div className="sc-stack">
      {stores.map((st) => {
        const rows = data.screens.filter((s) => s.storeId === st.id)
        const on = rows.filter((s) => s.state === "on").length
        return (
          <Card key={st.id} as="section" className="sc-store" label={st.name}>
            <div className="sc-store__h">
              <b>{st.name}</b>
              <span>{rows.length ? `${plural(rows.length, "screen")} · ${on === rows.length ? "all on" : `${on} on`}` : "no screens yet"}</span>
            </div>
            {rows.length === 0 ? (
              <div className="sc-empty">
                <span>Turn on the TV, open the Screens app, and type the code it shows.</span>
                <Button onClick={onPair}>Pair a screen</Button>
              </div>
            ) : (
              <ul className="sc-rows">
                {rows.map((s) => (
                  <ScreenItem key={s.id} s={s} data={data} />
                ))}
              </ul>
            )}
          </Card>
        )
      })}
    </div>
  )
}

function ScreenItem({ s, data }: { s: ScreenRow; data: ScreensData }) {
  const [editing, setEditing] = useState(false)
  const st = STATE[s.state]
  return (
    <li className="sc-row">
      <Thumb src={s.thumb} alt={s.playlistName ?? "Nothing playing"} />
      <div className="sc-row__name">
        <b>{s.name}</b>
        <span className="sc-mono">{s.device ?? "TV"}</span>
      </div>
      <div className="sc-row__plays">
        <span>{s.playlistName ?? "Nothing to show yet"}</span>
        <span className="sc-sub">{s.playlistName ? (s.slides === 1 ? "1 image, always on" : plural(s.slides, "image")) : "Pick a playlist"}</span>
      </div>
      <div className="sc-row__state">
        <Status tone={st.tone} plain>{st.words}</Status>
        <span className="sc-sub">{seenWords(s.lastSeenAt)}</span>
      </div>
      <Button variant="quiet" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
        {editing ? "Close" : "Edit"}
      </Button>
      {editing ? <ScreenEdit s={s} data={data} onClose={() => setEditing(false)} /> : null}
    </li>
  )
}

function ScreenEdit({ s, data, onClose }: { s: ScreenRow; data: ScreensData; onClose: () => void }) {
  const [name, setName] = useState(s.name)
  const [storeId, setStoreId] = useState(s.storeId)
  const [playlistId, setPlaylistId] = useState(s.playlistId ?? "")
  const [confirm, setConfirm] = useState(false)
  const { act, stateOf, error, busy } = useAct()
  const options = playlistsFor(data, storeId)

  return (
    <div className="sc-edit">
      <div className="sc-fields">
        <label className="sc-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        <label className="sc-field">
          <span>Store</span>
          <select
            value={storeId}
            onChange={(e) => {
              setStoreId(e.target.value)
              if (!playlistsFor(data, e.target.value).some((p) => p.id === playlistId)) setPlaylistId("")
            }}
          >
            {data.stores.map((st) => (
              <option key={st.id} value={st.id}>{st.name}</option>
            ))}
          </select>
        </label>
        <label className="sc-field">
          <span>Show</span>
          <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
            <option value="">Nothing</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="sc-err" role="alert">{error === "network" ? "Couldn't reach the server. Try again." : error}</p> : null}
      <ButtonRow>
        <Button
          variant="primary"
          disabled={busy}
          state={stateOf("save")}
          doneLabel="Saved"
          onClick={() => act("save", () => updateScreen({ screenId: s.id, name, storeId, playlistId: playlistId || null }), { done: "Saved", onDone: () => setTimeout(onClose, 700) })}
        >
          Save
        </Button>
        {confirm ? (
          <Button state={stateOf("remove")} disabled={busy} onClick={() => act("remove", () => removeScreen(s.id))}>
            Yes, unpair {s.name}
          </Button>
        ) : (
          <Button variant="quiet" onClick={() => setConfirm(true)}>Unpair</Button>
        )}
      </ButtonRow>
      {confirm ? <p className="sc-sub">The TV goes back to showing a code. Pair it again any time.</p> : null}
    </div>
  )
}

/* -------------------------------------------------------------- playlists */

function mediaMap(data: ScreensData) {
  return new Map(data.media.map((m) => [m.id, m]))
}

function PlaylistsTab({ data, view }: { data: ScreensData; view: string }) {
  const lists = data.playlists.filter((p) => view === ALL || p.storeId === null || p.storeId === view)
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <div className="sc-stack">
      {lists.length === 0 ? <p className="sc-note">No playlists yet. A playlist is the images a screen shows, in order.</p> : null}
      {lists.map((p) => (
        <PlaylistCard key={p.id} p={p} data={data} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} />
      ))}
      {adding ? (
        <NewPlaylist data={data} view={view} onDone={(id) => { setAdding(false); if (id) setOpenId(id) }} />
      ) : (
        <ButtonRow>
          <Button onClick={() => setAdding(true)}>New playlist</Button>
        </ButtonRow>
      )}
    </div>
  )
}

function PlaylistCard({ p, data, open, onToggle }: { p: PlaylistRow; data: ScreensData; open: boolean; onToggle: () => void }) {
  const media = mediaMap(data)
  const shownOn = data.screens.filter((s) => s.playlistId === p.id)
  return (
    <Card as="section" className="sc-pl" label={p.name}>
      <div className="sc-pl__h">
        <div>
          <b>{p.name}</b>
          <span className="sc-sub">
            {storeName(data, p.storeId)} · {shownOn.length ? `playing on ${shownOn.map((s) => s.name).join(", ")}` : "not on any screen"}
          </span>
        </div>
        <Button variant="quiet" onClick={onToggle} aria-expanded={open}>{open ? "Close" : "Edit"}</Button>
      </div>
      {open ? (
        <PlaylistEdit p={p} data={data} onClose={onToggle} />
      ) : p.slides.length === 0 ? (
        <p className="sc-note">No images yet. Tap Edit to add some.</p>
      ) : (
        <ol className="sc-strip">
          {p.slides.map((s, i) => {
            const m = media.get(s.mediaId)
            return (
              <li key={`${s.mediaId}-${i}`} className="sc-slide">
                <Thumb src={m?.url ?? null} alt={m?.name ?? "Image"} />
                <span className="sc-slide__t">
                  <span>{m?.name ?? "Image"}</span>
                  <span className="sc-num">{p.slides.length === 1 ? "always" : `${s.seconds} s`}</span>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}

function usableMedia(data: ScreensData, storeId: string | null): MediaRow[] {
  return data.media.filter((m) => m.storeId === null || (storeId !== null && m.storeId === storeId))
}

function PlaylistEdit({ p, data, onClose }: { p: PlaylistRow; data: ScreensData; onClose: () => void }) {
  const media = mediaMap(data)
  const [name, setName] = useState(p.name)
  const [slides, setSlides] = useState(p.slides)
  const [confirm, setConfirm] = useState(false)
  const { act, stateOf, error, busy } = useAct()
  const pool = usableMedia(data, p.storeId)

  const move = (i: number, by: number) =>
    setSlides((xs) => {
      const j = i + by
      if (j < 0 || j >= xs.length) return xs
      const next = [...xs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  return (
    <div className="sc-edit">
      <label className="sc-field">
        <span>Playlist name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </label>
      {slides.length === 0 ? <p className="sc-note">Add images from the list below.</p> : null}
      <ol className="sc-edit__slides">
        {slides.map((s, i) => {
          const m = media.get(s.mediaId)
          return (
            <li key={`${s.mediaId}-${i}`} className="sc-eslide">
              <Thumb src={m?.url ?? null} alt={m?.name ?? "Image"} />
              <span className="sc-eslide__n">{m?.name ?? "Image"}</span>
              <label className="sc-secs">
                <input
                  type="number"
                  min={3}
                  max={600}
                  value={s.seconds}
                  aria-label={`Seconds for ${m?.name ?? "image"}`}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setSlides((xs) => xs.map((x, k) => (k === i ? { ...x, seconds: v } : x)))
                  }}
                />
                <span>s</span>
              </label>
              <span className="sc-eslide__b">
                <button type="button" className="sc-icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button type="button" className="sc-icon" onClick={() => move(i, 1)} disabled={i === slides.length - 1} aria-label="Move down">↓</button>
                <button type="button" className="sc-icon" onClick={() => setSlides((xs) => xs.filter((_, k) => k !== i))} aria-label="Remove">✕</button>
              </span>
            </li>
          )
        })}
      </ol>
      {slides.length === 1 ? <p className="sc-sub">One image stays up all the time. Seconds count only when there are two or more.</p> : null}
      <p className="sc-cap">Add an image</p>
      {pool.length === 0 ? (
        <p className="sc-note">No images for {storeName(data, p.storeId)} yet. Upload some on the Images tab.</p>
      ) : (
        <div className="sc-pick">
          {pool.map((m) => (
            <button
              type="button"
              key={m.id}
              className="sc-pick__b"
              onClick={() => setSlides((xs) => [...xs, { mediaId: m.id, seconds: SLIDE_SECONDS_DEFAULT }])}
            >
              <Thumb src={m.url} alt="" />
              <span>+ {m.name}</span>
            </button>
          ))}
        </div>
      )}
      {error ? <p className="sc-err" role="alert">{error === "network" ? "Couldn't reach the server. Try again." : error}</p> : null}
      <ButtonRow>
        <Button
          variant="primary"
          disabled={busy}
          state={stateOf("save")}
          doneLabel="Saved"
          onClick={() => act("save", () => savePlaylist({ playlistId: p.id, name, slides }), { done: "Saved", onDone: () => setTimeout(onClose, 700) })}
        >
          Save playlist
        </Button>
        {confirm ? (
          <Button disabled={busy} state={stateOf("delete")} onClick={() => act("delete", () => deletePlaylist(p.id))}>
            Yes, delete {p.name}
          </Button>
        ) : (
          <Button variant="quiet" onClick={() => setConfirm(true)}>Delete playlist</Button>
        )}
      </ButtonRow>
      {confirm && p.screens > 0 ? <p className="sc-sub">{plural(p.screens, "screen")} playing it will show nothing until you pick another playlist.</p> : null}
    </div>
  )
}

function NewPlaylist({ data, view, onDone }: { data: ScreensData; view: string; onDone: (id?: string) => void }) {
  const [name, setName] = useState("")
  const [storeId, setStoreId] = useState(view === ALL ? "" : view)
  const { act, stateOf, error } = useAct()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    let made: string | undefined
    act(
      "make",
      async () => {
        const r = await createPlaylist({ name, storeId: storeId || null })
        if (r.ok) made = r.id
        return r
      },
      { onDone: () => onDone(made) },
    )
  }
  return (
    <Card className="sc-form" caption="New playlist">
      <form onSubmit={submit} className="sc-fields">
        <label className="sc-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Combos board" maxLength={60} required />
        </label>
        <label className="sc-field">
          <span>For</span>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">All stores</option>
            {data.stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name} only</option>
            ))}
          </select>
        </label>
        {error ? <p className="sc-err" role="alert">{error === "network" ? "Couldn't reach the server. Try again." : error}</p> : null}
        <ButtonRow>
          <Button type="submit" variant="primary" state={stateOf("make")}>Make playlist</Button>
          <Button variant="quiet" onClick={() => onDone()}>Cancel</Button>
        </ButtonRow>
      </form>
    </Card>
  )
}

/* ----------------------------------------------------------------- images */

const IMAGES_SHOWN = 12

function ImagesTab({ data, view }: { data: ScreensData; view: string }) {
  const router = useRouter()
  const list = data.media.filter((m) => view === ALL || m.storeId === null || m.storeId === view)
  const [all, setAll] = useState(false)
  const [storeId, setStoreId] = useState(view === ALL ? "" : view)
  const [status, setStatus] = useContext(UploadNote)
  const [busy, setBusy] = useState(false)
  const shown = all ? list : list.slice(0, IMAGES_SHOWN)

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    let done = 0
    const failed: string[] = []
    for (const file of Array.from(files)) {
      setStatus(`Uploading ${done + 1} of ${files.length}…`)
      try {
        const prepared = await prepareUpload(file)
        const form = new FormData()
        form.set("file", prepared.blob, prepared.filename)
        form.set("name", file.name.replace(/\.[^.]+$/, ""))
        form.set("storeId", storeId)
        form.set("width", String(prepared.width))
        form.set("height", String(prepared.height))
        const res = await fetch("/api/screens/media", { method: "POST", body: form })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          failed.push(`${file.name}: ${body.error ?? "did not upload"}`)
        } else done++
      } catch (err) {
        failed.push(`${file.name}: ${err instanceof Error ? err.message : "did not upload"}`)
      }
    }
    setBusy(false)
    setStatus(failed.length ? `${plural(done, "image")} uploaded. ${failed.join(". ")}` : `${plural(done, "image")} uploaded.`)
    router.refresh()
  }

  return (
    <div className="sc-stack">
      <Card className="sc-drop">
        <label
          className="sc-drop__in"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void upload(e.dataTransfer.files)
          }}
        >
          <b>Drop images here, or tap to choose</b>
          <span className="sc-sub">JPG, PNG or WebP. Big photos are shrunk to fit a 4K screen (3840 × 2160).</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={(e) => void upload(e.target.files)} />
        </label>
        <label className="sc-field sc-field--inline">
          <span>Use in</span>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={busy}>
            <option value="">All stores</option>
            {data.stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name} only</option>
            ))}
          </select>
        </label>
        {status ? <p className="sc-sub" role="status">{status}</p> : null}
      </Card>
      {list.length === 0 ? <p className="sc-note">No images yet.</p> : null}
      <ul className="sc-grid">
        {shown.map((m) => (
          <ImageItem key={m.id} m={m} data={data} />
        ))}
      </ul>
      {list.length > IMAGES_SHOWN ? (
        <ButtonRow>
          <Button variant="quiet" onClick={() => setAll((a) => !a)}>{all ? "Show fewer" : `Show all ${list.length}`}</Button>
        </ButtonRow>
      ) : null}
    </div>
  )
}

function ImageItem({ m, data }: { m: MediaRow; data: ScreensData }) {
  const [confirm, setConfirm] = useState(false)
  const { act, stateOf, error } = useAct()
  return (
    <li className="sc-img">
      <Thumb src={m.url} alt={m.name} />
      <span className="sc-img__n">{m.name}</span>
      <span className="sc-sub">
        {storeName(data, m.storeId)} · {m.playlists ? `in ${plural(m.playlists, "playlist")}` : "not in a playlist"}
        {m.width && m.height ? ` · ${m.width} × ${m.height}` : ""}
      </span>
      {confirm ? (
        <Button state={stateOf("del")} onClick={() => act("del", () => deleteMedia(m.id))}>Yes, delete</Button>
      ) : (
        <Button variant="quiet" onClick={() => setConfirm(true)}>Delete</Button>
      )}
      {error ? <span className="sc-err" role="alert">{error === "network" ? "Couldn't reach the server." : error}</span> : null}
    </li>
  )
}
