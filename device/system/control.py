#!/usr/bin/env python3
"""Root-owned, local Unix-socket service with a fixed set of device operations.

Wi-Fi passwords travel in the local socket and NetworkManager D-Bus messages,
never shell commands, process arguments, responses, or application logs.
"""

from __future__ import annotations

import grp
import json
import os
import socket
import socketserver
import subprocess
import threading
import time
import uuid
from pathlib import Path

REPO = Path("/opt/muse-cam")
SOCKET = Path("/run/musecam-control/control.sock")
JOB_FILE = Path("/var/lib/musecam-control/job.json")
LOCK = threading.RLock()
JOB = {"phase": "idle", "message": ""}


def run(*args: str, timeout: int = 20) -> str:
    # The daemon keeps its own state private, but installed code must be readable
    # by the unprivileged camera user. Git/pip otherwise inherit UMask=0077.
    result = subprocess.run(
        args, capture_output=True, text=True, timeout=timeout, check=True, umask=0o022
    )
    return result.stdout.strip()


def git(*args: str, timeout: int = 25) -> str:
    return run("git", "-C", str(REPO), *args, timeout=timeout)


def fields(line: str) -> list[str]:
    result, word, escaped = [], "", False
    for char in line:
        if escaped:
            word += char
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == ":":
            result.append(word)
            word = ""
        else:
            word += char
    result.append(word)
    return result


def wifi_scan(*, rescan: bool = True) -> dict:
    output = run(
        "nmcli",
        "-t",
        "-f",
        "IN-USE,SSID,SIGNAL,SECURITY",
        "device",
        "wifi",
        "list",
        "ifname",
        "wlan0",
        "--rescan",
        "auto" if rescan else "no",
        timeout=15,
    )
    networks = {}
    for line in output.splitlines():
        row = fields(line)
        if len(row) != 4 or not row[1]:
            continue
        active, ssid, signal, security = row
        item = {"ssid": ssid, "signal": int(signal), "security": security, "active": active == "*"}
        if ssid not in networks or item["signal"] > networks[ssid]["signal"] or item["active"]:
            networks[ssid] = item
    return {"networks": sorted(networks.values(), key=lambda x: (not x["active"], -x["signal"]))}


def set_job(phase: str, message: str, *, kind: str | None = None) -> dict:
    with LOCK:
        JOB.update(phase=phase, message=message)
        if kind:
            JOB["kind"] = kind
        JOB_FILE.parent.mkdir(parents=True, exist_ok=True)
        temporary = JOB_FILE.with_suffix(".tmp")
        temporary.write_text(json.dumps(JOB))
        temporary.replace(JOB_FILE)
        return dict(JOB)


def status() -> dict:
    try:
        addresses = run("hostname", "-I").split()
        ssid = run("nmcli", "-g", "GENERAL.CONNECTION", "device", "show", "wlan0")
        # Read the actual SSID, which can differ from the saved connection name.
        active = [x for x in wifi_scan(rescan=False)["networks"] if x["active"]]
        if active:
            ssid = active[0]["ssid"]
        version = git("rev-parse", "--short", "HEAD")
    except (OSError, subprocess.SubprocessError):
        addresses, ssid, version = [], "Unavailable", "unknown"
    with LOCK:
        return {
            "hostname": socket.gethostname(),
            "addresses": addresses,
            "ssid": ssid,
            "version": version,
            "job": dict(JOB),
        }


def update_check() -> dict:
    current = git("rev-parse", "HEAD")
    if git("status", "--porcelain"):
        return {
            "current": current[:8],
            "available": False,
            "message": "Local development changes are installed. Update after they are saved.",
            "blocked": True,
        }
    git("fetch", "--quiet", "origin", "main")
    latest = git("rev-parse", "origin/main")
    if latest == current:
        return {"current": current[:8], "available": False, "message": "You’re up to date"}
    relation = subprocess.run(
        ["git", "-C", str(REPO), "merge-base", "--is-ancestor", current, latest],
        capture_output=True,
        timeout=10,
    )
    if relation.returncode:
        return {
            "current": current[:8],
            "available": False,
            "message": "This camera has a development build ahead of the release channel.",
        }
    return {
        "current": current[:8],
        "latest": latest[:8],
        "available": True,
        "message": "An update is ready to install",
    }


