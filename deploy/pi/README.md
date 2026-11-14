# Raspberry Pi deployment

The dashboard is static content served by the existing host nginx to Chromium on the physically attached touchscreen. Docker Compose runs only the Node API and publishes port `4001` on `127.0.0.1`. The existing cloudflared host service continues routing `connect.surviveness.com` to that API; the application accepts only the exact callback path on that Host.

No live secrets, tokens, tunnel credentials, or health data belong in this repository. Follow the root [README](../../README.md) for host setup and configuration. This directory contains the API-only Compose file.
