import { CounterPhoneNotFoundClient } from "./(counter)/not-found/counter-phone-not-found-client"

// Renders inside the (mobile) `/m` layout by placement, so the tab bar
// stays visible — unlike the root `not-found.tsx`, which bypasses it.
//
// Until 2026-11-11 this drew the pre-Counter serif 404 and said the page "may
// live on the desktop dashboard", which stopped being true when every desk
// page got a phone page. It now draws the same Counter 404 as /m/not-found.
export default function MobileNotFound() {
  return (
    <div data-perf-ready="/m/not-found" className="ct-root ct-phone">
      <div className="mscroll">
        <CounterPhoneNotFoundClient />
      </div>
    </div>
  )
}
