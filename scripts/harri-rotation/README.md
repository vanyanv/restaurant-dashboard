# Harri token auto-rotation

Harri's Cognito refresh token expires every ~30 days and **does not rotate**
(confirmed `rotated=false` from `REFRESH_TOKEN_AUTH`). Renewing it requires a
full login, which is gated by **reCAPTCHA v3** — and v3 scores GitHub's
datacenter IPs too low to pass. So renewal cannot run on GitHub-hosted runners.

**What works (proven):** a *headed* browser doing a *programmatic* submit
(`scripts/refresh-harri-jwt.ts --auto`) passes reCAPTCHA v3 **from a residential
IP** with no human and no paid CAPTCHA service. The fix is therefore to run that
rotation on a schedule **on a machine with a residential IP and a display**
(e.g. this WSL box via WSLg).

The daily `harri-jwt-heartbeat` workflow remains the safety net: if a scheduled
rotation is ever missed, it warns ~hours before the 4-hourly labor sync breaks.

## Option A — systemd user timer (recommended; catches missed runs)

```bash
cp scripts/harri-rotation/harri-token-rotate.{service,timer} ~/.config/systemd/user/
# If your uid != 1000, fix XDG_RUNTIME_DIR in the .service (check: id -u).
systemctl --user daemon-reload
systemctl --user enable --now harri-token-rotate.timer
# Optional: let it run even when you're not logged in (needs sudo):
#   sudo loginctl enable-linger "$USER"

# Verify:
systemctl --user list-timers harri-token-rotate.timer
systemctl --user start harri-token-rotate.service   # one-off test run
tail -n 40 logs/harri-token-rotation.log
```

`Persistent=true` means if the machine is off at the scheduled time, the run
fires on the next boot instead of waiting another week.

## Option B — cron (simpler; no catch-up on missed runs)

```cron
# Weekly, Mondays 10:00. DISPLAY/WAYLAND vars are required for the headed browser.
0 10 * * 1 DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 /home/vardan/restaurant-dashboard/scripts/rotate-harri-token.sh
```

## Option C — self-hosted GitHub Actions runner

Register a self-hosted runner on a residential-IP machine, then a scheduled
workflow with `runs-on: self-hosted` can call `refresh-harri-jwt.ts --auto`.
More moving parts than A/B; only worth it if you already run a self-hosted
runner.

## Manual fallback

Whatever the schedule, you can always rotate by hand when the heartbeat warns:

```bash
pnpm tsx scripts/refresh-harri-jwt.ts --auto    # unattended, this machine
pnpm tsx scripts/refresh-harri-jwt.ts           # headed, click Log in yourself
```
