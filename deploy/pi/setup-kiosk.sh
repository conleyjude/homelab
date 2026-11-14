#!/usr/bin/env bash
set -euo pipefail

KIOSK_USER="${HOMELAB_KIOSK_USER:-homelab-kiosk}"
DASHBOARD_URL="http://localhost:4001"
LIGHTDM_CONFIG="/etc/lightdm/lightdm.conf.d/90-homelab-kiosk.conf"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo: sudo bash $0" >&2
  exit 1
fi
if [[ ! -r /etc/os-release ]]; then
  echo "Cannot identify the operating system." >&2
  exit 1
fi
. /etc/os-release
if [[ "${ID:-}" != ubuntu ]]; then
  echo "This setup targets Ubuntu Server on the Pi (found: ${PRETTY_NAME:-unknown})." >&2
  exit 1
fi
if [[ ! -f /etc/homelab/whoop.env ]]; then
  echo "Missing /etc/homelab/whoop.env; deploy the API and configure its secrets first." >&2
  exit 1
fi
if ! curl --fail --silent http://127.0.0.1:4001/healthz >/dev/null; then
  echo "The local dashboard/API is not healthy at 127.0.0.1:4001. Deploy it before setting up the kiosk." >&2
  exit 1
fi
if [[ -e "${LIGHTDM_CONFIG}" ]]; then
  echo "Refusing to overwrite existing ${LIGHTDM_CONFIG}. Review it manually first." >&2
  exit 1
fi
if [[ -e /etc/X11/default-display-manager ]] && ! grep -q '/usr/sbin/lightdm' /etc/X11/default-display-manager; then
  echo "A different display manager is already configured at /etc/X11/default-display-manager." >&2
  echo "Refusing to replace an existing graphical setup." >&2
  exit 1
fi

cat <<EOF
This will install a lightweight graphical kiosk stack (Xorg, Openbox, LightDM,
and Chromium), create the unprivileged '${KIOSK_USER}' kiosk account, configure
LightDM to log that account in automatically, and make the Pi boot to a graphical
session. Chromium will open ${DASHBOARD_URL}.

This changes the Pi's boot/display behavior. It does not change nginx or Cloudflare.
Use SSH or another admin account for maintenance after the kiosk is enabled.
EOF
read -r -p "Continue? [y/N] " answer
if [[ "${answer}" != [yY] && "${answer}" != [yY][eE][sS] ]]; then
  echo "Cancelled; no kiosk changes made."
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
debconf-set-selections <<< $'lightdm shared/default-x-display-manager select lightdm'
apt-get install -y --no-install-recommends \
  dbus-x11 \
  lightdm \
  openbox \
  snapd \
  x11-xserver-utils \
  xinit \
  xserver-xorg-core \
  xserver-xorg-input-libinput
if ! snap list chromium >/dev/null 2>&1; then
  snap install chromium
fi

if ! id "${KIOSK_USER}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --user-group "${KIOSK_USER}"
  passwd --lock "${KIOSK_USER}" >/dev/null
fi
for group in video render; do
  if getent group "${group}" >/dev/null; then
    usermod -aG "${group}" "${KIOSK_USER}"
  fi
done

KIOSK_HOME="$(getent passwd "${KIOSK_USER}" | cut -d: -f6)"
install -d -o "${KIOSK_USER}" -g "${KIOSK_USER}" -m 0755 "${KIOSK_HOME}/.config/openbox"
install -d -o "${KIOSK_USER}" -g "${KIOSK_USER}" -m 0700 "${KIOSK_HOME}/.local/state/homelab-kiosk"
cat > "${KIOSK_HOME}/.config/openbox/autostart" <<'EOF'
xset s off
xset -dpms
xset s noblank
while true; do
  /snap/bin/chromium --kiosk --no-first-run --disable-session-crashed-bubble --disable-infobars --disable-gpu --disable-gpu-compositing http://localhost:4001 >> "$HOME/.local/state/homelab-kiosk/chromium.log" 2>&1
  sleep 2
done &
EOF
cat > "${KIOSK_HOME}/.xsession" <<'EOF'
exec openbox-session
EOF
chown -R "${KIOSK_USER}:${KIOSK_USER}" "${KIOSK_HOME}/.config" "${KIOSK_HOME}/.local" "${KIOSK_HOME}/.xsession"
chmod 0755 "${KIOSK_HOME}/.config/openbox/autostart" "${KIOSK_HOME}/.xsession"

install -d -m 0755 /etc/lightdm/lightdm.conf.d
cat > "${LIGHTDM_CONFIG}" <<EOF
[Seat:*]
autologin-user=${KIOSK_USER}
autologin-user-timeout=0
user-session=openbox
autologin-session=openbox
EOF
chmod 0644 "${LIGHTDM_CONFIG}"

systemctl set-default graphical.target
systemctl enable lightdm
systemctl restart lightdm

echo "Kiosk setup complete. Chromium should open ${DASHBOARD_URL} on the attached display."
echo "If the screen stays blank, check the panel/DSI display is detected and inspect: journalctl -u lightdm -b"
echo "To return to command-line boot: sudo systemctl set-default multi-user.target && sudo systemctl disable --now lightdm"
