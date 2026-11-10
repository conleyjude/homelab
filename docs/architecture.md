# Architecture

## Status and scope

This document describes the intended first version; it is not a description of a running implementation. The first release is a single-user, local-first WHOOP dashboard hosted on the Raspberry Pi. It displays sleep, recovery, body measurements, and cycle summaries for the owner's WHOOP account. It is not a public health-data service and is not intended to provide medical diagnosis, treatment, or advice.

Weather, Oura, and microcontroller sensors are possible later integrations, not part of the initial WHOOP implementation.

## Component boundaries

```text
Browser / Pi display
  -> dashboard app
  -> local API on the Pi
       -> WHOOP integration (OAuth and API calls)
       -> local token and temporary snapshot storage

WHOOP OAuth redirect
  -> https://connect.surviveness.com/oauth/whoop/callback
  -> Cloudflare Tunnel
  -> local API on the Pi (port 4001)
```

- `apps/dashboard/` composes dashboard widgets and displays data received from the local API. It must not contain OAuth client secrets, access tokens, or refresh tokens.
- `apps/api/` is the single local backend process. It owns callback handling, state validation, token exchange and refresh, local API routes, storage, and any scheduled refresh or cleanup work.
- `integrations/whoop/server/` owns WHOOP-specific OAuth configuration, HTTP calls, API response mapping, and revocation behavior. Keep it server-only.
- `integrations/whoop/dashboard/` owns the WHOOP display component and consumes a limited dashboard-facing data contract. It must not call WHOOP directly.
- `packages/dashboard-contracts/` is for shared response shapes only when needed. Avoid normalizing distinct provider scores into misleading interchangeable values.
- `devices/` and future providers can be added independently without becoming separate running services by default.

The dashboard and API are planned to run as separate processes on the Pi. The API uses port `4001`; the existing nginx and Cloudflare Tunnel setup can continue serving the website on port `80` while the tunnel routes the dedicated `connect.surviveness.com` hostname to the API.

## WHOOP authorization and permissions

The WHOOP app is in Sandbox mode. The planned data permissions are:

- `read:sleep`
- `read:recovery`
- `read:body_measurement`
- `read:cycles`

The API's `offline` scope is requested as part of the OAuth authorization flow, not selected as a data permission in the developer app setup. Request it to seek a refresh token, but do not assume WHOOP will grant one. Test the returned token set and handle the case where reauthorization is needed.

The API must generate and validate a short-lived, unpredictable OAuth `state` value for each authorization attempt. Exchange the authorization code only on the backend. Store any granted tokens separately from health-data snapshots, protect them at rest, and account for refresh-token rotation. Never put secrets or tokens in the browser, source control, URLs beyond the provider's expected OAuth parameters, or logs.

## Data flow and retention

The Pi backend retrieves WHOOP data directly from WHOOP over HTTPS. The dashboard receives only the data it needs from the local API. The intended storage model is one replaceable current snapshot, not an archive:

- Fetch the latest available sleep, recovery, body-measurement, and cycle data for the morning view.
- Replace the current snapshot when new data is fetched; do not append a permanent history.
- Clear the morning snapshot around noon and the evening snapshot around midnight, using the Pi's local time.
- Keep tokens independently so the integration can remain authorized; remove them on disconnect.

WHOOP's API terms and the response cache headers govern how long WHOOP data may be cached. The noon/midnight schedule is only a target: implement an earlier expiry whenever the applicable WHOOP cache directive requires it. Confirm the current terms and cache behavior against actual API responses before relying on this schedule. Missing or delayed data should be represented as such; data freshness depends on WHOOP processing and sync availability.

Do not use a persistent health-data cache until encryption at rest is implemented and verified. Keep runtime state outside the repository, for example under `/var/lib/homelab/`, and keep secrets outside the repository, for example under `/etc/homelab/`. Filesystem permissions alone are not a substitute for the required encryption at rest.

## Network and access

The dashboard and its health-data API are intended for local access on the home network, not public internet access. The WHOOP OAuth callback is a necessary exception: Cloudflare Tunnel exposes the specific callback hostname and forwards it to the Pi API. Cloudflare is therefore part of the callback/network path and may process request and connection metadata. The callback carries OAuth authorization information; the Pi API makes separate HTTPS requests to WHOOP for health data.

Keep the public API surface limited to the required OAuth callback. Do not expose dashboard or health-data routes through the tunnel. Ensure any Cloudflare Access configuration does not block the provider's callback request; enforce OAuth state validation in the application.

## Disconnect and deletion

Provide a local disconnect/reset action. It should attempt to revoke the WHOOP authorization using the supported endpoint, then delete local access and refresh tokens and clear the temporary WHOOP snapshot whether or not revocation succeeds. Report a revocation failure without retaining data unnecessarily. Also document that the user can revoke the integration from WHOOP.

## Implementation gates

Before using real WHOOP health data, implement and verify:

1. OAuth state validation, server-side code exchange, secret handling, and refresh-token rotation or a clear reauthorization path.
2. Encryption at rest for stored tokens and any temporary WHOOP data, with encryption keys managed separately from encrypted data and excluded from source control.
3. Cache expiry that obeys WHOOP response cache headers and terms, plus noon/midnight cleanup as a secondary bound.
4. No sensitive token or health-data logging; inspect application and reverse-proxy logging behavior.
5. Local-only access to the dashboard and data routes, while leaving only the necessary callback reachable through Cloudflare Tunnel.
6. Disconnect behavior that revokes provider access and deletes local tokens and cached data.
7. Privacy policy text and public contact details that match the implemented behavior.