import { describe, expect, it } from "vitest"
import { posterSteps } from "@/app/dashboard/(counter)/checks/posters/poster"

const w = (label: string, labelEs: string, photos: number) => ({ label, labelEs, opens: "", submit: "", until: [], untilEs: [], photos })

describe("posterSteps", () => {
  it("names the store's switched-on checks and mentions the camera only when a list asks for photos", () => {
    const steps = posterSteps({ windows: [w("Morning", "Mañana", 7), w("Night", "Noche", 0)] })
    expect(steps[1]).toEqual({ en: "Tap Morning or Night.", es: "Toca Mañana o Noche. Toca ES para español." })
    expect(steps[3].en).toContain("Camera?")
    expect(steps.at(-1)?.en).toBe("Tap Submit before time runs out.")
  })

  it("leaves the camera out when no list needs a photo", () => {
    const steps = posterSteps({ windows: [w("Night", "Noche", 0)] })
    expect(steps[1].en).toBe("Tap Night.")
    expect(steps[3]).toEqual({ en: "Do each task, then tap it.", es: "Haz cada tarea y luego tócala." })
  })

  it("lists three checks with commas", () => {
    const steps = posterSteps({ windows: [w("Morning", "Mañana", 1), w("Transition", "Cambio de turno", 0), w("Night", "Noche", 0)] })
    expect(steps[1].en).toBe("Tap Morning, Transition or Night.")
  })
})
