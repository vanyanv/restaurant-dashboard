"use client"

/** "Save as PDF": the browser's print sheet, where every phone offers Save as PDF or Share. */
export function PrintButton() {
  return (
    <button type="button" className="ckc__btn ckc__btn--ghost ckb__noprint" onClick={() => window.print()}>
      Save as PDF · Guardar PDF
    </button>
  )
}
