// tests/styles/fixtures/counter-lint/white-black.tsx
// no-tailwind-palette must also catch the bare white/black colour
// utilities counter.css's own header explicitly forbids ("No #fff and no
// #000: every neutral is tinted warm.") — these have no palette shade
// suffix (\d{2,3}), so the original regex, built only for e.g. sky-500,
// missed them entirely.
export function WhiteBlack() {
  return <div className="bg-white border-black" />
}
