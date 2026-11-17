/**
 * Counter's colours for email.
 *
 * Mail clients understand neither `oklch()` nor CSS variables, so an email
 * cannot read `src/styles/counter.css`. These are the same tokens (the light
 * theme, which is what mail renders on), converted to hex here once.
 * `tests/lib/counter/email-colors.test.ts` fails if a value drifts from
 * counter.css, so a Counter 2 colour change reaches the emails too.
 */

/** The light-theme value of each `--ct-*` token an email uses. */
export const EMAIL_TOKENS = {
  ink: "oklch(24% 0.014 40)",
  ink2: "oklch(47% 0.012 45)",
  ink3: "oklch(52.5% 0.011 50)",
  surface: "oklch(98.4% 0.004 66)",
  paper: "oklch(96.2% 0.006 60)",
  sunk: "oklch(92.6% 0.009 55)",
  line: "oklch(89.5% 0.009 58)",
  lineStrong: "oklch(82.5% 0.013 55)",
  warn: "oklch(53% 0.115 70)",
  bad: "oklch(50% 0.175 25)",
  badWash: "oklch(94.5% 0.030 25)",
  brandInk: "oklch(20.3% 0.01 67)",
  brandLine: "oklch(88.4% 0.039 89)",
  brandRed: "oklch(60.2% 0.218 29)",
  brandCream: "oklch(96.1% 0.055 93)",
  brandYellow: "oklch(81.8% 0.157 82)",
} as const

/** The `--ct-*` token each key mirrors, for the drift test. */
export const EMAIL_TOKEN_SOURCE: Record<keyof typeof EMAIL_TOKENS, string> = {
  ink: "--ct-ink",
  ink2: "--ct-ink-2",
  ink3: "--ct-ink-3",
  surface: "--ct-surface",
  paper: "--ct-paper",
  sunk: "--ct-sunk",
  line: "--ct-line",
  lineStrong: "--ct-line-strong",
  warn: "--ct-warn",
  bad: "--ct-bad",
  badWash: "--ct-bad-wash",
  brandInk: "--ct-brand-ink",
  brandLine: "--ct-brand-line",
  brandRed: "--ct-brand-red",
  brandCream: "--ct-brand-cream",
  brandYellow: "--ct-brand-yellow",
}

/** `oklch(L% C H)` to `#rrggbb` (sRGB, clipped to gamut). */
export function oklchToHex(value: string): string {
  const m = value.match(/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/)
  if (!m) throw new Error(`Not an oklch() colour: ${value}`)
  const L = Number(m[1]) / 100
  const C = Number(m[2])
  const h = (Number(m[3]) * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ]
  return (
    "#" +
    lin
      .map((x) => {
        const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(x, 0) ** (1 / 2.4) - 0.055
        return Math.round(Math.min(1, Math.max(0, v)) * 255)
          .toString(16)
          .padStart(2, "0")
      })
      .join("")
  )
}

/** The hex to write into an email's inline styles. */
export const EMAIL = Object.fromEntries(
  Object.entries(EMAIL_TOKENS).map(([k, v]) => [k, oklchToHex(v)]),
) as Record<keyof typeof EMAIL_TOKENS, string>
