/**
 * The food photography from chrisneddys.com, keyed by the dashboard's recipe
 * name, so the owner sees the plate they are editing.
 *
 * The files in `public/menu-photos/` are copies of the site's own
 * `public/menu/` shots (720x480, plus a 200x133 `-thumb`), and the framing
 * below is the site's `photoFraming` (`src/data/photoFocus.ts` there): every
 * shot is on a white sweep with the food in a different place, so each one
 * carries its own `[focus, zoom]` — a `background-position-y` percentage and
 * a `background-size` percentage — measured so the whole plate stays inside
 * the frame. One shared crop would leave empty paper above half the menu or
 * cut the top off the bottles.
 *
 * The site names items the way its storefront does ("Chris N Eddy's Slider",
 * "2 Sliders and Fries"); the dashboard names recipes ("Double Slider",
 * "2 Slider Combo"). The map is by recipe name because a recipe is what this
 * page edits. A recipe with no entry gets the "No photo" frame rather than a
 * borrowed one.
 */

export type MenuWay = "chris" | "eddy"

export interface MenuPhoto {
  /** Basename in `/menu-photos`, without `.webp`. Chris's Way when shot both ways. */
  photo: string
  /** The Eddy's Way shot, for items photographed both ways. */
  eddy?: string
}

const PHOTOS: Record<string, MenuPhoto> = {
  "Double Slider": { photo: "chris-n-eddy-s-slider-chris", eddy: "chris-n-eddy-s-slider-eddy" },
  "Single Slider": { photo: "single-patty-slider-chris", eddy: "single-patty-slider-eddy" },
  "Triple Slider": { photo: "triple-patty-slider-chris", eddy: "triple-patty-slider-eddy" },
  "Grilled Cheese": { photo: "grilled-cheese" },
  "1 Slider Combo": { photo: "combo-1-chris", eddy: "combo-1-eddy" },
  "2 Slider Combo": { photo: "combo-2-chris", eddy: "combo-2-eddy" },
  "Combo 3": { photo: "2-triples-and-fries-chris", eddy: "2-triples-and-fries-eddy" },
  "2 Grilled Cheeses and Fries": { photo: "2-grilled-cheeses-and-fries" },
  "Straight Cut Fries": { photo: "straight-cut-fries" },
  "Cheese Fries": { photo: "cheese-fries" },
  "Loaded Fries": { photo: "loaded-fries" },
  "Side of Yellow Chilies": { photo: "yellow-chilies" },
  "Extra Chris N Eddy's Sauce": { photo: "chris-n-eddy-s-sauce" },
  "The Quad": { photo: "the-quad-chris", eddy: "the-quad-eddy" },
  "The Triple Pack": { photo: "triple-pack-eddy" },
  "The Family Box": { photo: "family-box-eddy" },
  "The Reverse Bun": { photo: "reverse-bun-chris", eddy: "reverse-bun-eddy" },
  "Strawberry Shake (20 oz cup)": { photo: "strawberry-shake" },
  "Chocolate Shake (20 oz cup)": { photo: "chocolate-shake" },
  "Vanilla Shake (20 oz cup)": { photo: "vanilla-shake" },
  "Coca Cola (20 oz cup)": { photo: "coca-cola" },
  "Diet Coke (20 oz cup)": { photo: "diet-coke" },
  // The site shows Coke Zero with the Diet Coke shot too; there is no other.
  "Coke Zero (20 oz cup)": { photo: "diet-coke" },
  "Sprite (20 oz cup)": { photo: "sprite" },
  "Orange Fanta (20 oz cup)": { photo: "orange-fanta" },
  "Hi-C (20 oz cup)": { photo: "hi-c" },
  "Minute Maid (20 oz cup)": { photo: "minute-maid" },
  "Mexican Sprite 500ml": { photo: "mexican-sprite" },
  "Mexican Fanta 500ml": { photo: "mexican-fanta" },
  "Mexican Coke 500ml": { photo: "mexican-coke" },
  Water: { photo: "water-bottle" },
}

/** The site's measured `[focus, zoom]` per shot. */
const FRAMING: Record<string, readonly [focus: number, zoom: number]> = {
  "2-grilled-cheeses-and-fries": [55, 110],
  "2-triples-and-fries-chris": [50, 131],
  "2-triples-and-fries-eddy": [50, 119],
  "cheese-fries": [63, 108],
  "chocolate-shake": [100, 100],
  "chris-n-eddy-s-slider-chris": [87, 109],
  "chris-n-eddy-s-sauce": [80, 132],
  "chris-n-eddy-s-slider-eddy": [69, 132],
  "coca-cola": [50, 100],
  "combo-1-chris": [64, 110],
  "combo-1-eddy": [63, 110],
  "combo-2-chris": [65, 110],
  "combo-2-eddy": [65, 110],
  "diet-coke": [100, 100],
  "family-box-eddy": [49, 105],
  "grilled-cheese": [56, 117],
  "hi-c": [100, 100],
  "loaded-fries": [89, 106],
  "mexican-coke": [51, 106],
  "mexican-fanta": [83, 100],
  "mexican-sprite": [50, 100],
  "minute-maid": [85, 100],
  "orange-fanta": [100, 100],
  "reverse-bun-chris": [74, 131],
  "reverse-bun-eddy": [68, 132],
  "single-patty-slider-chris": [64, 132],
  "single-patty-slider-eddy": [65, 132],
  sprite: [50, 100],
  "straight-cut-fries": [53, 132],
  "strawberry-shake": [60, 100],
  "the-quad-chris": [50, 124],
  "the-quad-eddy": [50, 125],
  "triple-pack-eddy": [49, 105],
  "triple-patty-slider-chris": [50, 125],
  "triple-patty-slider-eddy": [50, 124],
  "vanilla-shake": [80, 100],
  "water-bottle": [50, 100],
  "yellow-chilies": [57, 132],
}

/** The site's own fallback for a shot it has not measured. */
const DEFAULT_FRAMING = [62, 132] as const

export function menuPhotoFor(recipeName: string): MenuPhoto | null {
  return PHOTOS[recipeName.trim()] ?? null
}

export interface PhotoFrame {
  /** URL of the 200px thumbnail. */
  thumb: string
  /** URL of the 720px shot. */
  full: string
  focus: number
  zoom: number
}

/** The shot to show for a recipe, in the asked-for Way when it was shot both ways. */
export function photoFrame(recipeName: string, way: MenuWay = "chris"): PhotoFrame | null {
  const p = menuPhotoFor(recipeName)
  if (!p) return null
  const id = way === "eddy" && p.eddy ? p.eddy : p.photo
  const [focus, zoom] = FRAMING[id] ?? DEFAULT_FRAMING
  return { thumb: `/menu-photos/${id}-thumb.webp`, full: `/menu-photos/${id}.webp`, focus, zoom }
}

/** Every file the map points at, for the test that keeps the folder and the map in step. */
export function allPhotoIds(): string[] {
  return [...new Set(Object.values(PHOTOS).flatMap((p) => (p.eddy ? [p.photo, p.eddy] : [p.photo])))]
}
