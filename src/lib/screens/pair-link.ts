import QRCode from "qrcode"
import { DASHBOARD_ORIGIN } from "./player-html"

/** Where the square on a new TV leads: Screens, with the code filled in. */
export function pairLink(code: string): string {
  return `${DASHBOARD_ORIGIN}/dashboard/screens?pair=${code}`
}

export function qrRows(text: string): string[] {
  const { size, data } = QRCode.create(text, { errorCorrectionLevel: "M" }).modules
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (data[y * size + x] ? "1" : "0")).join(""))
}
