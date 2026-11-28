import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (f: string) => readFileSync(join(process.cwd(), "tizen-app", f), "utf8")

/** Samsung's packaging rules, so a rename can't quietly make a package no TV installs. */
describe("ChrisnEddysTV package", () => {
  const config = read("config.xml")
  it("has a 10-character package id that starts the app id", () => {
    const pkg = /package="([^"]+)"/.exec(config)![1]
    expect(pkg).toMatch(/^[A-Za-z0-9]{10}$/)
    expect(/application id="([^"]+)"/.exec(config)![1]).toBe(`${pkg}.ChrisnEddysTV`)
  })
  it("names the TV screen size, and only the dashboard's address and the push line's", () => {
    expect(config).toContain('name="http://tizen.org/feature/screen.size.normal.1080.1920"')
    expect(config.match(/<access [^>]*>/g)).toEqual([
      '<access origin="https://dashboard.chrisneddys.com" subdomains="false"/>',
      '<access origin="https://realtime.ably.io" subdomains="true"/>',
    ])
  })
  it("has a version the build can read", () => {
    // The same pattern as build.sh's sed.
    expect(read("build.sh")).toContain(String.raw`s/.*[^_]version="\([0-9.]*\)" viewmodes.*/\1/p`)
    expect(/[^_]version="([0-9.]*)" viewmodes/.exec(config)![1]).toMatch(/^\d+\.\d+\.\d+$/)
  })
  it("the build writes the install file a business display reads", () => {
    const sh = read("build.sh")
    expect(sh).toContain("<webtype>tizen</webtype>")
    expect(sh).toContain("usb/SSSP")
  })
})
