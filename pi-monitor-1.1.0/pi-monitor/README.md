# Pi Monitor (Home Screens plugin) v1.1.0

A module you can drag onto any screen showing the health of the Pi running your
display: CPU temperature, CPU load, memory, disk, uptime and power/throttling.

By default it reads Home Screens' own stats feed (the same data as
Settings > Status): http://127.0.0.1:3000/api/system/stats. Nothing needs
installing on the Pi. If you set an editor password and the feed starts
requiring a login, the module says so; switch to the optional service below.

## Try it (dev mode, editor preview only)

1. Unzip/copy this folder on your computer.
2. In it, run:  python serve_dev.py
3. In the editor: Plugins > Developer > paste http://<your-computer-ip>:5555
4. Drag "Pi Monitor" (category System) onto a screen.

Dev plugins appear in the editor preview only, not on the real display.

## Put it on the real display

Publish plugin.tar.gz (manifest.json at its root) as a GitHub release, then
Plugins > Browse > Install from URL with the release's HTTPS link. Set
"author" in manifest.json first.

## Optional: stats service (only if the built-in feed needs a login)

stats-server/pi_stats.py + pi-stats.service (stdlib Python, systemd). Install
to /opt/pi-stats, enable the service, then set the plugin's Stats URL
(Plugins > Installed > Plugin settings) to http://127.0.0.1:8765/stats.

## Shared state

Publishes temp_level (ok/warn/critical) and throttled (true/false) so other
modules can appear only when the Pi runs hot (module Conditions).
