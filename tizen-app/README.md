# Screens app for Samsung TVs

The TV side of the dashboard's **Screens** page. The app is a thin shell that
opens `https://dashboard.chrisneddys.com/tv`. Everything the TV shows (the
pairing code, the playlist, saved slides for when the internet drops) lives
on that page, so a change to the player ships with the dashboard and no TV
needs reinstalling.

## Pairing a TV

1. Get the TV to open the player (one of the three ways below).
2. It shows a 6-digit code.
3. In the dashboard, open **Screens → Pair a screen**, type the code, pick the
   store, a name and what it should show.
4. The TV switches over within a few seconds and stays paired after power cuts.

## Getting the player onto a TV

### Samsung business displays (QMC, QMB, QHB…): URL Launcher, no install

1. On the display's remote: **Home → URL Launcher → Settings → Install Web App**
   (on some firmware: **Menu → System → Play via → URL Launcher**).
2. Enter `https://dashboard.chrisneddys.com/tv`.
3. Set **Play via** to URL Launcher so it starts by itself when the display
   turns on.

If the display asks for an app package instead of a page, host the signed
`.wgt` from the next section with `sssp_config.xml` beside it and enter that
folder's address.

### Regular Samsung TVs: install the app

Regular TVs cannot run a page at start-up, so they need this app installed.
That takes a signing certificate in the owner's name:

1. Install Tizen Studio with the **TV Extensions** and **Samsung Certificate
   Extension** packages.
2. Certificate Manager → create a **Samsung** certificate (sign in with the
   Samsung account that will own the app). Add each TV's DUID for testing.
3. On the TV: **Apps**, then press `1 2 3 4 5` on the remote, switch
   **Developer mode** on and enter the computer's IP address, restart the TV.
4. From this folder: `./build.sh <certificate profile name>` makes
   `Screens.wgt`, then `tizen install -n Screens.wgt -t <tv>` installs it.

For one-tap install on any Samsung TV, submit `Screens.wgt` through Samsung
Apps TV Seller Office (seller account in the owner's name; Samsung reviews
and tests it before it appears in the TV's app store).

### Any other screen

Any TV stick or computer with a browser works: open
`https://dashboard.chrisneddys.com/tv` full screen.

## When the internet drops

The player keeps showing the slides it last saved and puts a small
"No internet" note in the corner. If the TV is restarted while the internet
is down, the app waits and connects as soon as it's back.
