#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR=/opt/muse-cam
CONFIG_DIR=/etc/musecam
REPOSITORY_URL=""
PROFILE=""

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
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

if [[ -z ${REPOSITORY_URL} ]]; then
  echo "Pass the public Git repository with --repo." >&2
  exit 2
fi

if [[ -z ${PROFILE} ]]; then
  echo "Pass --profile pi3bplus-imx415-tft35 or --profile zero2-cam3-displayhat." >&2
  exit 2
fi

if [[ ! -f "/proc/device-tree/model" ]]; then
  echo "This installer must run on a Raspberry Pi." >&2
  exit 1
fi

apt-get update
apt-get install -y git python3-venv python3-pip

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  git -C "${INSTALL_DIR}" fetch --depth 1 origin main
  git -C "${INSTALL_DIR}" checkout --force origin/main
else
  git clone --depth 1 "${REPOSITORY_URL}" "${INSTALL_DIR}"
fi

if [[ ! -f "${INSTALL_DIR}/device/profiles/${PROFILE}.toml" ]]; then
  echo "Unknown hardware profile: ${PROFILE}" >&2
  exit 2
fi

python3 -m venv --system-site-packages "${INSTALL_DIR}/.venv"
"${INSTALL_DIR}/.venv/bin/pip" install --upgrade pip
"${INSTALL_DIR}/.venv/bin/pip" install "${INSTALL_DIR}/device"

install -d -m 0750 "${CONFIG_DIR}"
read -r -p "Vercel server URL: " SERVER_URL
read -r -s -p "Device token: " DEVICE_TOKEN
echo

TEMP_CONFIG=$(mktemp)
trap 'rm -f "${TEMP_CONFIG}"' EXIT
printf 'MUSECAM_SERVER_URL=%s\nMUSECAM_DEVICE_TOKEN=%s\nMUSECAM_PROFILE=%s\n' \
  "${SERVER_URL%/}" "${DEVICE_TOKEN}" "${PROFILE}" > "${TEMP_CONFIG}"
install -m 0600 "${TEMP_CONFIG}" "${CONFIG_DIR}/device.env"

"${INSTALL_DIR}/.venv/bin/musecam" health
echo "Muse Cam API client installed. Hardware daemon setup is the next milestone."
