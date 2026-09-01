# Raspberry Pi client

The first device milestone is an API exercise client. It can query health/presets, submit an existing JPEG, download the private result, and optionally share it:

```bash
python3 -m venv .venv
.venv/bin/pip install ./device
sudo install -d -m 0750 /etc/musecam
sudo install -m 0600 /dev/stdin /etc/musecam/device.env <<'EOF'
MUSECAM_SERVER_URL=https://your-project.vercel.app
MUSECAM_DEVICE_TOKEN=the-plaintext-camera-token
EOF

.venv/bin/musecam health
.venv/bin/musecam presets
.venv/bin/musecam submit /absolute/path/photo.jpg --preset kid-drawing --share
```

The hardware profiles document the intended abstraction boundary. Camera capture, framebuffer/display adapters, touch/GPIO input, local SQLite queuing, and systemd startup will be added after the web vertical slice is deployed.
