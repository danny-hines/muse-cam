from __future__ import annotations

import re
import socket
from pathlib import Path
from typing import Protocol


class Battery(Protocol):
    def percentage(self) -> int | None: ...


class NoBattery:
    def percentage(self) -> int | None:
        return None


class PiSugarBattery:
    def __init__(self, socket_path: Path = Path("/tmp/pisugar-server.sock")) -> None:
        self._socket_path = socket_path

    def percentage(self) -> int | None:
        if not self._socket_path.exists():
            return None
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(0.25)
        try:
            client.connect(str(self._socket_path))
            client.sendall(b"get battery\n")
            response = client.recv(128).decode("utf-8", errors="replace")
        except OSError:
            return None
        finally:
            client.close()

        match = re.search(r"battery:\s*([0-9]+(?:\.[0-9]+)?)", response)
        if not match:
            return None
        return max(0, min(100, round(float(match.group(1)))))


def create_battery(enabled: bool) -> Battery:
    return PiSugarBattery() if enabled else NoBattery()
