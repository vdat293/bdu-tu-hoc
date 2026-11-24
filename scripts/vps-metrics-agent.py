#!/usr/bin/env python3
"""Lightweight read-only VPS telemetry collector for BDU Admin Dashboard.

Collects host CPU, RAM/Swap, disk, Docker container stats/storage, systemd
service health, TLS cert expiry, network throughput, and top memory processes,
then writes an atomic JSON snapshot for read-only container consumption.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import re
import signal
import socket
import subprocess
import sys
import time

DEFAULT_OUT_PATH = "/opt/bdu-tu-hoc/data/vps-telemetry/snapshot.json"
DEFAULT_DATA_DIR = "/opt/bdu-tu-hoc/data"
DEFAULT_CERT_PATH = "/etc/caddy/certs/origin.pem"
HISTORY_LIMIT = 60

_RUNNING = True
_SIZE_RE = re.compile(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]+)?\s*$")


def _handle_signal(_signum, _frame):
    global _RUNNING
    _RUNNING = False


def parse_size_to_mb(raw: str) -> float:
    m = _SIZE_RE.match(str(raw or ""))
    if not m:
        return 0.0
    val = float(m.group(1))
    unit = (m.group(2) or "b").lower()
    if unit in ("b",):
        return round(val / (1024 * 1024), 2)
    if unit in ("kb", "kib", "k"):
        return round(val / 1024, 2)
    if unit in ("mb", "mib", "m"):
        return round(val, 2)
    if unit in ("gb", "gib", "g"):
        return round(val * 1024, 2)
    if unit in ("tb", "tib", "t"):
        return round(val * 1024 * 1024, 2)
    return round(val, 2)


def parse_percent(raw: str) -> float:
    try:
        return round(float(str(raw or "0").replace("%", "").strip()), 2)
    except ValueError:
        return 0.0


def run_cmd(args: list[str], timeout: float = 6.0) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return proc.returncode, (proc.stdout or "").strip()
    except Exception:
        return 1, ""


def parse_json_lines(raw: str) -> list[dict]:
    if not raw:
        return []
    stripped = raw.strip()
    if stripped.startswith("["):
        try:
            data = json.loads(stripped)
            return data if isinstance(data, list) else []
        except Exception:
            return []
    items: list[dict] = []
    for line in stripped.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                items.append(obj)
        except Exception:
            continue
    return items


def read_os_info() -> dict:
    pretty = platform.platform()
    os_release = Path("/etc/os-release")
    if os_release.exists():
        for line in os_release.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.startswith("PRETTY_NAME="):
                pretty = line.split("=", 1)[1].strip().strip('"')
                break
    uptime_sec = 0
    uptime_file = Path("/proc/uptime")
    if uptime_file.exists():
        try:
            uptime_sec = int(float(uptime_file.read_text(encoding="utf-8").split()[0]))
        except Exception:
            pass
    return {
        "hostname": socket.gethostname(),
        "os": pretty,
        "kernel": platform.release(),
        "arch": platform.machine(),
        "uptimeSeconds": uptime_sec,
    }


def read_cpu_model() -> str:
    cpuinfo = Path("/proc/cpuinfo")
    if cpuinfo.exists():
        for line in cpuinfo.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.lower().startswith("model name") and ":" in line:
                return line.split(":", 1)[1].strip()
    return "x86_64"


def read_proc_stat_totals() -> tuple[int, int, int, int, int] | None:
    stat_file = Path("/proc/stat")
    if not stat_file.exists():
        return None
    for line in stat_file.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.startswith("cpu "):
            parts = [int(x) for x in line.split()[1:9] if x.isdigit()]
            if len(parts) < 5:
                return None
            user = parts[0] + parts[1]
            system = parts[2] + (parts[5] if len(parts) > 5 else 0) + (parts[6] if len(parts) > 6 else 0)
            idle = parts[3]
            iowait = parts[4]
            total = sum(parts)
            return total, user, system, idle, iowait
    return None


def compute_cpu_metrics(prev_stat, curr_stat, cpu_model: str) -> dict:
    try:
        load1, load5, load15 = os.getloadavg()
    except OSError:
        load1, load5, load15 = 0.0, 0.0, 0.0

    usage_pct = 0.0
    user_pct = 0.0
    system_pct = 0.0
    iowait_pct = 0.0

    if prev_stat and curr_stat:
        dt = max(1, curr_stat[0] - prev_stat[0])
        d_user = max(0, curr_stat[1] - prev_stat[1])
        d_sys = max(0, curr_stat[2] - prev_stat[2])
        d_idle = max(0, curr_stat[3] - prev_stat[3])
        d_iowait = max(0, curr_stat[4] - prev_stat[4])
        usage_pct = round(max(0.0, min(100.0, ((dt - d_idle - d_iowait) / dt) * 100.0)), 1)
        user_pct = round((d_user / dt) * 100.0, 1)
        system_pct = round((d_sys / dt) * 100.0, 1)
        iowait_pct = round((d_iowait / dt) * 100.0, 1)

    return {
        "model": cpu_model,
        "cores": os.cpu_count() or 1,
        "usagePct": usage_pct,
        "userPct": user_pct,
        "systemPct": system_pct,
        "iowaitPct": iowait_pct,
        "loadAvg": [round(load1, 2), round(load5, 2), round(load15, 2)],
    }


def read_memory_metrics() -> dict:
    kv: dict[str, int] = {}
    meminfo = Path("/proc/meminfo")
    if meminfo.exists():
        for line in meminfo.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r"^([A-Za-z0-9_()]+):\s+(\d+)\s*kB", line)
            if m:
                kv[m.group(1)] = int(m.group(2))

    total_kb = kv.get("MemTotal", 0)
    free_kb = kv.get("MemFree", 0)
    avail_kb = kv.get("MemAvailable", free_kb)
    buffers_kb = kv.get("Buffers", 0)
    cached_kb = kv.get("Cached", 0) + kv.get("SReclaimable", 0)
    used_kb = max(0, total_kb - avail_kb)

    swap_total_kb = kv.get("SwapTotal", 0)
    swap_free_kb = kv.get("SwapFree", 0)
    swap_used_kb = max(0, swap_total_kb - swap_free_kb)

    return {
        "totalMb": round(total_kb / 1024),
        "usedMb": round(used_kb / 1024),
        "freeMb": round(free_kb / 1024),
        "availableMb": round(avail_kb / 1024),
        "buffersMb": round(buffers_kb / 1024),
        "cachedMb": round(cached_kb / 1024),
        "usedPct": round((used_kb / total_kb) * 100, 1) if total_kb > 0 else 0.0,
        "swapTotalMb": round(swap_total_kb / 1024),
        "swapUsedMb": round(swap_used_kb / 1024),
        "swapFreeMb": round(swap_free_kb / 1024),
        "swapPct": round((swap_used_kb / swap_total_kb) * 100, 1) if swap_total_kb > 0 else 0.0,
    }


def read_disk_root() -> dict:
    rc, out = run_cmd(["df", "-B1", "/"], timeout=4.0)
    if rc == 0 and out:
        lines = out.splitlines()
        if len(lines) >= 2:
            cols = lines[1].split()
            if len(cols) >= 6:
                total_b = int(cols[1])
                used_b = int(cols[2])
                avail_b = int(cols[3])
                pct = round((used_b / total_b) * 100, 1) if total_b > 0 else 0.0
                return {
                    "filesystem": cols[0],
                    "mount": cols[5],
                    "totalGb": round(total_b / (1024 ** 3), 2),
                    "usedGb": round(used_b / (1024 ** 3), 2),
                    "availGb": round(avail_b / (1024 ** 3), 2),
                    "usedPct": pct,
                }
    st = os.statvfs("/")
    total_b = st.f_blocks * st.f_frsize
    avail_b = st.f_bavail * st.f_frsize
    used_b = max(0, total_b - avail_b)
    return {
        "filesystem": "/",
        "mount": "/",
        "totalGb": round(total_b / (1024 ** 3), 2),
        "usedGb": round(used_b / (1024 ** 3), 2),
        "availGb": round(avail_b / (1024 ** 3), 2),
        "usedPct": round((used_b / total_b) * 100, 1) if total_b > 0 else 0.0,
    }


def read_data_dirs(data_dir: str) -> list[dict]:
    base = Path(data_dir)
    if not base.exists() or not base.is_dir():
        return []
    subdirs = [str(p) for p in sorted(base.iterdir()) if p.is_dir()]
    if not subdirs:
        return []
    rc, out = run_cmd(["du", "-s", "-B1", *subdirs], timeout=8.0)
    if rc != 0 or not out:
        return []
    rows = []
    for line in out.splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[0].isdigit():
            size_mb = round(int(parts[0]) / (1024 * 1024), 1)
            rows.append({"name": Path(parts[1]).name, "sizeMb": size_mb})
    rows.sort(key=lambda r: r["sizeMb"], reverse=True)
    return rows


def extract_health(status_text: str) -> str:
    low = (status_text or "").lower()
    if "(healthy)" in low:
        return "healthy"
    if "(unhealthy)" in low:
        return "unhealthy"
    if "(health: starting)" in low:
        return "starting"
    return ""


def read_docker_containers() -> list[dict]:
    rc_ps, out_ps = run_cmd(["docker", "ps", "-a", "--format", "json"], timeout=6.0)
    rc_st, out_st = run_cmd(["docker", "stats", "--no-stream", "--format", "json"], timeout=8.0)

    ps_rows = parse_json_lines(out_ps) if rc_ps == 0 else []
    st_rows = parse_json_lines(out_st) if rc_st == 0 else []

    stats_by_name: dict[str, dict] = {}
    for row in st_rows:
        name = row.get("Name") or row.get("Container") or ""
        if name:
            stats_by_name[name] = row

    containers: list[dict] = []
    for row in ps_rows:
        name = row.get("Names") or row.get("Name") or ""
        st = stats_by_name.get(name, {})
        mem_usage = st.get("MemUsage", "")
        mem_parts = [p.strip() for p in mem_usage.split("/")] if "/" in mem_usage else []
        mem_used_mb = parse_size_to_mb(mem_parts[0]) if len(mem_parts) >= 1 else 0.0
        mem_limit_mb = parse_size_to_mb(mem_parts[1]) if len(mem_parts) >= 2 else 0.0
        status_text = row.get("Status", "")
        pids_raw = str(st.get("PIDs", "0")).strip()
        containers.append(
            {
                "name": name,
                "image": row.get("Image", ""),
                "state": (row.get("State") or "").lower(),
                "status": status_text,
                "health": extract_health(status_text),
                "cpuPct": parse_percent(st.get("CPUPerc", "0")),
                "memUsedMb": mem_used_mb,
                "memLimitMb": mem_limit_mb,
                "memPct": parse_percent(st.get("MemPerc", "0")),
                "netIO": st.get("NetIO", "--"),
                "blockIO": st.get("BlockIO", "--"),
                "pids": int(pids_raw) if pids_raw.isdigit() else 0,
            }
        )
    containers.sort(key=lambda c: c["memUsedMb"], reverse=True)
    return containers


def read_docker_storage() -> list[dict]:
    rc, out = run_cmd(["docker", "system", "df", "--format", "json"], timeout=8.0)
    if rc != 0 or not out:
        return []
    rows = []
    for item in parse_json_lines(out):
        rows.append(
            {
                "type": item.get("Type", ""),
                "total": int(item.get("TotalCount", 0) or 0),
                "active": int(item.get("Active", 0) or 0),
                "size": item.get("Size", "0B"),
                "reclaimable": item.get("Reclaimable", "0B"),
            }
        )
    return rows


def read_systemd_status(name: str) -> str:
    rc, out = run_cmd(["systemctl", "is-active", name], timeout=3.0)
    return out.splitlines()[0].strip() if out else ("active" if rc == 0 else "unknown")


def read_cert_days_remaining(cert_path: str) -> int | None:
    if not Path(cert_path).exists():
        return None
    rc, out = run_cmd(["openssl", "x509", "-enddate", "-noout", "-in", cert_path], timeout=3.0)
    if rc != 0 or "=" not in out:
        return None
    raw_date = out.split("=", 1)[1].strip()
    for fmt in ("%b %d %H:%M:%S %Y %Z", "%b  %d %H:%M:%S %Y %Z"):
        try:
            exp = datetime.strptime(raw_date, fmt).replace(tzinfo=timezone.utc)
            delta = exp - datetime.now(timezone.utc)
            return max(0, delta.days)
        except ValueError:
            continue
    return None


def read_top_processes(limit: int = 10) -> list[dict]:
    rc, out = run_cmd(["ps", "-eo", "pid,comm,%mem,%cpu,rss", "--sort=-rss"], timeout=4.0)
    if rc != 0 or not out:
        return []
    procs = []
    for line in out.splitlines()[1 : limit + 1]:
        cols = line.split(None, 4)
        if len(cols) < 5:
            continue
        # Format: pid, comm (might have space? usually no for comm, use rsplit)
        parts = line.rsplit(None, 3)
        head = parts[0].split(None, 1)
        if len(head) < 2:
            continue
        try:
            procs.append(
                {
                    "pid": int(head[0]),
                    "command": head[1].strip(),
                    "memPct": float(parts[1]),
                    "cpuPct": float(parts[2]),
                    "rssMb": round(int(parts[3]) / 1024, 1),
                }
            )
        except ValueError:
            continue
    return procs


def read_net_counters() -> tuple[str, int, int] | None:
    net_file = Path("/proc/net/dev")
    if not net_file.exists():
        return None
    best = None
    for line in net_file.read_text(encoding="utf-8", errors="ignore").splitlines()[2:]:
        if ":" not in line:
            continue
        iface, data = line.split(":", 1)
        iface = iface.strip()
        if iface == "lo" or iface.startswith(("veth", "br-", "docker")):
            continue
        cols = data.split()
        if len(cols) < 10:
            continue
        rx_b, tx_b = int(cols[0]), int(cols[8])
        if best is None or (rx_b + tx_b) > (best[1] + best[2]):
            best = (iface, rx_b, tx_b)
    return best


def compute_network_metrics(prev_net, curr_net, elapsed_s: float) -> dict | None:
    if not curr_net:
        return None
    iface, rx_b, tx_b = curr_net
    rx_kbps = 0.0
    tx_kbps = 0.0
    if prev_net and prev_net[0] == iface and elapsed_s > 0.1:
        rx_kbps = round(max(0, rx_b - prev_net[1]) / 1024.0 / elapsed_s, 1)
        tx_kbps = round(max(0, tx_b - prev_net[2]) / 1024.0 / elapsed_s, 1)
    return {
        "interface": iface,
        "rxTotalMb": round(rx_b / (1024 * 1024), 1),
        "txTotalMb": round(tx_b / (1024 * 1024), 1),
        "rxKbps": rx_kbps,
        "txKbps": tx_kbps,
    }


def write_atomic_json(out_path: str, payload: dict) -> None:
    target = Path(out_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target.with_name(f".{target.name}.tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.chmod(tmp_path, 0o644)
    os.replace(tmp_path, target)


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only BDU VPS metrics agent")
    parser.add_argument("--out", default=os.environ.get("VPS_TELEMETRY_OUT", DEFAULT_OUT_PATH))
    parser.add_argument("--data-dir", default=os.environ.get("VPS_DATA_DIR", DEFAULT_DATA_DIR))
    parser.add_argument("--cert", default=os.environ.get("VPS_CERT_PATH", DEFAULT_CERT_PATH))
    parser.add_argument("--interval", type=float, default=float(os.environ.get("VPS_POLL_INTERVAL", "10")))
    parser.add_argument("--once", action="store_true", help="Collect one snapshot and exit")
    args = parser.parse_args()

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    cpu_model = read_cpu_model()
    prev_stat = read_proc_stat_totals()
    prev_net = read_net_counters()
    prev_ts = time.monotonic()

    if args.once:
        time.sleep(0.35)

    cached_storage: list[dict] = []
    cached_dirs: list[dict] = []
    last_slow_check = 0.0

    cached_cert_days: int | None = None
    last_cert_check = 0.0

    history: list[dict] = []
    out_file = Path(args.out)
    if out_file.exists():
        try:
            old = json.loads(out_file.read_text(encoding="utf-8"))
            if isinstance(old.get("history"), list):
                history = old["history"][-HISTORY_LIMIT:]
        except Exception:
            pass

    while _RUNNING:
        now_mono = time.monotonic()
        elapsed = max(0.2, now_mono - prev_ts)

        curr_stat = read_proc_stat_totals()
        curr_net = read_net_counters()

        cpu = compute_cpu_metrics(prev_stat, curr_stat, cpu_model)
        memory = read_memory_metrics()
        network = compute_network_metrics(prev_net, curr_net, elapsed)
        prev_stat = curr_stat
        prev_net = curr_net
        prev_ts = now_mono

        if now_mono - last_slow_check >= 60.0 or not cached_storage:
            cached_storage = read_docker_storage()
            cached_dirs = read_data_dirs(args.data_dir)
            last_slow_check = now_mono

        if now_mono - last_cert_check >= 600.0 or last_cert_check == 0.0:
            cached_cert_days = read_cert_days_remaining(args.cert)
            last_cert_check = now_mono

        now_iso = datetime.now(timezone.utc).isoformat()
        history.append(
            {
                "at": now_iso,
                "cpuPct": cpu["usagePct"],
                "ramUsedPct": memory["usedPct"],
                "ramUsedMb": memory["usedMb"],
                "swapUsedMb": memory["swapUsedMb"],
                "load1": cpu["loadAvg"][0],
            }
        )
        history = history[-HISTORY_LIMIT:]

        payload = {
            "collectedAt": now_iso,
            "intervalSeconds": args.interval,
            "host": read_os_info(),
            "cpu": cpu,
            "memory": memory,
            "disk": {
                "root": read_disk_root(),
                "dataDirs": cached_dirs,
            },
            "docker": {
                "containers": read_docker_containers(),
                "storage": cached_storage,
            },
            "services": {
                "caddy": read_systemd_status("caddy"),
                "docker": read_systemd_status("docker"),
                "fail2ban": read_systemd_status("fail2ban"),
                "certDaysRemaining": cached_cert_days,
            },
            "topProcesses": read_top_processes(10),
            "network": network,
            "history": history,
        }

        try:
            write_atomic_json(args.out, payload)
        except Exception as exc:
            print(f"[bdu-vps-agent] write error: {exc}", file=sys.stderr)

        if args.once:
            break

        sleep_left = max(1.0, args.interval - (time.monotonic() - now_mono))
        while _RUNNING and sleep_left > 0:
            step = min(1.0, sleep_left)
            time.sleep(step)
            sleep_left -= step

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
