# Raspberry Pi deployment

The planned deployment uses local system services on the Pi, alongside the existing nginx and Cloudflare Tunnel setup. Keep service and proxy examples here; do not commit live tunnel credentials or machine-specific secrets.

The API callback hostname is intended to route to port `4001`. The health-data dashboard and API routes should remain local-only. Deployment configuration does not exist yet.