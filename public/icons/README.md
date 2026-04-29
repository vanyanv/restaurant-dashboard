# Editorial home-screen icons

These three PNGs are referenced from `/manifest.webmanifest` and the mobile
`<head>` (`apple-touch-icon-180.png`). Until they are produced, "Add to
Home Screen" on iOS will fall back to a screenshot of the page.

Required files (all square, all editorial — cream paper, hairline-bold
frame, "C N" Fraunces-italic monogram, single red proofmark dot at
upper-right):

- `apple-touch-icon-180.png` — 180×180, opaque, no transparency.
- `icon-192.png` — 192×192.
- `icon-512.png` — 512×512.
- `icon-maskable-512.png` — 512×512 with the safe area inset to 80%
  per the maskable spec.

Source colors:
- background: `#fbf6ee`
- frame stroke: `#c9beaf`
- monogram fill: `#1a1613`
- proofmark dot: `#dc2626`

Produce with whatever editorial tooling fits the workflow. When the
files land here, the manifest + apple-touch-icon link will pick them up
automatically.
