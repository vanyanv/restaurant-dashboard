import { labelFor } from "@/components/chat/tool-labels"
import type { AskStep } from "@/lib/counter/ask-state"

/**
 * What an answer shows while it is being worked out.
 *
 * Ported from the prototype's own block, whose comment states the design in
 * one line: **"the loading state of an answer is the reading"**. The CSS has
 * been in `counter-components.css` since the Ask surface shipped —
 * `.thinking`, `.tstep`, `.tstep.is-read`, `.tstep.is-reading` and the
 * `tpulse` keyframes, reduced-motion clause included — and nothing has ever
 * emitted it. This is the component it was waiting for.
 *
 * ## What it replaces, and why that mattered
 *
 * `AskAnswerBody` rendered one static line, "Reading the numbers…", for the
 * entire turn. Measured end to end in a browser: it sat unchanged for 32.8 of
 * 33.8 seconds. The surface knew more than it said — the model had called
 * `getDailySales`, received its answer, and moved on to file the return — and
 * a reader watching an unchanging line for half a minute reasonably concludes
 * the thing is broken. It was reported as exactly that.
 *
 * A step log does not make the answer arrive sooner. It makes the wait legible,
 * which is the difference between slow and broken.
 *
 * ## The markup is the sheet's, not this file's idea
 *
 *   <div class="thinking">
 *     <div class="tstep is-read">    <i/> <b>Read the P&L</b>   <span>P&L</span>
 *     <div class="tstep is-reading"> <i/> <b>Filing the answer…</b> <span>…</span>
 *
 * `i` is the dot — grey when pending, green on `is-read`, accent and pulsing
 * on `is-reading`. `b` is the words. `span` is the mono detail, which
 * `.mchat .tstep span{display:none}` hides on the phone, so the phone gets
 * dot-and-label and the desk gets both. `.tstep em` exists in the sheet for a
 * right-aligned status and is deliberately NOT emitted: `b` already carries
 * running-versus-done, and a second copy of the same fact in the same row is
 * not a design, it is a duplicate.
 *
 * ## Why the labels come from `TOOL_LABELS`
 *
 * They are the vocabulary the editorial chat's own indicator has used for
 * months (`chat-thinking.tsx` reads the same `labelFor(...).running`), and
 * ruling K-R2 is that an answer names what it read. Two vocabularies for the
 * same 58 tools would be two names for one source. `labelFor` falls back to
 * `Running <toolName>` for anything unlabelled, which is ugly on purpose —
 * it is meant to be noticed and fixed in `tool-labels.ts`, not hidden here.
 *
 * Not a client component: it renders props and holds no state. The pulse is
 * CSS.
 */
export function Thinking({ steps }: { steps: AskStep[] }) {
  return (
    /*
     * `aria-live` is deliberately NOT set here. `AskAnswerBody` already wraps
     * this in a live region with `aria-busy`, and a nested live region would
     * announce every step twice — once as its own insertion and once as a
     * change to the region above it.
     */
    <div className="thinking">
      {steps.length === 0 ? (
        /*
         * The opening beat. For the first seconds the model is choosing a tool
         * and has called nothing, so there is genuinely nothing read yet —
         * and an empty bordered box would read as a failure. One pending step
         * says the true thing: the question has gone out.
         */
        <div className="tstep is-reading">
          <i />
          <b>Reading the question…</b>
        </div>
      ) : (
        steps.map((step) => {
          const label = labelFor(step.tool)
          return (
            <div
              key={step.tool}
              className={`tstep ${step.state === "read" ? "is-read" : "is-reading"}`}
            >
              <i />
              <b>{step.state === "read" ? label.done : label.running}</b>
              <span>{label.short}</span>
            </div>
          )
        })
      )}
    </div>
  )
}
