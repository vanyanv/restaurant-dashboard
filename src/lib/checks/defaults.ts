import type { CheckKindName } from "./time"

/**
 * The checklists a store starts with, before the owner edits anything.
 * Wording is the owner's from the prototype; Spanish is a first draft for the
 * owner to correct on the Checklists page.
 */
export type DefaultSection = {
  nameEn: string
  nameEs: string
  photoRequired: boolean
  photoHintEn: string
  photoHintEs: string
  items: Array<[en: string, es: string]>
}

export type DefaultTemplate = {
  kind: CheckKindName
  opensAtMin: number
  dueAtMin: number
  graceMin: number
  sections: DefaultSection[]
}

const KITCHEN = { nameEn: "Kitchen", nameEs: "Cocina", photoRequired: true }
const FRONT = { nameEn: "Front of house", nameEs: "Comedor", photoRequired: true }

export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  {
    kind: "MORNING",
    opensAtMin: 6 * 60,
    dueAtMin: 10 * 60,
    graceMin: 30,
    sections: [
      {
        ...KITCHEN,
        photoHintEn: "Show the line set up and ready",
        photoHintEs: "Muestra la línea lista",
        items: [
          ["Walk-in at 38°F or below", "Cámara fría a 38°F o menos"],
          ["Fryer oil checked and topped up", "Aceite de freidora revisado y rellenado"],
          ["Prep tables sanitized", "Mesas de preparación desinfectadas"],
          ["Hand sink stocked", "Lavamanos surtido"],
        ],
      },
      {
        ...FRONT,
        photoHintEn: "Show the counter and dining room",
        photoHintEs: "Muestra el mostrador y el comedor",
        items: [
          ["Tables and chairs wiped", "Mesas y sillas limpias"],
          ["Condiment station stocked", "Estación de condimentos surtida"],
          ["Restroom checked", "Baño revisado"],
        ],
      },
    ],
  },
  {
    kind: "TRANSITION",
    opensAtMin: 14 * 60,
    dueAtMin: 16 * 60,
    graceMin: 30,
    sections: [
      {
        ...KITCHEN,
        photoHintEn: "Show the flat-top and prep line",
        photoHintEs: "Muestra la plancha y la línea",
        items: [
          ["Flat-top scraped and oiled", "Plancha raspada y aceitada"],
          ["Fryer baskets washed", "Canastas de freidora lavadas"],
          ["Hand sink stocked", "Lavamanos surtido"],
          ["Prep tables sanitized", "Mesas de preparación desinfectadas"],
          ["Walk-in at 38°F or below", "Cámara fría a 38°F o menos"],
        ],
      },
      {
        ...FRONT,
        photoHintEn: "Show the counter and drink station",
        photoHintEs: "Muestra el mostrador y la estación de bebidas",
        items: [
          ["Tables and chairs wiped", "Mesas y sillas limpias"],
          ["Drink station cleaned", "Estación de bebidas limpia"],
          ["Restroom restocked", "Baño surtido"],
          ["Front door glass cleaned", "Vidrio de la puerta limpio"],
        ],
      },
    ],
  },
  {
    kind: "EVENING",
    opensAtMin: 21 * 60,
    dueAtMin: 23 * 60 + 30,
    graceMin: 30,
    sections: [
      {
        ...KITCHEN,
        photoHintEn: "Show the clean line and floor",
        photoHintEs: "Muestra la línea y el piso limpios",
        items: [
          ["Flat-top scraped and oiled", "Plancha raspada y aceitada"],
          ["Fryer oil filtered", "Aceite de freidora filtrado"],
          ["Fryer baskets washed", "Canastas de freidora lavadas"],
          ["Prep tables sanitized", "Mesas de preparación desinfectadas"],
          ["Floors swept and mopped", "Pisos barridos y trapeados"],
          ["Trash out and liners replaced", "Basura sacada y bolsas cambiadas"],
          ["Walk-in door closed", "Puerta de la cámara fría cerrada"],
        ],
      },
      {
        ...FRONT,
        photoHintEn: "Show the dining room and counter",
        photoHintEs: "Muestra el comedor y el mostrador",
        items: [
          ["Tables and chairs wiped", "Mesas y sillas limpias"],
          ["Condiment station restocked", "Estación de condimentos surtida"],
          ["Drink nozzles soaked", "Boquillas de bebidas en remojo"],
          ["Restroom cleaned", "Baño limpio"],
          ["Floors swept and mopped", "Pisos barridos y trapeados"],
        ],
      },
    ],
  },
]
