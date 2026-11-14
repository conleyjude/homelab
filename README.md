.# Homelab WHOOP Dashboard

A single-user WHOOP v2 dashboard for a kiosk browser on the Raspberry Pi touchscreen. The browser reads a local API; only the API handles OAuth credentials and provider calls. It displays wellness information for personal use and is not medical advice.

## Layout and implementation

- `apps/dashboard/` is a Vite/React dashboard. The WHOOP panel is kept in `integrations/whoop/dashboard/` and consumes only the local API.
- `apps/api/` is a dependency-free Node.js 22 API that also serves the built dashboard on the Pi's loopback port. It owns OAuth, encrypted token storage, data retrieval, and cleanup.
- `integrations/whoop/server/` contains the WHOOP v2 client, OAuth state, data mapping, encrypted token store, and in-memory snapshot cache.
- `deploy/pi/compose.yaml` runs the API and its dashboard as the only container. Host nginx and cloudflared remain unchanged.
- `docs/architecture.md` describes data flow, retention, and remaining go-live checks.

## Local development

Requirements: Node.js 22 or newer and npm. No real WHOOP credentials are needed for tests or the frontend build.

```powershell
npm --prefix apps/dashboard install
npm test
npm run build
npm --prefix apps/dashboard run dev
```

The Vite development server listens on `http://127.0.0.1:5173`; it calls the API at `http://localhost:4001`, which allows that exact development origin. In the Pi image, the API serves the compiled dashboard and local API on one origin at `http://localhost:4001`. To run the API locally, set the process environment variables using `.env.example` as a reference, then run:

```powershell
$env:WHOOP_CLIENT_ID = 'fake-local-client-id'
$env:WHOOP_CLIENT_SECRET = 'fake-local-client-secret'
$env:WHOOP_TOKEN_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
$env:TOKEN_FILE = "$PWD/runtime/whoop/tokens.enc"
$env:DASHBOARD_ORIGIN = 'http://127.0.0.1:5173'
npm --prefix apps/api start
```

Use only fake values locally unless you have completed the real-data go-live checks below. The example key is not secure and must never be used on the Pi. Tests use mocked WHOOP responses and synthetic test values only.

## Pi configuration

Create `/etc/homelab/whoop.env` on the Pi with mode `0600` and ownership `root:root`. Put exactly these settings in it:

```dotenv
WHOOP_CLIENT_ID=your-WHOOP-Developer-Dashboard-client-id
WHOOP_CLIENT_SECRET=your-WHOOP-Developer-Dashboard-client-secret
WHOOP_TOKEN_ENCRYPTION_KEY=base64-output-from-openssl-rand-32-bytes
PI_TIMEZONE=America/Chicago
DASHBOARD_ORIGIN=http://localhost:4001
WHOOP_CACHE_MAX_SECONDS=0
```

Generate a unique 32-byte encryption key on the Pi with `openssl rand -base64 32` and enter its output in that file. Do not use the example key. Keep `DASHBOARD_ORIGIN=http://localhost:4001` for the kiosk page served by the API container. Set `PI_TIMEZONE=America/Chicago` for Central Time; this setting controls dashboard display times and snapshot cleanup independently of Ubuntu's system timezone. Keep `WHOOP_CACHE_MAX_SECONDS=0` until the WHOOP developer/data terms and authenticated response cache headers have been reviewed. Zero disables server-side snapshot retention; snapshots are still displayed in the current browser session and are cleared there at the display boundary.

The encrypted token file is stored separately at `/var/lib/homelab/whoop/tokens.enc`. The encryption key lives only in the root-readable env file, not in Git, the image, or the token volume. Example setup commands:

```sh
sudo install -d -o 1000 -g 1000 -m 0700 /var/lib/homelab/whoop
sudo install -d -o root -g root -m 0700 /etc/homelab
sudo install -o root -g root -m 0600 /dev/null /etc/homelab/whoop.env
sudoedit /etc/homelab/whoop.env
```

Root and anyone able to inspect the Docker daemon can still access the key or process memory. Host compromise, backups of `/etc`, swap/core dumps, and physical access remain key-at-rest risks. Use encrypted host storage/backups and restrict administrator access. The API does not write health snapshots to disk.

## Pi build and run

Keep the existing website, nginx configuration, and cloudflared service unchanged. The display is attached directly to the Pi; Chromium kiosk runs locally and opens `http://localhost:4001`, where the API container serves the dashboard and its API. No nginx document root or additional nginx route is needed. The panel resolution is not specified yet; the compact landscape layout is tuned for an assumed 800x480 viewport and remains responsive at narrower or portrait sizes.

From Windows, deploy the current working tree from the repository root with OpenSSH (`ssh`, `scp`) and `tar` available:

```powershell
.\deploy\pi\deploy-to-pi.ps1
```

The SSH target defaults to `ubuntu@192.168.0.71` and can be overridden with `-PiTarget user@host`. The script stages only runtime source and configuration, transfers it over SSH/SCP, then runs Compose on the Pi. The multi-stage Dockerfile builds the Vite dashboard into the API image. It checks `/etc/homelab/whoop.env` and Docker Compose, prepares `/var/lib/homelab/whoop` for container UID/GID 1000, starts the API/dashboard container, and checks `/healthz`. The remote repository copy is placed at `~/homelab` by default; change `-RemoteRepoName` to use another simple directory name. SSH may prompt for the Pi account password or key passphrase, and remote `sudo` may prompt for the Pi sudo password. Use `-WhatIf` to preview the target without building or connecting.

