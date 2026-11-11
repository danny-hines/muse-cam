from __future__ import annotations

import importlib.util
import subprocess
import sys
import types
from pathlib import Path

import pytest


def load_control(tmp_path: Path):
    path = Path(__file__).parents[1] / "system/control.py"
    spec = importlib.util.spec_from_file_location("musecam_test_control", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.JOB_FILE = tmp_path / "job.json"
    return module


def test_wifi_failure_restores_saved_connection_without_exposing_password(tmp_path, monkeypatch):
    control = load_control(tmp_path)
    operations, profiles = [], []
    deleted = []

    class Manager:
        def ListConnections(self):
            return []

        def AddConnection(self, settings):
            profiles.append(settings)
            return "/new-network"

        def Delete(self):
            deleted.append(True)

    manager = Manager()
    monkeypatch.setitem(
        sys.modules,
        "dbus",
        types.SimpleNamespace(
            SystemBus=lambda: types.SimpleNamespace(get_object=lambda *args: manager),
            Interface=lambda obj, name: obj,
            ByteArray=bytes,
        ),
    )

    def run(*args, **kwargs):
        operations.append(args)
        if "GENERAL.CON-UUID" in args:
            return "saved-home-uuid"
        if "up" in args and "saved-home-uuid" not in args:
            raise subprocess.CalledProcessError(10, args)
        return ""

    monkeypatch.setattr(control, "run", run)
    control.wifi_connect({"ssid": "New office", "password": "test-password-123"})
    assert profiles[0]["802-11-wireless-security"]["psk"] == "test-password-123"
    assert "test-password-123" not in repr(operations)
    assert deleted
    assert any("up" in op and "saved-home-uuid" in op for op in operations)
    assert control.JOB["phase"] == "failed"
    assert "restored" in control.JOB["message"]
    assert "test-password-123" not in control.JOB_FILE.read_text()


def test_saved_wifi_reconnect_reuses_profile(tmp_path, monkeypatch):
    control = load_control(tmp_path)
    operations = []

    class Manager:
        def ListConnections(self):
            return ["/saved"]

        def GetSettings(self):
            return {"802-11-wireless": {"ssid": b"Studio"}, "connection": {"uuid": "saved-uuid"}}

        def AddConnection(self, settings):
            pytest.fail("Existing Wi-Fi should be reused")

    manager = Manager()
    monkeypatch.setitem(
        sys.modules,
        "dbus",
        types.SimpleNamespace(
            SystemBus=lambda: types.SimpleNamespace(get_object=lambda *args: manager),
            Interface=lambda obj, name: obj,
            ByteArray=bytes,
        ),
    )

    def run(*args, **kwargs):
        operations.append(args)
        return "saved-uuid" if "GENERAL.CON-UUID" in args else ""

    monkeypatch.setattr(control, "run", run)
    control.wifi_connect({"ssid": "Studio", "password": ""})
    assert any("up" in op and "saved-uuid" in op for op in operations)
    assert control.JOB["phase"] == "complete"


class SavedProfile:
    def __init__(self, ssid, uuid, timestamp=0, mode="infrastructure"):
        self.settings = {
            "802-11-wireless": {"ssid": ssid.encode(), "mode": mode},
            "connection": {"uuid": uuid, "timestamp": timestamp},
        }
        self.deleted = False

    def GetSettings(self):
        return self.settings

    def Delete(self):
        self.deleted = True


def fake_network_manager(monkeypatch, profiles, added=None):
    objects = {f"/{i}": profile for i, profile in enumerate(profiles)}

    class Manager:
        def ListConnections(self):
            return [path for path, profile in objects.items() if not profile.deleted]

        def AddConnection(self, settings):
            if added is None:
                pytest.fail("Existing Wi-Fi should be reused")
            added.append(settings)
            ssid = bytes(settings["802-11-wireless"]["ssid"]).decode()
            objects["/new"] = SavedProfile(ssid, settings["connection"]["uuid"], 99)
            return "/new"

    manager = Manager()
    monkeypatch.setitem(
        sys.modules,
        "dbus",
        types.SimpleNamespace(
            SystemBus=lambda: types.SimpleNamespace(
                get_object=lambda _, path: manager if "Settings" in path else objects[path]
            ),
            Interface=lambda obj, name: obj,
            ByteArray=bytes,
        ),
    )
    return objects


def test_scan_marks_every_saved_network(tmp_path, monkeypatch):
    control = load_control(tmp_path)
    fake_network_manager(
        monkeypatch,
        [
            SavedProfile("Home", "a"),
            SavedProfile("Office", "b"),
            SavedProfile("Office", "c"),
            SavedProfile("Camera hotspot", "d", mode="ap"),
        ],
    )
    monkeypatch.setattr(
        control,
        "run",
        lambda *args, **kwargs: "*:Home:80:WPA2\n :Cafe:60:\n :Office:40:WPA2",
    )
    result = control.handle({"action": "wifi-scan"})
    assert result["saved"] == ["Home", "Office"]
    assert {x["ssid"]: x["saved"] for x in result["networks"]} == {
        "Home": True,
        "Cafe": False,
        "Office": True,
    }


def test_new_password_replaces_old_profile_only_after_it_works(tmp_path, monkeypatch):
    control = load_control(tmp_path)
    old = SavedProfile("Office", "old-uuid")
    added = []
    fake_network_manager(monkeypatch, [old], added)
    monkeypatch.setattr(control, "run", lambda *args, **kwargs: "")
    control.wifi_connect({"ssid": "Office", "password": "new-password-1"})
    assert added and old.deleted
    assert control.JOB["phase"] == "complete"


def test_failed_new_password_keeps_old_profile(tmp_path, monkeypatch):
    control = load_control(tmp_path)
    old = SavedProfile("Office", "old-uuid")
    objects = fake_network_manager(monkeypatch, [old], [])

    def run(*args, **kwargs):
        if "up" in args:
            raise subprocess.CalledProcessError(10, args)
        return ""

    monkeypatch.setattr(control, "run", run)
    control.wifi_connect({"ssid": "Office", "password": "wrong-password"})
    assert not old.deleted and objects["/new"].deleted
    assert control.JOB["phase"] == "failed"


def test_saved_password_failure_suggests_forgetting(tmp_path, monkeypatch):
    control = load_control(tmp_path)
    fake_network_manager(monkeypatch, [SavedProfile("Office", "old-uuid")])

    def run(*args, **kwargs):
        if "up" in args:
            raise subprocess.CalledProcessError(10, args)
        return ""

    monkeypatch.setattr(control, "run", run)
    control.wifi_connect({"ssid": "Office", "password": ""})
    assert "forget the network" in control.JOB["message"]


def test_forget_removes_every_profile_for_the_network(tmp_path, monkeypatch):
    control = load_control(tmp_path)
    profiles = [SavedProfile("Office", "a"), SavedProfile("Office", "b"), SavedProfile("Home", "c")]
    fake_network_manager(monkeypatch, profiles)
    result = control.handle({"action": "wifi-forget", "ssid": "Office"})
    assert [p.deleted for p in profiles] == [True, True, False]
    assert result == {"forgotten": "Office", "saved": ["Home"]}
    with pytest.raises(ValueError, match="not saved"):
        control.handle({"action": "wifi-forget", "ssid": "Office"})
    with pytest.raises(ValueError):
        control.handle({"action": "wifi-forget", "ssid": ""})


def git_at(directory: Path, *args):
    return subprocess.check_output(
        ["git", "-C", str(directory), *args], text=True, stderr=subprocess.DEVNULL
    ).strip()


def release_repos(tmp_path):
    remote = tmp_path / "remote.git"
    seed = tmp_path / "seed"
    deployed = tmp_path / "deployed"
    subprocess.run(
        ["git", "init", "--bare", "--initial-branch=main", str(remote)],
        check=True,
        capture_output=True,
    )
    subprocess.run(["git", "clone", str(remote), str(seed)], check=True, capture_output=True)
    git_at(seed, "config", "user.email", "test@example.invalid")
    git_at(seed, "config", "user.name", "Test")
    static = seed / "device/src/musecam/static"
    static.mkdir(parents=True)
    (static / "index.html").write_text("old release")
    git_at(seed, "add", ".")
    git_at(seed, "commit", "-m", "old")
    git_at(seed, "push", "origin", "main")
    subprocess.run(["git", "clone", str(remote), str(deployed)], check=True, capture_output=True)
    (static / "index.html").write_text("new release")
    git_at(seed, "add", ".")
    git_at(seed, "commit", "-m", "new")
    git_at(seed, "push", "origin", "main")
    return deployed


def test_update_rolls_back_when_new_camera_does_not_start(tmp_path, monkeypatch):
    control = load_control(tmp_path)
    deployed = release_repos(tmp_path)
    monkeypatch.setattr(control, "REPO", deployed)
    previous = git_at(deployed, "rev-parse", "HEAD")
    real_run = control.run
    operations = []

    def run(*args, **kwargs):
        operations.append(args)
        return real_run(*args, **kwargs) if args[0] == "git" else ""

    monkeypatch.setattr(control, "run", run)
    starts = []

    def wait():
        starts.append(True)
        if len(starts) == 1:
            raise RuntimeError("new release did not start")

    monkeypatch.setattr(control, "wait_for_camera", wait)
    monkeypatch.setattr(control, "require_camera_idle", lambda: None)
    assert control.update_check()["available"] is True
    control.apply_update()
    assert git_at(deployed, "rev-parse", "HEAD") == previous
    assert (deployed / "device/src/musecam/static/index.html").read_text() == "old release"
    assert len(starts) == 2
    assert control.JOB["phase"] == "failed"
    assert "Previous version restored" in control.JOB["message"]


def test_update_refuses_local_changes_without_stopping_camera(tmp_path, monkeypatch):
    control = load_control(tmp_path)
    deployed = release_repos(tmp_path)
    monkeypatch.setattr(control, "REPO", deployed)
    (deployed / "local-notes.txt").write_text("keep me")
    operations = []
    real_run = control.run

    def run(*args, **kwargs):
        operations.append(args)
        return real_run(*args, **kwargs) if args[0] == "git" else ""

    monkeypatch.setattr(control, "run", run)
    control.apply_update()
    assert (deployed / "local-notes.txt").read_text() == "keep me"
    assert not any(op[0] == "systemctl" for op in operations)
    assert "Local development" in control.JOB["message"]


def test_wifi_names_with_colons_and_backslashes_parse(tmp_path):
    control = load_control(tmp_path)
    assert control.fields(r"*:Office\:Guest\\East:84:WPA2") == [
        "*",
        "Office:Guest\\East",
        "84",
        "WPA2",
    ]
    with pytest.raises(ValueError, match="Wi-Fi name"):
        control.handle({"action": "wifi-connect", "ssid": "x\n", "password": "test1234"})
    with pytest.raises(ValueError, match="Unsupported"):
        control.handle({"action": "arbitrary-command"})


def test_installed_files_are_readable_despite_private_daemon_umask(tmp_path):
    import os

    control = load_control(tmp_path)
    destination = tmp_path / "installed.py"
    previous_mask = os.umask(0o077)
    try:
        control.run(
            sys.executable,
            "-c",
            "import pathlib,sys; pathlib.Path(sys.argv[1]).write_text('code')",
            str(destination),
        )
    finally:
        os.umask(previous_mask)
    assert destination.stat().st_mode & 0o777 == 0o644
