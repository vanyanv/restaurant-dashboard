"use client"

import { useEffect } from "react"

/**
 * Last-resort boundary: only fires when the root layout itself throws, which
 * means no provider, font variable or stylesheet is guaranteed to have loaded.
 * Everything here is therefore inline and self-contained — no tokens, no
 * imported CSS — but still cream-and-ink rather than a white browser page.
 */
/*
 * The palette, inline and duplicated from `counter.css` on purpose: this
 * boundary fires when the ROOT LAYOUT threw, so no stylesheet, font variable
 * or theme provider is guaranteed to have loaded and a `var(--ct-*)` would
 * resolve to nothing. Values are the light and dark halves of `--ct-paper`,
 * `--ct-surface`, `--ct-ink`, `--ct-ink-2`, `--ct-line` and `--ct-accent`.
 *
 * A media query rather than the `data-theme` stamp: that stamp is written by
 * `themeNoFlashScript` in the root layout, which is exactly what did not run.
 * `prefers-color-scheme` is the only signal still available here.
 */
const THEME_CSS = `
  .ge-root { background:#fbf6ee; color:#1a1613; }
  .ge-card { border-color:#c9beaf; background:rgba(255,253,247,.72); }
  .ge-eyebrow, .ge-body { color:#6b625a; }
  @media (prefers-color-scheme: dark) {
    .ge-root { background:#191614; color:#ece7e1; }
    .ge-card { border-color:#3a342e; background:rgba(38,34,30,.72); }
    .ge-eyebrow, .ge-body { color:#a8a099; }
  }
`

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      </head>
      <body
        className="ge-root"
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <main
          className="ge-card"
          style={{
            maxWidth: "52ch",
            borderWidth: "1px",
            borderStyle: "solid",
            borderRadius: "8px",
            padding: "24px 26px 26px",
          }}
        >
          <p
            className="ge-eyebrow"
            style={{
              margin: "0 0 10px",
              fontSize: "10px",
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            Press stopped
          </p>
          <h1
            style={{
              margin: "0 0 12px",
              fontSize: "26px",
              fontWeight: 500,
              lineHeight: 1.2,
              fontFamily: "inherit",
            }}
          >
            The dashboard could not start
          </h1>
          <p
            className="ge-body"
            style={{ margin: "0 0 20px", fontSize: "13px", lineHeight: 1.6 }}
          >
            This is a failure in the application shell itself — every page
            boundary below it has already been given a chance. Retry below; if
            it persists, the deployment or the database connection is likely
            down.
            {error.digest ? (
              <>
                {" "}
                Reference{" "}
                <span
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  {error.digest}
                </span>
                .
              </>
            ) : null}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              appearance: "none",
              border: "1px solid #7c1515",
              borderRadius: "5px",
              background: "#dc2626",
              color: "#fbf6ee",
              padding: "11px 20px",
              fontSize: "10.5px",
              fontWeight: 600,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </main>
      </body>
    </html>
  )
}
