# Screens app for Samsung TVs

The TV side of the dashboard's **Screens** page, as a real installed Samsung
app (Tizen). The player is inside the app: it shows the pairing code, plays
the playlist and keeps saved slides for when the internet drops. It talks to
`https://dashboard.chrisneddys.com` only for its code, its playlist and the
images.

`index.html` is generated, not hand-edited: it is the same player as the
dashboard's `/tv` page (`src/lib/screens/player-html.ts`), written out by
`npx tsx scripts/tizen-player.ts`. `build.sh` does that for you, and a test
fails if the two drift apart. It is plain old JavaScript on purpose, so it
runs on Samsung's older TV engines (Tizen 4.0 and up).

## Pairing a TV

1. Open the Screens app on the TV.
2. It shows a 6-digit code.
3. In the dashboard, open **Screens → Pair a screen**, type the code, pick the
   store, a name and what it should show.
4. The TV switches over within a few seconds and stays paired after power cuts.

## What only the owner can do

Samsung only installs apps signed with a certificate tied to a Samsung
account, so these steps happen on the owner's computer, once:

1. Install **Tizen Studio** (free) with the **TV Extensions** and
   **Samsung Certificate Extension** packages from its Package Manager.
2. **Certificate Manager → +** → **Samsung** → **TV**, then sign in with the
   Samsung account that will own the app.
   - For your own regular TVs, add each TV's DUID (Tizen Studio's
     Device Manager shows it once the TV is in developer mode) to the
     distributor certificate.
3. From this folder: `./build.sh <certificate profile name>`. It writes
   `Screens.wgt` (the signed app) and `sssp_config.xml` (what a business
   display reads to install it).

## Installing it

### Samsung business displays (QMC, QMB, QHB…)

These install the app from a web address or a USB stick, and start it by
themselves when the display turns on.

1. Put `Screens.wgt` and `sssp_config.xml` together in one folder: on a USB
   stick, or anywhere on the web over https.
2. On the display's remote: **Home → URL Launcher → Settings → Install Web
   App**, and choose the USB stick or enter the folder's address.
3. Set **Play via** to **URL Launcher** so the app opens at power on.

### Regular Samsung TVs, your own (developer mode)

1. On the TV: **Apps**, press `1 2 3 4 5` on the remote, switch
   **Developer mode** on, enter the computer's IP address, restart the TV.
2. Tizen Studio's **Device Manager** → connect to the TV's IP.
3. `tizen install -n Screens.wgt -t <tv name>`.

The app then sits in the TV's Apps row. Regular TVs don't open an app by
themselves at power on, so someone opens it once after a power cut.

### Any Samsung TV, from Samsung's app store

Submit `Screens.wgt` through **Samsung Apps TV Seller Office** with a seller
account in the owner's name. Samsung reviews and tests it (usually a few
weeks) before it appears in the TV's app store.

## When the internet drops

The app keeps showing the slides it last saved and puts a small
"No internet" note in the corner. If the TV is restarted while the internet
is down, it shows "Starting…" and connects as soon as it's back.