The script does not copy `.env`, credentials, encryption keys, `node_modules`, or health data. It does not install Docker, edit nginx, or change Cloudflare Tunnel configuration.

## Kiosk session

The Pi is running Ubuntu Server without a graphical session, so installing the API alone will not put a browser on the display. After deployment, run this on the Pi to install a minimal Xorg/Openbox/LightDM session and Chromium:

```sh
sudo bash ~/homelab/deploy/pi/setup-kiosk.sh
```

The script checks the API health endpoint, asks before changing boot behavior, creates a dedicated unprivileged `homelab-kiosk` account, configures LightDM auto-login for that account, and starts Chromium kiosk at `http://localhost:4001` with GPU acceleration disabled for software rendering. It does not install a full desktop environment or change nginx/Cloudflare. The auto-login is intentional for the physically secured display; use SSH with your regular administrator account for maintenance. The touchscreen and DSI panel must already be detected by the Pi's kernel. Chromium output is written to `/home/homelab-kiosk/.local/state/homelab-kiosk/chromium.log`.

To return to text-only boot and disable the kiosk session:

```sh
sudo systemctl set-default multi-user.target
sudo systemctl disable --now lightdm
```

From the repository on the Pi:

```sh
docker compose -f deploy/pi/compose.yaml build
docker compose -f deploy/pi/compose.yaml up -d
docker compose -f deploy/pi/compose.yaml ps
curl -fsS http://127.0.0.1:4001/healthz
```

Compose binds host port `4001` to `127.0.0.1`, uses a read-only container filesystem, drops Linux capabilities, and persists only the encrypted token file. Docker must be installed on the Pi by its operator; this task did not install it or deploy to the live host.

The registered OAuth redirect is exactly `https://connect.surviveness.com/oauth/whoop/callback`. Keep the existing cloudflared tunnel service and route for `connect.surviveness.com` to `http://localhost:4001`. The API accepts that public Host only for `GET /oauth/whoop/callback`; dashboard assets, health, and data routes on that Host are denied. Do not add an API route for the public website or tunnel. The callback query contains a short-lived authorization code and state; the API does not log requests, but verify Cloudflare/Tunnel logging and retention do not capture callback query strings.

## Tests and operational behavior

`npm test` covers state success/failure/replay, callback denial, missing scopes, token encryption and rotation, refresh serialization, WHOOP status/rate-limit mapping, cache expiry, disconnect cleanup including concurrent refresh, and public-host route isolation. `npm run build` makes the production dashboard bundle. WHOOP request bodies and response bodies are never written to logs or returned as errors. Refresh is user-triggered, and a 429 response disables refresh until its advertised retry delay.

WHOOP returns the v2 sleep, recovery, body measurement, and cycle schemas documented in its [official API reference](https://developer.whoop.com/api) and [live OpenAPI document](https://api.prod.whoop.com/developer/doc/openapi.json). The service requests only `read:sleep`, `read:recovery`, `read:body_measurement`, `read:cycles`, plus OAuth's `offline` scope. WHOOP's OAuth guide describes rotating refresh tokens and the need to serialize refreshes: [OAuth 2.0](https://developer.whoop.com/docs/developing/oauth/).

WHOOP's public member Terms of Use were not enough to establish the developer API's data-retention allowance, and no authenticated API response headers can be inspected without a real authorized request. Consequently snapshots are not retained server-side by default. Before setting `WHOOP_CACHE_MAX_SECONDS` above zero or using real data, verify the current developer/API terms, permitted local display/caching duration, and real response `Cache-Control`, `Expires`, and `Age` headers. The server cache uses the shortest of that configured cap, WHOOP response freshness, and the next Pi-local noon/midnight boundary. In browser memory, morning data fetched before noon expires at noon; if manually refreshed after noon, it remains until the Pi-local day changes. Missing scores remain missing; `PENDING_SCORE` and `UNSCORABLE` are displayed distinctly.

## Troubleshooting

- `reconnect_required`: WHOOP did not grant `offline`, the refresh token expired/was rotated elsewhere, or refresh failed. If the access token is still valid, manual refresh remains available; reconnect before it expires to continue unattended access. Approve all four data permissions.
- `permission_denied`: compare scopes in the WHOOP Developer Dashboard with the four requested data scopes; no profile or workout permission is requested.
- `rate_limited`: wait for the displayed retry window; do not automate retries.
- Blank kiosk screen with a visible cursor: confirm Chromium is running, then inspect `journalctl -b -u lightdm` and `/home/homelab-kiosk/.local/state/homelab-kiosk/chromium.log`. The kiosk starts Chromium with GPU acceleration disabled to fall back to software rendering on Pi systems without a working EGL/OpenGL path.
- Callback returns to the dashboard with an error: confirm the registered redirect URI exactly matches the one above and the existing tunnel routes the callback Host to port 4001.
- Local API unavailable: confirm Compose health, that port 4001 is loopback-bound, the dashboard is opened on the Pi, and `DASHBOARD_ORIGIN` exactly matches the kiosk URL origin.
- Token-file decryption error: restore the matching key from its protected host backup. Replacing the key without deleting or migrating the encrypted token file requires reconnecting.
