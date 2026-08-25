import { Bullet } from "./bullet"
import { bwords, type Reference } from "@/lib/counter/bullet-state"
import { money } from "@/lib/counter/format"

/**
 * The lead figure's floor, drawn with the same mark at lead scale.
 *
 * Ported from `floorMeter(v)` at line 3793 of
 * `docs/counter/counter-prototype.html`, which is two elements and no wrapper:
 *
 * ```
 * <span class="blt blt--lead" role="img" aria-label="…">…</span>
 * <span class="hfloor"><span class="flag is-breach"><i></i>under</span> Floor $68.00 · $1.20 short</span>
 * ```
 *
 * It returns a FRAGMENT, exactly as the prototype returns two concatenated
 * strings: both siblings belong to the `.fig` that contains them (`.headline
 * .fig` is `display:grid;gap:3px`), and wrapping them would put a grid item
 * between them and their tracks.
 *
 * WHY THIS IS A COMPONENT AND NOT A `Figure` CAPTION. `Figure size="lead"`
 * already renders `Bullet` + `.hfloor` from a `Reference` and a caption
 * string — but the caption here is not a constant. "$3.40 of room" versus
 * "$1.20 short" is a SECOND judgement about which side of the floor the
 * figure sits on, and if the caller wrote it, the caller's arithmetic could
 * disagree with the meter's own `bstat()` — a figure captioned "of room" over
 * a meter drawn in breach. Note 60's defect class exactly. Both readings come
 * from the one comparison here, so they cannot part company.
 *
 * `Bullet` needed no extension: `Reference` already carries `{v, target,
 * better, label}` and `Bullet` already takes the prototype's `cls` argument as
 * `className`, so `blt--lead` is a modifier on the one meter rather than a
 * second meter.
 *
 * `floor` is a PROP. The prototype hardcodes `SPLH_FLOOR = 68.00`; ours has to
 * come from the store's own file, and a page that does not have it yet owes it
 * rather than inventing 68.
 *
 * `Section` is the sole state renderer (R3). This takes two numbers.
 */
export function FloorMeter({
  value,
  floor,
  /** What the figure is, for the meter's `aria-label` — its only screen-reader text. */
  name = "Sales per labor hour",
}: {
  value: number
  floor: number
  name?: string
}) {
  const over = value >= floor
  const reference: Reference = {
    v: value,
    target: floor,
    better: "high",
    label:
      `${name} ${money(value, { cents: true })} against a floor of ` +
      `${money(floor, { cents: true })} — ${over ? "above it" : "below it"}`,
  }
  const flag = bwords(reference)
  const gap = money(Math.abs(value - floor), { cents: true })

  return (
    <>
      <Bullet reference={reference} className="blt--lead" />
      <span className="hfloor">
        {flag ? (
          <>
            <span className={`flag is-${flag.status}`}>
              <i />
              {flag.word}
            </span>{" "}
          </>
        ) : null}
        {`Floor ${money(floor, { cents: true })} · ${over ? `${gap} of room` : `${gap} short`}`}
      </span>
    </>
  )
}