def wifi_connect(values: dict) -> None:
    # Import here: the simulator and workstation tests do not require D-Bus.
    import dbus

    ssid, password = values["ssid"], values.get("password", "")
    previous = run("nmcli", "-g", "GENERAL.CON-UUID", "device", "show", "wlan0")
    new_path = None
    bus = dbus.SystemBus()
    manager = dbus.Interface(
        bus.get_object(
            "org.freedesktop.NetworkManager", "/org/freedesktop/NetworkManager/Settings"
        ),
        "org.freedesktop.NetworkManager.Settings",
    )
    try:
        # Reuse saved networks when no replacement password was supplied.
        selected = None
        for path in manager.ListConnections():
            connection = dbus.Interface(
                bus.get_object("org.freedesktop.NetworkManager", path),
                "org.freedesktop.NetworkManager.Settings.Connection",
            )
            settings = connection.GetSettings()
            if bytes(settings.get("802-11-wireless", {}).get("ssid", [])) == ssid.encode():
                if not password:
                    selected = str(settings["connection"]["uuid"])
                    break
        if selected is None:
            selected = str(uuid.uuid4())
            profile = {
                "connection": {
                    "id": f"MuseCam {ssid}",
                    "uuid": selected,
                    "type": "802-11-wireless",
                    "autoconnect": True,
                },
                "802-11-wireless": {
                    "ssid": dbus.ByteArray(ssid.encode()),
                    "mode": "infrastructure",
                    "hidden": bool(values.get("hidden", False)),
                },
                "ipv4": {"method": "auto"},
                "ipv6": {"method": "auto"},
            }
            if password:
                profile["802-11-wireless-security"] = {"key-mgmt": "wpa-psk", "psk": password}
            new_path = manager.AddConnection(profile)
        run(
            "nmcli",
            "--wait",
            "35",
            "connection",
            "up",
            "uuid",
            selected,
            "ifname",
            "wlan0",
            timeout=40,
        )
        set_job("complete", f"Connected to {ssid}", kind="wifi")
    except Exception:
        if new_path is not None:
            try:
                dbus.Interface(
                    bus.get_object("org.freedesktop.NetworkManager", new_path),
                    "org.freedesktop.NetworkManager.Settings.Connection",
                ).Delete()
            except Exception:
                pass
        restored = False
        if previous and previous != "--":
            try:
                run("nmcli", "--wait", "20", "connection", "up", "uuid", previous, timeout=25)
                restored = True
            except (OSError, subprocess.SubprocessError):
                pass
        set_job(
            "failed",
            "Could not connect. Check the network and password. "
            + ("Previous Wi-Fi restored." if restored else "Choose another network to reconnect."),
            kind="wifi",
        )


def apply_update() -> None:
    previous = None
    stopped = False
    try:
        result = update_check()
        if not result.get("available"):
            set_job("complete", result["message"], kind="update")
            return
        require_camera_idle()
        previous = git("rev-parse", "HEAD")
        set_job("running", "Installing update. The camera will restart.", kind="update")
        run("systemctl", "stop", "musecam.service", timeout=25)
        stopped = True
        git("merge", "--ff-only", "origin/main")
        run(
            str(REPO / ".venv/bin/pip"),
            "install",
            "--disable-pip-version-check",
            str(REPO / "device"),
            timeout=180,
        )
        # The release includes prebuilt touchscreen assets. No Node build runs on the Pi.
        run(str(REPO / ".venv/bin/python"), "-c", "import musecam.webapp; import musecam.audio")
        if not (REPO / "device/src/musecam/static/index.html").is_file():
            raise RuntimeError("Missing touchscreen build")
        run("systemctl", "start", "musecam.service", "musecam-kiosk.service", timeout=30)
        wait_for_camera()
        install_control_service()
        set_job("complete", "Update installed. Camera is ready.", kind="update")
        # Restart this helper only after its completed job is safely persisted.
        run(
            "systemd-run",
            "--quiet",
            "--collect",
            "--on-active=3s",
            "/bin/systemctl",
            "restart",
            "musecam-control.service",
        )
    except Exception:
        restored = False
        if previous and stopped:
            try:
                git("reset", "--hard", previous)
                run(
                    str(REPO / ".venv/bin/pip"),
                    "install",
                    "--disable-pip-version-check",
                    str(REPO / "device"),
                    timeout=180,
                )
                run("systemctl", "start", "musecam.service", "musecam-kiosk.service", timeout=30)
                wait_for_camera()
                install_control_service()
                restored = True
            except Exception:
                pass
        set_job(
            "failed",
            "Update failed. "
            + (
                "Previous version restored."
                if restored
                else "No update completed. Restart or check the connection."
            ),
            kind="update",
        )


