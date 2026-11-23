import { TvPlayer } from "./tv-player"

/**
 * What a TV opens: the Screens app (tizen-app/) loads this page, and a Samsung
 * business display can point its URL Launcher straight at it. The first time,
 * it shows a 6-digit code to type on the dashboard's Screens page; after
 * that, the playlist the owner picked.
 */
export default function Page() {
  return <TvPlayer />
}
