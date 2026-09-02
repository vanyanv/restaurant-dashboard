import Image from "next/image"
import logo from "../../../../public/logo-wordmark.png"

/**
 * The mark, drawn as the prototype draws it: `<img class="logo">` inside a
 * `.login__logo` or `.rail__logo`, sized by the sheet.
 *
 * `Wordmark` exists next to this and sets the name in the display face. It was
 * written because `Rail` recorded "we have no logo asset" — and that was never
 * true; `public/logo.png` has been in the tree since the first commit. Note 15
 * is the reason the difference matters: "the wordmark is the palette's alibi",
 * the red and the signal yellow read as a designer's choice until the mark
 * sits next to them, and an alibi has to be the real thing.
 *
 * The source is `logo.png` cropped to its own alpha bounds (1280x726 of mostly
 * nothing -> 957x253) and quantised to the 64 colours three-colour flat art
 * needs: 168 KB -> 23 KB, before `next/image` has served a byte of it.
 *
 * `width` because the design sizes this differently in each slot — 236px on
 * the desk's sign-in, 190px on the phone's — and `.login__logo .logo` already
 * states the desk's, so the default matches the sheet and only the phone
 * passes anything.
 *
 * `priority` defaults on because every screen that draws this today is a bare
 * auth page where the mark is the largest thing above the fold, and therefore
 * the LCP candidate. A slot where it is chrome rather than the subject should
 * pass `priority={false}`.
 */
export function Logo({
  width = 236,
  priority = true,
}: {
  width?: number
  priority?: boolean
}) {
  return (
    <Image className="logo" src={logo} alt="Chris N Eddy's" style={{ width }} priority={priority} />
  )
}