def install_control_service() -> None:
    run(
        "install",
        "-m",
        "755",
        str(REPO / "device/system/control.py"),
        "/usr/local/lib/musecam/control.py",
    )
    run(
        "install",
        "-m",
        "644",
        str(REPO / "device/systemd/musecam-control.service"),
        "/etc/systemd/system/musecam-control.service",
    )
    run("systemctl", "daemon-reload")


def require_camera_idle() -> None:
    import urllib.request

    with urllib.request.urlopen("http://127.0.0.1:8080/api/state", timeout=3) as response:
        state = json.load(response)
    if (
        state.get("status") != "live"
        or state.get("queued")
        or state.get("processingId")
        or state.get("sharingId")
        or not state.get("maintenance")
    ):
        raise ValueError("Camera must be idle and in update mode")


def wait_for_camera() -> None:
    import urllib.request

    deadline = time.monotonic() + 55
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen("http://127.0.0.1:8080/api/state", timeout=2) as response:
                state = json.load(response)
                if state["status"] == "live":
                    return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("Camera did not start")


def handle(values: dict) -> dict:
    action = values.get("action")
    if action == "status":
        return status()
    if action == "wifi-scan":
        return wifi_scan()
    if action == "update-check":
        with LOCK:
            if JOB["phase"] == "running":
                raise ValueError("A device operation is already running")
            return update_check()
    if action == "wifi-connect":
        ssid, password = values.get("ssid"), values.get("password", "")
        if (
            not isinstance(ssid, str)
            or not 1 <= len(ssid.encode()) <= 32
            or any(ord(c) < 32 for c in ssid)
        ):
            raise ValueError("Enter a Wi-Fi name between 1 and 32 bytes")
        if not isinstance(password, str) or (password and not 8 <= len(password) <= 63):
            raise ValueError("Wi-Fi passwords must have 8–63 characters")

        def target() -> None:
            wifi_connect(values)
    elif action == "update-apply":
        target = apply_update
    else:
        raise ValueError("Unsupported device operation")
    with LOCK:
        if JOB["phase"] == "running":
            raise ValueError("A device operation is already running")
        kind = "wifi" if action == "wifi-connect" else "update"
        JOB["id"] = str(uuid.uuid4())
        set_job(
            "running", "Connecting to Wi-Fi…" if kind == "wifi" else "Preparing update…", kind=kind
        )

        def execute() -> None:
            try:
                target()
            except Exception:
                set_job("failed", "Device operation failed. Please try again.", kind=kind)

        threading.Thread(target=execute, daemon=True).start()
        return dict(JOB)


class Handler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        self.connection.settimeout(35)
        try:
            raw = self.rfile.readline(8193)
            if len(raw) > 8192:
                raise ValueError("Request too large")
            values = json.loads(raw)
            if not isinstance(values, dict):
                raise ValueError("Invalid request")
            response = handle(values)
        except ValueError as error:
            response = {"error": str(error)}
        except Exception:
            response = {"error": "Device operation failed. Check the network and try again."}
        self.wfile.write((json.dumps(response) + "\n").encode())


if __name__ == "__main__":
    if JOB_FILE.exists():
        try:
            JOB.update(json.loads(JOB_FILE.read_text()))
            if JOB.get("phase") == "running":
                set_job("failed", "Operation interrupted by a restart. Please try again.")
        except (OSError, ValueError):
            pass
    SOCKET.parent.mkdir(parents=True, exist_ok=True)
    SOCKET.unlink(missing_ok=True)
    with socketserver.ThreadingUnixStreamServer(str(SOCKET), Handler) as server:
        os.chown(SOCKET, 0, grp.getgrnam("musecam").gr_gid)
        os.chmod(SOCKET, 0o660)
        server.serve_forever()
