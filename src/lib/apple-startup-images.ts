/**
 * The launch images iOS shows while a home-screen app loads.
 *
 * Without them iOS paints the screen BLACK from the tap until the page's first
 * paint. Once the phone layouts stopped waiting on the database (PR #219) that
 * black went from ~10 s to under a second, but the owner still saw it on every
 * launch (screen recording 2026-11-19: 0.8 s of black, then the page). iOS
 * ignores the manifest's `background_color`; only these images replace the
 * black. Each is the Counter paper (`BROWSER_CHROME_LIGHT`) with the logo in
 * the middle, so the launch reads as one continuous screen into the page.
 *
 * iOS uses an image only when its pixel size matches the device exactly, so
 * there is one per iPhone screen size, picked by the media query. Generated
 * from `public/logo.png` into `public/splash/`. iOS reads them when the icon
 * is ADDED to the home screen: an icon added before they existed keeps the
 * black until it is removed and added again.
 */
const IPHONES: ReadonlyArray<readonly [w: number, h: number, ratio: number]> = [
  [440, 956, 3], // 16 Pro Max, 17 Pro Max
  [420, 912, 3], // Air
  [402, 874, 3], // 16 Pro, 17, 17 Pro
  [430, 932, 3], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [428, 926, 3], // 12 / 13 Pro Max, 14 Plus
  [390, 844, 3], // 12, 13, 14, 12 / 13 Pro
  [375, 812, 3], // X, XS, 11 Pro, 12 / 13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [375, 667, 2], // 8, SE
]

export const APPLE_STARTUP_IMAGES: { url: string; media: string }[] = IPHONES.map(([w, h, r]) => ({
  url: `/splash/iphone-${w * r}x${h * r}.png`,
  media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
}))
