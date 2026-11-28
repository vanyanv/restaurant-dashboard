# ChrisnEddysTV: the app for Samsung TVs

The TV side of the dashboard's **Screens** page, as an installed Samsung app
(Tizen). The player is inside the app: it shows a square to scan, plays the
pictures put on that TV, and keeps them for when the internet drops. It talks
to `https://dashboard.chrisneddys.com` for its code, pictures and times, and
listens to `https://realtime.ably.io` to hear at once when they change (both
are named in `config.xml`; without the second it still works, by asking the
dashboard every 15 seconds).

`index.html` is generated, not hand-edited: it is the same player as the
dashboard's `/tv` page (`src/lib/screens/player-html.ts`), written out by
`npx tsx scripts/tizen-player.ts`. `build.sh` does that for you, and a test
fails if the two drift apart. It is plain old JavaScript on purpose, so it
runs on Samsung's older TV engines. The package allows Tizen 2.3 (2015) and up.

| TVs | Offline after a restart | Notes |
|---|---|---|
| 2018 and newer (Tizen 4.0+), QBB, QMB, QHB, QBC, QMC, QHC and newer | Yes | The target |
| 2017 (Tizen 3.0) | Yes | Should work, untested |
| 2015 and 2016 (Tizen 2.3, 2.4) | No, pictures come straight from the network | May also refuse the dashboard's certificate (Let's Encrypt), which the app can't change |
| Before 2015 | Not Tizen, so it can't be installed | Use a small player on HDMI showing `/tv` |

Change `version` in `config.xml` for every build you install over an old one.

## Adding a TV

1. Open ChrisnEddysTV on the TV.
2. Point your phone's camera at the square, or open **Screens → Add a TV** and
   type the 6-digit code.
3. Tap the store and where the TV hangs, then pick a picture.

The TV stays connected after power cuts. **Back** on the remote shows which TV
it is and lets you check for changes or close the app.

## Picture quality

A picture up to 25 MB that fits 3840 × 2160 is stored and sent exactly as
uploaded. Samsung lists 1920 × 1080 as the drawing size for apps on every
model, so an ordinary picture may show at 1080p on a 4K display.

## Building it (needs the owner's Samsung account)

1. Install the Tizen SDK. Samsung's scripts do it without the IDE:
   `github.com/Samsung/tizen-agent-skills` (`tizen-sdk-install`).
2. Make the Samsung certificates with `cert-manager-cli.js` from that repo, or
   Tizen Studio's Certificate Manager → **Samsung** → **TV**:
   - the author certificate. **Back it up.** Every update must be signed with it;
   - the distributor certificate, with the device ID (DUID) of each TV, up to 50.
3. `./build.sh <certificate profile name>`. It writes `ChrisnEddysTV.wgt`,
   `sssp_config.xml` and `usb/SSSP/` with both.

Not settled: whether a business display takes a public-level certificate or
needs a partner-level one. Samsung's signage FAQ describes partner-level
re-signing; ask Samsung Tech Sales before signing for many displays.

## Installing it

### Samsung business displays (QMC, QMB, QHB…)

1. Copy `usb/SSSP` to the top level of a USB stick.
2. On the display: **Home → Custom App → Install From USB Device** (older
   firmware calls it **URL Launcher**). It asks for the display's PIN.
3. Set **Play via** to that app so it opens at power on.

To try the player with no certificate, set Custom App's address to
`https://dashboard.chrisneddys.com/tv`.

### Regular Samsung TVs, your own (developer mode)

1. On the TV: **Apps**, press `1 2 3 4 5`, switch **Developer mode** on, enter
   the computer's IP address, restart the TV.
2. `sdb connect <TV's IP>`, then `tizen install -n ChrisnEddysTV.wgt -t <tv name>`.

Regular TVs don't open an app by themselves at power on.

### Samsung's app store (regular TVs only)

Signage models aren't open in Seller Office. `store/` holds the artwork in
Samsung's sizes: the icon, the logo and background, and four screenshots.
