// @vitest-environment jsdom
/**
 * Opening a second thread on Ask must not fight the address bar.
 *
 * Both Ask pages write the engine's `conversationId` into `?c=` so a thread
 * the route has just named gets an address. Until 2026-11-24 the engine still
 * reported the OLD thread for a render after `?c=` moved, so the page put the
 * old id back, the engine followed, and the two swapped without end: over a
 * thousand navigations in five seconds. Found by a browser check; nothing else
 * could see it, because each half is right on its own.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { useEffect, useState } from "react"
import { act, render, screen, waitFor } from "@testing-library/react"

const sdk = vi.hoisted(() => ({
  fetch: null as null | ((input: string, init?: RequestInit) => Promise<Response>),
}))

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(o: { fetch: typeof sdk.fetch }) {
      sdk.fetch = o.fetch
    }
  },
}))
vi.mock("@ai-sdk/react", () => {
  const chat = { messages: [], sendMessage: vi.fn(), setMessages: vi.fn(), status: "ready", error: undefined, stop: vi.fn() }
  return { useChat: () => chat }
})

import { useAskDeferred } from "@/lib/counter/use-ask-deferred"

let replaced: string[] = []
let engine: ReturnType<typeof useAskDeferred>

/** The pages' own rule (`THE THREAD TAKES THE ADDRESS`), on a pretend URL. */
function Page({ start }: { start: string | null }) {
  const [url, setUrl] = useState(start)
  engine = useAskDeferred(url)
  const { conversationId, engineMount } = engine
  useEffect(() => {
    if (!conversationId || conversationId === url) return
    replaced.push(conversationId)
    // A real navigation lands later; a bound so a failure fails, not hangs.
    if (replaced.length < 20) setTimeout(() => setUrl(conversationId), 0)
  }, [conversationId, url])
  return (
    <>
      <output>{url ?? "none"}</output>
      {["a", "b", "none"].map((id) => (
        <button key={id} onClick={() => setUrl(id === "none" ? null : id)}>
          open {id}
        </button>
      ))}
      {engineMount}
    </>
  )
}

// Several rounds: `act` flushes on the way out, so each timer a render starts
// (the named thread, then the navigation) needs a round of its own.
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(() => new Promise<void>((r) => setTimeout(r, 10)))
}
const url = () => screen.getByRole("status").textContent
const open = async (id: string) => {
  await act(async () => screen.getByText(`open ${id}`).click())
  await settle()
}

async function mount(start: string | null) {
  sdk.fetch = null
  render(<Page start={start} />)
  await waitFor(() => expect(sdk.fetch).not.toBeNull())
  await settle()
}

const reply = (id: string) =>
  vi.stubGlobal("fetch", async () => new Response("", { headers: { "x-conversation-id": id } }))

describe("Ask: the thread and the address", () => {
  beforeEach(() => {
    replaced = []
    vi.unstubAllGlobals()
  })

  it("opening another thread stays on it", async () => {
    await mount("a")
    await open("b")
    expect(url()).toBe("b")
    expect(replaced).toEqual([])
    await open("a")
    expect(url()).toBe("a")
    expect(engine.conversationId).toBe("a")
    expect(replaced).toEqual([])
  })

  it("leaving every thread stays left", async () => {
    await mount("a")
    await open("none")
    expect(url()).toBe("none")
    expect(engine.conversationId).toBeNull()
    expect(replaced).toEqual([])
  })

  it("a thread the route just named still takes the address, once", async () => {
    await mount(null)
    reply("new")
    await act(async () => void (await sdk.fetch!("/api/chat")))
    await settle()
    expect(url()).toBe("new")
    expect(replaced).toEqual(["new"])
    await open("b")
    expect(url()).toBe("b")
    expect(replaced).toEqual(["new"])
  })

  it("an answer that lands after the reader moved on does not pull them back", async () => {
    await mount("a")
    let land!: (r: Response) => void
    vi.stubGlobal("fetch", () => new Promise<Response>((r) => (land = r)))
    const sent = sdk.fetch!("/api/chat")
    await open("b")
    land(new Response("", { headers: { "x-conversation-id": "a" } }))
    await sent
    await settle()
    expect(url()).toBe("b")
    expect(engine.conversationId).toBe("b")
    expect(replaced).toEqual([])
  })

  it("a refusal that lands after the reader moved on does not close their thread", async () => {
    await mount("a")
    let land!: (r: Response) => void
    vi.stubGlobal("fetch", () => new Promise<Response>((r) => (land = r)))
    const sent = sdk.fetch!("/api/chat")
    await open("b")
    land(new Response("", { status: 404 }))
    await sent
    await settle()
    expect(engine.conversationId).toBe("b")
  })
})
