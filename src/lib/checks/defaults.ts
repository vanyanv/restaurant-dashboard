import type { CheckKindName } from "./time"

/**
 * The checklists a store starts with, before the owner edits anything.
 * Morning is the owner's own list (2026-10-29); Night is the earlier close
 * list. Spanish is a first draft for the owner to correct on the Checklists
 * page. The third entry of an item marks a task that needs a photo.
 */
export type DefaultItem = [en: string, es: string, photo?: true]

export type DefaultSection = {
  nameEn: string
  nameEs: string
  items: DefaultItem[]
}

export type DefaultTemplate = {
  kind: CheckKindName
  opensAtMin: number
  submitFromMin: number
  dueAtMin: number
  /** Empty, or seven submit-until times, Sunday first. */
  dueByWeekday: number[]
  graceMin: number
  sections: DefaultSection[]
}

const H = 60
/** Night submit closes 2:00 am after a 1 am close, 3:00 am after a 3 am close (Fri to Sun). */
const NIGHT_SHORT = 26 * H
const NIGHT_LONG = 27 * H

export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  {
    kind: "MORNING",
    opensAtMin: 9 * H,
    submitFromMin: 16 * H + 30,
    dueAtMin: 17 * H + 30,
    dueByWeekday: [],
    graceMin: 0,
    sections: [
      {
        nameEn: "Morning tasks",
        nameEs: "Tareas de la mañana",
        items: [
          ["Set up kitchen", "Preparar la cocina"],
          ["Do prep", "Hacer la preparación"],
          ["Organize walk-in", "Organizar la cámara fría", true],
          ["Sweep floors", "Barrer los pisos"],
          ["Mop floors with degreaser and detergent", "Trapear los pisos con desengrasante y detergente", true],
          ["Take out trash before shift change", "Sacar la basura antes del cambio de turno"],
          ["Clean dishes before shift change", "Lavar los platos antes del cambio de turno", true],
          ["Restock all stations before shift change", "Surtir todas las estaciones antes del cambio de turno"],
        ],
      },
    ],
  },
  {
    kind: "EVENING",
    opensAtMin: 17 * H + 30,
    submitFromMin: 24 * H + 30,
    dueAtMin: NIGHT_SHORT,
    dueByWeekday: [NIGHT_LONG, NIGHT_SHORT, NIGHT_SHORT, NIGHT_SHORT, NIGHT_SHORT, NIGHT_LONG, NIGHT_LONG],
    graceMin: 0,
    sections: [
      {
        nameEn: "Kitchen",
        nameEs: "Cocina",
        items: [
          ["Flat-top scraped and oiled", "Plancha raspada y aceitada"],
          ["Fryer oil filtered", "Aceite de freidora filtrado"],
          ["Fryer baskets washed", "Canastas de freidora lavadas"],
          ["Prep tables sanitized", "Mesas de preparación desinfectadas"],
          ["Floors swept and mopped", "Pisos barridos y trapeados", true],
          ["Trash out and liners replaced", "Basura sacada y bolsas cambiadas"],
          ["Walk-in door closed", "Puerta de la cámara fría cerrada"],
        ],
      },
      {
        nameEn: "Front of house",
        nameEs: "Comedor",
        items: [
          ["Tables and chairs wiped", "Mesas y sillas limpias"],
          ["Condiment station restocked", "Estación de condimentos surtida"],
          ["Drink nozzles soaked", "Boquillas de bebidas en remojo"],
          ["Restroom cleaned", "Baño limpio", true],
          ["Floors swept and mopped", "Pisos barridos y trapeados"],
        ],
      },
    ],
  },
]
