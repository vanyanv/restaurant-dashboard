// jsdom has <dialog> but no showModal()/close(). The app's pop-ups are native
// modal dialogs (src/components/counter/modal-dialog.tsx), so the component
// tests get a small stand-in for the parts of the browser contract they
// observe: showModal() opens and moves focus in, Escape fires a cancelable
// `cancel` on the top-most modal and closes it unless prevented, and close()
// hands focus back to whatever had it before. Top layer, inert background and
// the Tab trap are the browser's and are not imitated; tests assert that a
// real modal <dialog> is open instead, and e2e covers the rest.
const proto = typeof HTMLDialogElement === "undefined" ? undefined : HTMLDialogElement.prototype

if (proto && typeof proto.showModal !== "function") {
  const stack: HTMLDialogElement[] = []
  const opener = new WeakMap<HTMLDialogElement, Element | null>()
  const FOCUSABLE = "[autofocus], input:not(:disabled), button:not(:disabled), a[href], select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"

  proto.showModal = function (this: HTMLDialogElement) {
    if (this.open) return
    opener.set(this, document.activeElement)
    this.setAttribute("open", "")
    stack.push(this)
    const first = Array.from(this.querySelectorAll<HTMLElement>(FOCUSABLE)).find((el) => el.closest("[hidden]") === null)
    first?.focus()
  }
  proto.show = function (this: HTMLDialogElement) {
    this.setAttribute("open", "")
  }
  proto.close = function (this: HTMLDialogElement, returnValue?: string) {
    if (!this.open) return
    if (returnValue !== undefined) this.returnValue = returnValue
    this.removeAttribute("open")
    const i = stack.indexOf(this)
    if (i >= 0) stack.splice(i, 1)
    const back = opener.get(this)
    if (back instanceof HTMLElement && back.isConnected) back.focus()
    this.dispatchEvent(new Event("close"))
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return
    const top = stack.filter((d) => d.isConnected && d.open).at(-1)
    if (!top) return
    if (top.dispatchEvent(new Event("cancel", { cancelable: true }))) top.close()
  })
}
