// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { RevealOrder, Section } from "@/components/counter"
import { ready, type SectionData } from "@/lib/counter/section-data"

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe("Section inside RevealOrder", () => {
  it("paints a quick section only once the slow one above it has arrived", async () => {
    const slow = deferred<SectionData<string>>()
    const quick = deferred<SectionData<string>>()
    await act(async () => {
      render(
        <RevealOrder>
          <Section title="Hero" data={slow.promise}>{(v) => <p>{v}</p>}</Section>
          <Section title="Channels" data={quick.promise}>{(v) => <p>{v}</p>}</Section>
        </RevealOrder>,
      )
    })

    await act(async () => quick.resolve(ready("channels-body")))
    expect(screen.queryByText("channels-body")).toBeNull()

    await act(async () => slow.resolve(ready("hero-body")))
    expect(screen.getByText("hero-body")).toBeTruthy()
    expect(screen.getByText("channels-body")).toBeTruthy()
  })
})
