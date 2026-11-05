#!/usr/bin/env python3
"""Tiny read-only stats service for the Home Screens "Pi Monitor" plugin.

Serves one JSON document at GET /stats with CPU temperature, CPU usage,
memory, swap, disk, load, uptime and Raspberry Pi throttling flags.
Standard library only; no pip install needed.

Environment variables:
  PI_STATS_HOST   address to bind (default 127.0.0.1)
  PI_STATS_PORT   port to bind    (default 8765)
  PI_STATS_DISK   path whose filesystem is reported (default /)
"""

import json
import os
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("PI_STATS_HOST", "127.0.0.1")
PORT = int(os.environ.get("PI_STATS_PORT", "8765"))
DISK_PATH = os.environ.get("PI_STATS_DISK", "/")

SAMPLE_SECONDS = 2.0
THROTTLE_CACHE_SECONDS = 5.0


def read_text(path):
    try:
        with open(path, "r") as f:
            return f.read().strip()
    except OSError:
        return None


# ---- CPU usage: background sampler of /proc/stat deltas ------------------

_cpu_percent = None
_cpu_lock = threading.Lock()


def _read_cpu_times():
    line = (read_text("/proc/stat") or "").splitlines()[0:1]
    if not line:
        return None
    parts = line[0].split()[1:]
    values = [int(p) for p in parts]
    idle = values[3] + (values[4] if len(values) > 4 else 0)  # idle + iowait
    return idle, sum(values)


def _cpu_sampler():
    global _cpu_percent
    prev = _read_cpu_times()
    while True:
        time.sleep(SAMPLE_SECONDS)
        cur = _read_cpu_times()
        if prev and cur:
            d_idle = cur[0] - prev[0]
            d_total = cur[1] - prev[1]
            if d_total > 0:
                with _cpu_lock:
                    _cpu_percent = round(100.0 * (1 - d_idle / d_total), 1)
        prev = cur


# ---- Individual readings --------------------------------------------------

def read_temp_c():
    raw = read_text("/sys/class/thermal/thermal_zone0/temp")
    if raw is None:
        return None
    try:
        return round(int(raw) / 1000.0, 1)
    except ValueError:
        return None


def read_meminfo():
    info = {}
    for line in (read_text("/proc/meminfo") or "").splitlines():
        key, _, rest = line.partition(":")
        fields = rest.split()
        if fields:
            info[key] = int(fields[0]) * 1024  # kB -> bytes
    return info


def memory_block(info):
    total = info.get("MemTotal")
    avail = info.get("MemAvailable")
    if not total or avail is None:
        return None
    used = total - avail
    return {
        "totalBytes": total,
        "usedBytes": used,
        "percent": round(100.0 * used / total, 1),
    }


def swap_block(info):
    total = info.get("SwapTotal", 0)
    if not total:
        return None
    used = total - info.get("SwapFree", 0)
    return {
        "totalBytes": total,
        "usedBytes": used,
        "percent": round(100.0 * used / total, 1),
    }


def disk_block():
    try:
        usage = shutil.disk_usage(DISK_PATH)
    except OSError:
        return None
    return {
        "path": DISK_PATH,
        "totalBytes": usage.total,
        "usedBytes": usage.used,
        "percent": round(100.0 * usage.used / usage.total, 1),
    }


def cpu_freq_mhz():
    raw = read_text("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq")
    try:
        return round(int(raw) / 1000) if raw else None
    except ValueError:
        return None


def pi_model():
    try:
        with open("/proc/device-tree/model", "rb") as f:
            return f.read().decode("utf-8", "replace").strip("\x00").strip()
    except OSError:
        return None


def uptime_seconds():
    raw = read_text("/proc/uptime")
    try:
        return int(float(raw.split()[0])) if raw else None
    except (ValueError, IndexError):
        return None


# ---- Throttling flags (vcgencmd get_throttled), cached --------------------

_throttle_cache = {"at": 0.0, "value": None}


def read_throttle():
    now = time.time()
    if now - _throttle_cache["at"] < THROTTLE_CACHE_SECONDS:
        return _throttle_cache["value"]

    value = None
    exe = shutil.which("vcgencmd") or "/usr/bin/vcgencmd"
    try:
        out = subprocess.run(
            [exe, "get_throttled"], capture_output=True, text=True, timeout=2
        ).stdout.strip()
        raw = int(out.split("=")[1], 16)
        value = {
            "raw": hex(raw),
            "underVoltageNow": bool(raw & (1 << 0)),
            "freqCappedNow": bool(raw & (1 << 1)),
            "throttledNow": bool(raw & (1 << 2)),
            "softTempLimitNow": bool(raw & (1 << 3)),
            "underVoltageEver": bool(raw & (1 << 16)),
            "freqCappedEver": bool(raw & (1 << 17)),
            "throttledEver": bool(raw & (1 << 18)),
            "softTempLimitEver": bool(raw & (1 << 19)),
        }
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        value = None  # vcgencmd missing or not permitted: just omit

    _throttle_cache["at"] = now
    _throttle_cache["value"] = value
    return value


# ---- HTTP ------------------------------------------------------------------

def snapshot():
    mem_info = read_meminfo()
    with _cpu_lock:
        cpu_pct = _cpu_percent
    try:
        load = [round(x, 2) for x in os.getloadavg()]
    except OSError:
        load = None
    return {
        "ok": True,
        "ts": int(time.time() * 1000),
        "model": pi_model(),
        "tempC": read_temp_c(),
        "cpu": {
            "percent": cpu_pct,
            "cores": os.cpu_count(),
            "freqMhz": cpu_freq_mhz(),
            "loadAvg": load,
        },
        "memory": memory_block(mem_info),
        "swap": swap_block(mem_info),
        "disk": disk_block(),
        "uptimeSec": uptime_seconds(),
        "throttle": read_throttle(),
    }


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/stats", "/health"):
            body = json.dumps(
                snapshot() if path != "/health" else {"ok": True}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

    def log_message(self, fmt, *args):  # keep the journal quiet
        pass


def main():
    threading.Thread(target=_cpu_sampler, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"pi-stats listening on http://{HOST}:{PORT}/stats", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
