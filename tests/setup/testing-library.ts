// Global vitest setup. `@testing-library/react`'s auto-cleanup only fires when
// it can detect a global `afterEach` (vitest's `test.globals` is off in this repo,
// since 1652 existing tests import `describe`/`it`/etc. explicitly and switching
// the default was out of scope for one new test file). So cleanup is wired
// explicitly here instead. Safe for the ~1650 tests running under the `node`
// environment too — `cleanup()` is a no-op when nothing was ever mounted with
// `@testing-library/react`, which node-environment tests never do.
import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

afterEach(() => {
  cleanup()
})
