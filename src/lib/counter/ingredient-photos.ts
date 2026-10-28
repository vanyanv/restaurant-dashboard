import type { PhotoFrame } from "@/lib/counter/menu-photos"

/**
 * A picture for each ingredient the recipes use, so an owner reading a recipe
 * line or the Ingredients list sees the cheese, the roll or the cup rather
 * than a vendor's SKU text ("american cheese yellow 160").
 *
 * These are NOT photos of the restaurant's own stock. The site has food shots
 * of finished dishes only, so on 2026-10-28 the owner asked for generated
 * ones (Higgsfield): a studio shot of each item on the same white sweep the
 * site's photography uses, so they sit beside the dish photos without
 * clashing. Each is 720x480 plus a 200x133 `-thumb`, in `public/ingredient-photos/`.
 *
 * Keyed by the canonical ingredient's name, lower-cased with its spaces
 * collapsed — the name is what the owner sees, and the ids differ between
 * the production database and every local copy. An ingredient with no entry
 * gets the "No photo" frame. Every shot is already framed with margin, so
 * there is no per-shot focus or zoom: the frame shows the whole picture.
 */

const PHOTOS: Record<string, string> = {
  "american cheese yellow 160": "american-cheese",
  "chris & eddy's house sauce": "house-sauce",
  "chris & eddy's house sauce cup 1.5 oz": "sauce-cup",
  "chrsned bag plas tshirt logo ptsbchrisneddy": "tshirt-bag",
  "cup portion plastic 2 oz clear": "portion-cup-2oz",
  "cutlery fork full size extra heavy black pp": "fork",
  "greeno cup pet 20 oz c&d pet": "cup-20oz",
  "greeno lid flat with hole 20 oz pe pet": "lid-20oz",
  "ground beef fine grnd 73/27 creekstone": "ground-beef",
  "imported fresh tomato bulk 5x6 fresh": "tomato",
  "lamb potato fry ss 1/4 stealth": "fries-frozen",
  "lid portion plastic 1.5, 2, 2.5 oz": "portion-lid",
  "lyon medium syrup chocolate free flow": "chocolate-syrup",
  "lyon medium syrup strawberry rtu": "strawberry-syrup",
  "martins bread potato roll sandwich 3.5 inch": "potato-roll",
  "napkin dispenser 2-ply 8.5 x 6.5 white": "napkins",
  "packer lettuce boston hydroponic": "boston-lettuce",
  "packer onion sweet fresh": "sweet-onion",
  "peppers whole yellow": "yellow-peppers",
  'pickle chips sandwich cut 1/8"': "pickle-chips",
  "soda coke mexican glass": "mexican-coke",
  "soda orange fanta mexican glass": "mexican-fanta",
  "soda sprite mexican glass crv inc": "mexican-sprite",
  "straw 7.75 plastic giant clear wrapped": "straw",
  "syrup coca cola classic": "coke-syrup",
  "syrup coca cola zero sugar": "coke-zero-syrup",
  "syrup diet coca cola": "diet-coke-syrup",
  "syrup hi-c fruit punch flashin": "hi-c-syrup",
  "syrup orange fanta": "fanta-syrup",
  "syrup sprite": "sprite-syrup",
  "tray food paper #50 1/2 lb white red check": "food-tray",
  "water crystal geyser spring": "water-bottle",
  "whole class ice cream mix soft serve vanilla 5%": "ice-cream-mix",
  "whole frozen butter solid usda aa unsalted": "butter",
}

const keyOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ")

/** The shot for an ingredient by its name (any case), or null. */
export function ingredientPhoto(name: string): PhotoFrame | null {
  const id = PHOTOS[keyOf(name)]
  if (!id) return null
  return { thumb: `/ingredient-photos/${id}-thumb.webp`, full: `/ingredient-photos/${id}.webp`, focus: 50, zoom: 100 }
}

/** Every file the map points at, for the test that keeps the folder and the map in step. */
export function allIngredientPhotoIds(): string[] {
  return [...new Set(Object.values(PHOTOS))]
}
