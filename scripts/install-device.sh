#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR=/opt/muse-cam
CONFIG_DIR=/etc/musecam
DATA_DIR=/var/lib/musecam
REPOSITORY_URL=https://github.com/danny-hines/muse-cam.git
SERVER_URL=https://muse-cam.dannyhines.dev
PROFILE=""
RECONFIGURE=0
START_SERVICE=1

usage() {
  cat <<'EOF'
Install or update Muse Cam on Raspberry Pi OS.

Usage:
  sudo bash install-device.sh --profile PROFILE [options]

Profiles:
  pi3bplus-imx415-tft35
  zero2-cam3-displayhat

Options:
  --repo URL          Public Git repository to install
  --server URL        Muse Cam server URL
  --reconfigure       Prompt for the server URL and device token again
  --no-start          Install without enabling or starting the service
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPOSITORY_URL="$2"
      shift 2
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --server)
      SERVER_URL="$2"
      shift 2
      ;;
    --reconfigure)
      RECONFIGURE=1
      shift
      ;;
    --no-start)
      START_SERVICE=0
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

if [[ -z ${PROFILE} ]]; then
  echo "Pass --profile pi3bplus-imx415-tft35 or --profile zero2-cam3-displayhat." >&2
  exit 2
fi

if [[ ! -f /proc/device-tree/model ]]; then
  echo "This installer must run on Raspberry Pi hardware." >&2
  exit 1
fi

case "${PROFILE}" in
  pi3bplus-imx415-tft35|zero2-cam3-displayhat) ;;
  *)
    echo "Unknown hardware profile: ${PROFILE}" >&2
    exit 2
    ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  git \
  python3-venv \
  python3-pip \
  rpicam-apps-lite \
  python3-picamera2 \
  python3-pil \
  python3-numpy \
  python3-pygame \
  python3-gpiozero \
  python3-evdev \
  sudo

if command -v raspi-config >/dev/null 2>&1; then
  raspi-config nonint do_spi 0
  if [[ ${PROFILE} == zero2-cam3-displayhat ]]; then
    raspi-config nonint do_i2c 0
  fi
fi

if systemctl is-active --quiet musecam.service 2>/dev/null; then
  systemctl stop musecam.service
fi

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  if [[ -n $(git -C "${INSTALL_DIR}" status --porcelain) ]]; then
    echo "${INSTALL_DIR} has local changes; refusing to overwrite them." >&2
    exit 1
  fi
  git -C "${INSTALL_DIR}" pull --ff-only origin main
elif [[ -e ${INSTALL_DIR} ]]; then
  echo "${INSTALL_DIR} exists but is not a Git checkout; move it aside and retry." >&2
  exit 1
else
  git clone --depth 1 "${REPOSITORY_URL}" "${INSTALL_DIR}"
fi

if [[ ! -f "${INSTALL_DIR}/device/profiles/${PROFILE}.toml" ]]; then
  echo "The selected profile is not present in the checkout: ${PROFILE}" >&2
  exit 2
fi

if ! id musecam >/dev/null 2>&1; then
  useradd --system --home-dir "${DATA_DIR}" --create-home --shell /usr/sbin/nologin musecam
fi
for group in video render input gpio spi; do
  if getent group "${group}" >/dev/null 2>&1; then
    usermod -aG "${group}" musecam
  fi
done
install -d -o musecam -g musecam -m 0750 "${DATA_DIR}" "${DATA_DIR}/captures" "${DATA_DIR}/results"

python3 -m venv --system-site-packages "${INSTALL_DIR}/.venv"
"${INSTALL_DIR}/.venv/bin/pip" install --disable-pip-version-check --upgrade pip
"${INSTALL_DIR}/.venv/bin/pip" install --disable-pip-version-check "${INSTALL_DIR}/device"
if [[ ${PROFILE} == zero2-cam3-displayhat ]]; then
  "${INSTALL_DIR}/.venv/bin/pip" install --disable-pip-version-check "displayhatmini>=0.0.2,<1"
fi

install -d -m 0750 "${CONFIG_DIR}"
CONFIG_FILE="${CONFIG_DIR}/device.env"
if [[ ! -f ${CONFIG_FILE} || ${RECONFIGURE} -eq 1 ]]; then
  if [[ -t 0 || -r /dev/tty ]]; then
    read -r -p "Muse Cam server URL [${SERVER_URL}]: " ENTERED_SERVER </dev/tty
    SERVER_URL="${ENTERED_SERVER:-${SERVER_URL}}"
    read -r -s -p "Device token: " DEVICE_TOKEN </dev/tty
    echo >/dev/tty
  else
    echo "A terminal is required to enter the device token securely." >&2
    exit 1
  fi
  if [[ -z ${DEVICE_TOKEN} ]]; then
    echo "Device token cannot be empty." >&2
    exit 2
  fi
else
  SERVER_URL=$(sed -n 's/^MUSECAM_SERVER_URL=//p' "${CONFIG_FILE}" | tail -1)
  DEVICE_TOKEN=$(sed -n 's/^MUSECAM_DEVICE_TOKEN=//p' "${CONFIG_FILE}" | tail -1)
fi

TEMP_CONFIG=$(mktemp)
trap 'rm -f "${TEMP_CONFIG}"' EXIT
{
  printf 'MUSECAM_SERVER_URL=%s\n' "${SERVER_URL%/}"
  printf 'MUSECAM_DEVICE_TOKEN=%s\n' "${DEVICE_TOKEN}"
  printf 'MUSECAM_PROFILE=%s\n' "${PROFILE}"
  printf 'MUSECAM_PROFILES_DIR=%s/device/profiles\n' "${INSTALL_DIR}"
  printf 'MUSECAM_DATA_DIR=%s\n' "${DATA_DIR}"
  printf 'MUSECAM_LOG_LEVEL=INFO\n'
  if [[ ${PROFILE} == pi3bplus-imx415-tft35 ]]; then
    printf 'MUSECAM_FRAMEBUFFER=/dev/fb1\n'
  fi
} >"${TEMP_CONFIG}"
install -o root -g musecam -m 0640 "${TEMP_CONFIG}" "${CONFIG_FILE}"

install -o root -g root -m 0644 \
  "${INSTALL_DIR}/device/systemd/musecam.service" \
  /etc/systemd/system/musecam.service
printf 'musecam ALL=(root) NOPASSWD: /usr/bin/systemctl poweroff\n' \
  >/etc/sudoers.d/musecam-poweroff
chmod 0440 /etc/sudoers.d/musecam-poweroff
visudo -cf /etc/sudoers.d/musecam-poweroff >/dev/null

systemctl daemon-reload
runuser -u musecam -- "${INSTALL_DIR}/.venv/bin/musecam" --config "${CONFIG_FILE}" health

if [[ ${START_SERVICE} -eq 1 ]]; then
  systemctl enable --now musecam.service
  echo
  echo "Muse Cam is installed and running."
  echo "Run: sudo -u musecam ${INSTALL_DIR}/.venv/bin/musecam --config ${CONFIG_FILE} doctor"
  echo "Logs: journalctl -u musecam -f"
else
  echo "Muse Cam is installed. Start it with: systemctl enable --now musecam.service"
fi

if [[ ${PROFILE} == pi3bplus-imx415-tft35 ]]; then
  echo
  echo "Hardware note: install the TFT vendor framebuffer driver and confirm the camera overlay"
  echo "for the exact IMX415 board before running diagnostics. The profile defaults to /dev/fb1."
elif [[ ! -S /tmp/pisugar-server.sock ]]; then
  echo
  echo "Battery note: install PiSugar Power Manager to enable the on-screen battery percentage."
fi
