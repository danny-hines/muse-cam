from __future__ import annotations

import json
import shutil
import socket
from pathlib import Path
from typing import Any


class DeviceSystem:
    def __init__(self, data_dir: Path, *, simulate: bool) -> None:
        self.data_dir = data_dir
        self.simulate = simulate
        self._demo_ssid = "Studio Wi-Fi"
        self._demo_job: dict[str, Any] = {"phase": "idle", "message": ""}

    def request(self, action: str, **values: Any) -> dict[str, Any]:
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
            if type(values.get("hidden", False)) is not bool:
                raise ValueError("Invalid hidden network setting")
        if self.simulate:
            if action == "wifi-scan":
                return {
                    "networks": [
                        {
                            "ssid": ssid,
                            "signal": signal,
                            "security": security,
                            "active": ssid == self._demo_ssid,
                        }
                        for ssid, signal, security in [
                            ("Studio Wi-Fi", 91, "WPA2"),
                            ("Office Guest", 78, "WPA2"),
                            ("Cafe", 55, ""),
                        ]
                    ]
                }
            if action == "wifi-connect":
                self._demo_ssid = values["ssid"]
                self._demo_job = {
                    "phase": "complete",
                    "kind": "wifi",
                    "message": "Connected (simulator)",
                }
                return self._demo_job
            if action == "update-check":
                return {
                    "current": "simulator",
                    "available": False,
                    "message": "Simulator is up to date",
                }
            if action == "update-apply":
                raise ValueError("Updates run on the camera")
            return {
                "hostname": "musecam-simulator",
                "addresses": ["127.0.0.1"],
                "ssid": self._demo_ssid,
                "job": self._demo_job,
                "version": "simulator",
            }
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                connection.settimeout(30)
                connection.connect("/run/musecam-control/control.sock")
                connection.sendall((json.dumps({"action": action, **values}) + "\n").encode())
                response = bytearray()
                while b"\n" not in response:
                    chunk = connection.recv(4096)
                    if not chunk:
                        raise OSError("Control service disconnected")
                    response.extend(chunk)
                    if len(response) > 131072:
                        raise OSError("Control response too large")
            result = json.loads(response.split(b"\n", 1)[0])
            if "error" in result:
                raise ValueError(result["error"])
            return result
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError(
                "Device settings service is unavailable. Restart the camera."
            ) from error

    def storage(self) -> dict[str, int]:
        usage = shutil.disk_usage(self.data_dir)
        return {"total": usage.total, "used": usage.used, "free": usage.free}
