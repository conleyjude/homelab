# Architecture

## Status and scope

The first implementation is a single-user, local-first WHOOP dashboard hosted on the Raspberry Pi. It displays sleep, recovery, body measurements, and cycle summaries for the owner's WHOOP account. It is not a public health-data service and is not intended to provide medical diagnosis, treatment, or advice.

Weather, Oura, and microcontroller sensors are possible later integrations, not part of the initial WHOOP implementation.

## Component boundaries

```text
Touchscreen physically connected to the Raspberry Pi
  -> kiosk browser running on the Pi
  -> dashboard app
  -> local API on the Pi over loopback
       -> WHOOP integration (OAuth and API calls)
       -> local token and temporary snapshot storage

WHOOP OAuth redirect
  -> https://connect.surviveness.com/oauth/whoop/callback
  -> Cloudflare Tunnel
  -> local API on the Pi (port 4001)
```

- `apps/dashboard/` is displayed by a kiosk browser on the Pi's physically attached touchscreen. It composes dashboard widgets and reads data from the local API over loopback. It is not a separate networked display client and must not contain OAuth client secrets, access tokens, or refresh tokens.
- `apps/api/` is the single local backend process. It owns callback handling, state validation, token exchange and refresh, local API routes, storage, and any scheduled refresh or cleanup work.
- `integrations/whoop/server/` owns WHOOP-specific OAuth configuration, HTTP calls, API response mapping, and revocation behavior. Keep it server-only.
- `integrations/whoop/dashboard/` owns the WHOOP display component and consumes a limited dashboard-facing data contract. It must not call WHOOP directly.
- `packages/dashboard-contracts/` is for shared response shapes only when needed. Avoid normalizing distinct provider scores into misleading interchangeable values.
- `devices/` and future providers can be added independently without becoming separate running services by default.

The dashboard is a static Vite/React build served by the Node.js 22 API container to the locally attached kiosk browser. This is the only container in the initial Compose deployment. It binds inside its container on `0.0.0.0:4001`, while Docker publishes that port only on host loopback `127.0.0.1:4001`. The kiosk opens `http://localhost:4001`, so page and local API share an origin. No nginx document root, additional nginx API proxy, or networked display client is required. The existing host nginx and cloudflared service stay in place; cloudflared routes the `connect.surviveness.com` callback hostname directly to `localhost:4001`.

## WHOOP authorization and permissions

The WHOOP app is in Sandbox mode. The planned data permissions are:

- `read:sleep`
- `read:recovery`
- `read:body_measurement`
- `read:cycles`

The API's `offline` scope is requested as part of the OAuth authorization flow, not selected as a data permission in the developer app setup. Request it to seek a refresh token, but do not assume WHOOP will grant one. The implementation stores the exact granted data scopes and makes expired or missing refresh-token cases require reauthorization. WHOOP documents rotating refresh tokens, so refreshes are serialized and the replacement token file is atomically swapped.

The API must generate and validate a short-lived, unpredictable OAuth `state` value for each authorization attempt. Exchange the authorization code only on the backend. Store any granted tokens separately from health-data snapshots, protect them at rest, and account for refresh-token rotation. Never put secrets or tokens in the browser, source control, URLs beyond the provider's expected OAuth parameters, or logs.

## Data flow and retention

The Pi backend retrieves WHOOP v2 data directly from WHOOP over HTTPS. The dashboard receives only a minimized mapped response through the local API. It never imports server code or calls WHOOP directly. There is no health-data disk cache or archive. The API keeps one in-memory snapshot per display period only when a configured retention maximum and WHOOP response freshness allow it:

- Fetch the latest available sleep, recovery, body-measurement, and cycle data for the morning view.
- Replace the current snapshot when new data is fetched; do not append a permanent history.
- Clear the morning snapshot around noon and the evening snapshot around midnight, using the Pi's local time.
- Keep tokens independently so the integration can remain authorized; remove them on disconnect.

WHOOP's API terms and response cache headers govern how long WHOOP data may be cached. The cache uses the shortest of `WHOOP_CACHE_MAX_SECONDS`, upstream `max-age`/`s-maxage` or `Expires` after `Age`, and the next local noon/midnight boundary. `no-store`, `no-cache`, `must-revalidate`, missing upstream freshness, or a zero configured maximum means no server-side retention. The default is zero because developer/API retention terms and authenticated response headers have not been independently verified. The UI also clears browser-held snapshots at the local display boundary. Missing or delayed data and non-scored states are represented without substituting zeroes.

OAuth tokens are stored as an AES-256-GCM authenticated-encryption envelope with a fresh nonce and atomic replacement under `/var/lib/homelab/whoop/`. The 32-byte key is injected at runtime from `/etc/homelab/whoop.env`, outside the repository, image, and token volume; the env file must be root-only. The client secret is in that same protected host config file. Filesystem permissions alone are not encryption. The current key remains available to root, Docker daemon administrators, and the running container process; host compromise, memory/swap/core dumps, physical access, and backups are residual risks.

## Network and access

The dashboard and its health-data API are intended for local access on the home network, not public internet access. The WHOOP OAuth callback is a necessary exception: Cloudflare Tunnel exposes the specific callback hostname and forwards it to the Pi API. Cloudflare is therefore part of the callback/network path and may process request and connection metadata. The callback carries OAuth authorization information; the Pi API makes separate HTTPS requests to WHOOP for health data.

The API checks the request Host before routing. `connect.surviveness.com` is accepted only for `GET /oauth/whoop/callback`; every other public-host request, including dashboard assets and `/healthz`, is denied. Dashboard assets, API, and health routes accept only `localhost` or `127.0.0.1`. State-changing local API routes require the exact configured dashboard Origin. The API has no request logging. Ensure Cloudflare Access does not block the provider callback and verify Cloudflare/Tunnel logs do not retain authorization codes or state query values.

## Disconnect and deletion

Provide a local disconnect/reset action. It should attempt to revoke the WHOOP authorization using the supported endpoint, then delete local access and refresh tokens and clear the temporary WHOOP snapshot whether or not revocation succeeds. Report a revocation failure without retaining data unnecessarily. Also document that the user can revoke the integration from WHOOP.

## Remaining go-live gates

Before using real WHOOP health data, implement and verify:

1. Review the current WHOOP developer/API terms for local personal dashboard use and permitted cache duration. Verify actual authenticated API cache headers before setting `WHOOP_CACHE_MAX_SECONDS` above zero. Until then server snapshot retention stays disabled.
2. Verify Cloudflare/Tunnel logging/retention does not capture callback authorization-code/state query parameters. The API does not log requests; host nginx configuration is not changed by this deployment.
3. Configure and test the registered callback against the running Pi with a WHOOP Sandbox account, approve exactly the four requested data scopes, and verify whether `offline` produced a refresh token. Tests use synthetic responses and cannot verify Sandbox behavior.
4. Configure `/etc/homelab/whoop.env` with actual client values and a unique root-only encryption key; ensure `/var/lib/homelab/whoop` is writable only by the container's service UID. Confirm host backups protect the key and token volume.
5. Add accurate privacy/contact text wherever the dashboard is publicly discoverable. Keep the dashboard and API data routes local-only; keep the existing public tunnel hostname limited to the exact callback path at the application boundary.
