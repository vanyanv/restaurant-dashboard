import { test, expect, type Page } from "@playwright/test"
import { CREW_CODE, CREW_NAME, CREW_PIN, clearCrewMarks, setUpCrewStore } from "./crew-db"

/*
 * The crew checks page, end to end, as crew use it: a phone, no account, a
 * four-digit PIN, and a store back room where the signal comes and goes.
 *
 * Runs in practice mode (see crew-db.ts) so a check is open at any hour.
 * Photo uploads are answered by a stub: the e2e server has no photo storage,
 * and what is under test is the phone keeping and sending the photo, not the
 * bucket receiving it.
 */

let storeId = ""

test.beforeAll(async () => {
  ;({ storeId } = await setUpCrewStore())
})

test.beforeEach(async () => {
  await clearCrewMarks(storeId)
})

const plainTask = (page: Page) => page.locator('button.ckc__row:not(.cam)[aria-pressed="false"]').first()
const photoTask = (page: Page) => page.locator("button.ckc__row.cam").first()

async function signIn(page: Page, pin = CREW_PIN) {
  await page.goto(`/checks/${CREW_CODE}`)
  await page.locator('button.ckb__card[data-live="true"]').click()
  for (const d of pin) await page.getByRole("button", { name: d, exact: true }).click()
}

/** A real JPEG, drawn in the page, so the app's resize step has something to decode. */
async function jpeg(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas")
    c.width = 64
    c.height = 48
    const g = c.getContext("2d")!
    g.fillStyle = "#c33"
    g.fillRect(0, 0, 64, 48)
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.9))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let s = ""
    for (const x of bytes) s += String.fromCharCode(x)
    return btoa(s)
  })
  return Buffer.from(b64, "base64")
}

async function takePhoto(page: Page) {
  const task = photoTask(page)
  const file = await jpeg(page)
  const chooser = page.waitForEvent("filechooser")
  await task.click()
  await (await chooser).setFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: file })
  await page.getByRole("button", { name: "Looks good, mark done" }).click()
}

test("a wrong PIN is refused and the right one opens the list", async ({ page }) => {
  await signIn(page, "9137")
  await expect(page.getByRole("alert").filter({ hasText: "isn't set up" })).toBeVisible()
  await expect(page.getByText(`Hi ${CREW_NAME}`)).toHaveCount(0)
  // The keypad clears itself after a wrong PIN; the real one opens the list.
  await expect(page.locator(".ckc__dots.shake")).toHaveCount(0)
  await expect(page.getByRole("status")).toHaveAttribute("aria-label", "0 of 4 digits entered")
  for (const d of CREW_PIN) await page.getByRole("button", { name: d, exact: true }).click()
  await expect(page.getByText(`Hi ${CREW_NAME}`)).toBeVisible()
})

test("a tick is saved and still there after a reload", async ({ page }) => {
  await signIn(page)
  const task = plainTask(page)
  const text = (await task.innerText()).split("\n")[0]
  const saved = page.waitForResponse((r) => r.url().includes(`/api/checks/${CREW_CODE}/mark`) && r.ok())
  await task.click()
  await saved

  await signIn(page)
  await expect(page.locator("button.ckc__row", { hasText: text }).first()).toHaveAttribute("aria-pressed", "true")
})

test("a tick with no signal is kept on the phone and sent when the signal is back", async ({ page, context }) => {
  await signIn(page)
  await context.setOffline(true)
  await plainTask(page).click()
  await expect(page.getByText(/No signal\. 1 tick kept on this phone/)).toBeVisible()

  const sent = page.waitForResponse((r) => r.url().includes(`/api/checks/${CREW_CODE}/mark`) && r.ok())
  await context.setOffline(false)
  await sent
  await expect(page.getByText(/No signal\./)).toHaveCount(0)
})

test("a photo taken with no signal survives a reload and is sent with its tick", async ({ page, context }) => {
  // Routed requests skip the browser's offline switch, so the stub plays the
  // missing signal itself: no signal fails the upload like a dead network,
  // signal answers it the way the server would.
  let signal = false
  const photoPosts: string[] = []
  await page.route(`**/api/checks/${CREW_CODE}/mark`, async (route) => {
    const body = route.request().postDataBuffer()?.toString("latin1") ?? ""
    if (!body.includes('name="photo"')) return route.continue()
    if (!signal) return route.abort("internetdisconnected")
    photoPosts.push(body)
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
  })

  await signIn(page)
  await context.setOffline(true)
  await takePhoto(page)
  await expect(page.getByText(/No signal\. 1 tick kept on this phone/)).toBeVisible()
  expect(photoPosts).toHaveLength(0)

  // The phone drops the tab and crew open the link again. Uploads stay blocked
  // until the new page is up, so the photo it sends can only have come from the
  // phone's storage, not from the old page's memory.
  await context.setOffline(false)
  await signIn(page)
  await expect(page.getByText(/1 tick kept on this phone/)).toBeVisible()
  expect(photoPosts).toHaveLength(0)
  signal = true
  await page.evaluate(() => window.dispatchEvent(new Event("online")))

  await expect.poll(() => photoPosts.length, { timeout: 15_000 }).toBe(1)
  expect(photoPosts[0]).toContain("image/jpeg")
  await expect(page.getByText(/No signal\./)).toHaveCount(0)
})
