"use client"

import { useEffect } from "react"

/**
 * Last-resort boundary: only fires when the root layout itself throws, which
 * means no provider, font variable or stylesheet is guaranteed to have loaded.
 * Everything here is therefore inline and self-contained — no tokens, no
 * imported CSS — but still cream-and-ink rather than a white browser page.
 */
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
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#fbf6ee",
          color: "#1a1613",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <main
          style={{
            maxWidth: "52ch",
            border: "1px solid #c9beaf",
            borderRadius: "2px",
            background: "rgba(255, 253, 247, 0.72)",
            padding: "24px 26px 26px",
          }}
        >
          <p
            style={{
              margin: "0 0 10px",
              fontSize: "10px",
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: "#6b625a",
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
              fontFamily: "Georgia, 'Iowan Old Style', serif",
            }}
          >
            The dashboard could not start
          </h1>
          <p
            style={{
              margin: "0 0 20px",
              fontSize: "13px",
              lineHeight: 1.6,
              color: "#6b625a",
            }}
          >
            This is a failure in the application shell, not in one report. Retry
            below; if it persists, the deployment or the database connection is
            likely down.
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
              borderRadius: 0,
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
