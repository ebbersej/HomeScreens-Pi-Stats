# Pi Monitor (Home Screens plugin)

Shows the health of the Raspberry Pi running your display: CPU temperature,
CPU usage, memory, disk, load, uptime and power/throttling warnings.

Home Screens plugins run in the browser and can't read a Pi's sensors, so this
has two parts:

1. `stats-server/` - a tiny stdlib-only Python service on the Pi that serves
   JSON at `http://127.0.0.1:8765/stats`.
2. The plugin (`manifest.json` + `dist/bundle.js`) - polls that service through
   the Home Screens plugin proxy. No build step; the bundle is plain JS.

## 1. Install the stats service on the Pi

    sudo mkdir -p /opt/pi-stats
    sudo cp stats-server/pi_stats.py /opt/pi-stats/
    sudo cp stats-server/pi-stats.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now pi-stats
    curl http://127.0.0.1:8765/stats

You should see JSON with `tempC`, `memory`, `disk`, etc.

## 2. Try the plugin in dev mode

On your computer (or the Pi), from this folder:

    python3 -m http.server 5555

In the editor open Plugins > Developer, paste `http://<that-machine>:5555`.
Dev plugins only apply in the editor preview, not on the kiosk.

## 3. Install it for real

Dev mode doesn't reach the kiosk. Publish `plugin.tar.gz` (manifest.json at its
root) as a GitHub release, then use Plugins > Browse > Install from URL, or
submit it at https://homescreens.dev/plugins/submit.

Before publishing, set `author` in `manifest.json`.

## Notes

- Shows "Power OK / Throttled / Under-voltage" from `vcgencmd get_throttled`.
- Publishes `temp_level` (ok/warn/critical) and `throttled` (true/false) as shared
  state, so other modules can show only when the Pi runs hot (module Conditions).
- Stats service on a different machine than the hub? Set
  `PI_STATS_HOST=0.0.0.0`, add that machine's address to `allowedDomains` in
  the manifest, and set the URL under Plugins > Installed > Plugin settings.
