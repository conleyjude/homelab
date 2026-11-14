# Homelab WHOOP Dashboard

A single-user WHOOP v2 dashboard for a kiosk browser on the Raspberry Pi touchscreen. The browser reads a local API; only the API handles OAuth credentials and provider calls. It displays wellness information for personal use and is not medical advice.

## Layout and implementation

- `apps/dashboard/` is a Vite/React static dashboard. The WHOOP panel is kept in `integrations/whoop/dashboard/` and consumes only the local API.
- `apps/api/` is a dependency-free Node.js 22 API. It publishes only on loopback on the Pi and owns OAuth, encrypted token storage, data retrieval, and cleanup.
- `integrations/whoop/server/` contains the WHOOP v2 client, OAuth state, data mapping, encrypted token store, and in-memory snapshot cache.
- `deploy/pi/compose.yaml` runs the API as the only container. Host nginx continues serving the static dashboard; host cloudflared is unchanged.
- `docs/architecture.md` describes data flow, retention, and remaining go-live checks.

## Local development

Requirements: Node.js 22 or newer and npm. No real WHOOP credentials are needed for tests or the frontend build.

```powershell
npm --prefix apps/dashboard install
npm test
npm run build
npm --prefix apps/dashboard run dev
```

The Vite development server listens on `http://127.0.0.1:5173`; the browser calls the API directly at `http://localhost:4001` with an exact-origin CORS check. To run the API locally, set the process environment variables using `.env.example` as a reference, then run:

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
PI_TIMEZONE=your-Pi-IANA-timezone
DASHBOARD_ORIGIN=http://localhost
WHOOP_CACHE_MAX_SECONDS=0
```

Generate a unique 32-byte encryption key on the Pi with `openssl rand -base64 32` and enter its output in that file. Do not use the example key. `DASHBOARD_ORIGIN` must be the exact origin opened by the kiosk, with no trailing path; change it if the local nginx kiosk URL differs. `PI_TIMEZONE` should match the Pi's local IANA zone. Keep `WHOOP_CACHE_MAX_SECONDS=0` until the WHOOP developer/data terms and authenticated response cache headers have been reviewed. Zero disables server-side snapshot retention; snapshots are still displayed in the current browser session and are cleared there at the display boundary.

The encrypted token file is stored separately at `/var/lib/homelab/whoop/tokens.enc`. The encryption key lives only in the root-readable env file, not in Git, the image, or the token volume. Example setup commands:

```sh
sudo install -d -o 1000 -g 1000 -m 0700 /var/lib/homelab/whoop
sudo install -d -o root -g root -m 0700 /etc/homelab
sudo install -o root -g root -m 0600 /dev/null /etc/homelab/whoop.env
sudoedit /etc/homelab/whoop.env
```

Root and anyone able to inspect the Docker daemon can still access the key or process memory. Host compromise, backups of `/etc`, swap/core dumps, and physical access remain key-at-rest risks. Use encrypted host storage/backups and restrict administrator access. The API does not write health snapshots to disk.

## Pi build and run

Build the static dashboard and publish `apps/dashboard/dist/` under the existing host nginx document root. Keep the existing website, nginx configuration, and cloudflared service unchanged. The display is attached directly to the Pi; Chromium kiosk runs locally and opens the existing local dashboard URL (for example `http://localhost/`). The dashboard calls `http://localhost:4001` directly. Set `DASHBOARD_ORIGIN` to the exact origin opened by the kiosk. No nginx API proxy or remote display client is required. The panel resolution is not specified yet; the compact landscape layout is tuned for an assumed 800x480 viewport and remains responsive at narrower or portrait sizes.

From the repository on the Pi:

```sh
docker compose -f deploy/pi/compose.yaml build
docker compose -f deploy/pi/compose.yaml up -d
docker compose -f deploy/pi/compose.yaml ps
curl -fsS http://127.0.0.1:4001/healthz
```

Compose binds host port `4001` to `127.0.0.1`, uses a read-only container filesystem, drops Linux capabilities, and persists only the encrypted token file. Docker must be installed on the Pi by its operator; this task did not install it or deploy to the live host.

The registered OAuth redirect is exactly `https://connect.surviveness.com/oauth/whoop/callback`. Keep the existing cloudflared tunnel service and route for `connect.surviveness.com` to `http://localhost:4001`. The API accepts that public Host only for `GET /oauth/whoop/callback`; every other path on that Host is denied. Do not add an API route for the public website or tunnel. The callback query contains a short-lived authorization code and state; the API does not log requests, but verify Cloudflare/Tunnel logging and retention do not capture callback query strings.

## Tests and operational behavior

`npm test` covers state success/failure/replay, callback denial, missing scopes, token encryption and rotation, refresh serialization, WHOOP status/rate-limit mapping, cache expiry, disconnect cleanup including concurrent refresh, and public-host route isolation. `npm run build` makes the production dashboard bundle. WHOOP request bodies and response bodies are never written to logs or returned as errors. Refresh is user-triggered, and a 429 response disables refresh until its advertised retry delay.

WHOOP returns the v2 sleep, recovery, body measurement, and cycle schemas documented in its [official API reference](https://developer.whoop.com/api) and [live OpenAPI document](https://api.prod.whoop.com/developer/doc/openapi.json). The service requests only `read:sleep`, `read:recovery`, `read:body_measurement`, `read:cycles`, plus OAuth's `offline` scope. WHOOP's OAuth guide describes rotating refresh tokens and the need to serialize refreshes: [OAuth 2.0](https://developer.whoop.com/docs/developing/oauth/).

WHOOP's public member Terms of Use were not enough to establish the developer API's data-retention allowance, and no authenticated API response headers can be inspected without a real authorized request. Consequently snapshots are not retained server-side by default. Before setting `WHOOP_CACHE_MAX_SECONDS` above zero or using real data, verify the current developer/API terms, permitted local display/caching duration, and real response `Cache-Control`, `Expires`, and `Age` headers. The application uses the shortest of that configured cap, WHOOP response freshness, and the next Pi-local noon/midnight boundary. Missing scores remain missing; `PENDING_SCORE` and `UNSCORABLE` are displayed distinctly.

## Troubleshooting

- `reconnect_required`: WHOOP did not grant `offline`, the refresh token expired/was rotated elsewhere, or refresh failed. Use Connect/Reconnect and approve all four data permissions.
- `permission_denied`: compare scopes in the WHOOP Developer Dashboard with the four requested data scopes; no profile or workout permission is requested.
- `rate_limited`: wait for the displayed retry window; do not automate retries.
- Callback returns to the dashboard with an error: confirm the registered redirect URI exactly matches the one above and the existing tunnel routes the callback Host to port 4001.
- Local API unavailable: confirm Compose health, that port 4001 is loopback-bound, the dashboard is opened on the Pi, and `DASHBOARD_ORIGIN` exactly matches the kiosk URL origin.
- Token-file decryption error: restore the matching key from its protected host backup. Replacing the key without deleting or migrating the encrypted token file requires reconnecting.
