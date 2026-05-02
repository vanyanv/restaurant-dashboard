# Home-screen icons

These PNGs are referenced from `/manifest.webmanifest` and app metadata so
"Add to Home Screen" on iOS and PWA install prompts use the ChrisnEddys logo
instead of a generated page screenshot.

Source asset:
- `../logo.png` - full ChrisnEddys logo.

Required generated files:
- `apple-touch-icon-180.png` - 180x180, opaque, no transparency.
- `icon-192.png` - 192x192, opaque, no transparency.
- `icon-512.png` - 512x512, opaque, no transparency.
- `icon-maskable-512.png` - 512x512, with the logo contained inside the
  adaptive-icon safe area.

Rendering notes:
- Background: `#fbf6ee`.
- Center the full wide logo on the square canvas with enough padding to avoid
  clipped text.
- Keep the maskable icon slightly more inset than the standard 512 icon so
  Android launchers can apply their masks without cutting into the logo.
