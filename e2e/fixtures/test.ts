import { test as base, expect, type Page } from "@playwright/test"

type Fixtures = {
  consoleErrors: string[]
}

export const test = base.extend<Fixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text()
        if (isIgnorableConsoleError(text)) return
        errors.push(text)
      }
    })
    page.on("pageerror", (err) => {
      errors.push(`pageerror: ${err.message}`)
    })
    await use(errors)
  },
})

export { expect, type Page }

function isIgnorableConsoleError(text: string): boolean {
  return (
    text.includes("Failed to load resource") ||
    text.includes("favicon") ||
    text.includes("Download the React DevTools") ||
    text.includes("[Fast Refresh]") ||
    text.includes("manifest.webmanifest")
  )
}
