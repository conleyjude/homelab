# Raspberry Pi deployment

The Node API container also serves the compiled dashboard to Chromium on the physically attached touchscreen at `http://localhost:4001`. Docker Compose publishes port `4001` on `127.0.0.1`. No nginx document root or nginx change is needed. The existing cloudflared host service continues routing `connect.surviveness.com` to that API; the application accepts only the exact callback path on that Host.

No live secrets, tokens, tunnel credentials, or health data belong in this repository. Follow the root [README](../../README.md) for host setup and configuration. This directory contains the API-only Compose file.

From Windows, [deploy-to-pi.ps1](deploy-to-pi.ps1) transfers the API, dashboard source, Dockerfile, and Compose file over SSH/SCP, then runs Compose to build and start the image. The SSH target defaults to `ubuntu@192.168.0.71`; override it with `-PiTarget user@host` if needed. The script checks for Docker Compose and `/etc/homelab/whoop.env`, and prepares `/var/lib/homelab/whoop` for the API container. Use `-WhatIf` to preview the target. It never transfers `.env` or changes nginx/Cloudflare configuration.

Ubuntu Server has no graphical session by default. After deploying and confirming the API is healthy, run `sudo bash ~/homelab/deploy/pi/setup-kiosk.sh` on the Pi. This installs a minimal Xorg/Openbox/LightDM session, Chromium, and a dedicated unprivileged kiosk account that auto-opens `http://localhost:4001` with GPU acceleration disabled; it asks for confirmation before setting graphical boot. Chromium logs go to `/home/homelab-kiosk/.local/state/homelab-kiosk/chromium.log`. To disable the kiosk later, run `sudo systemctl set-default multi-user.target && sudo systemctl disable --now lightdm`.
