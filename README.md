# Homelab

A local-first home dashboard and integration hub, starting with a personal WHOOP dashboard on a Raspberry Pi.

## Project status

Planning and repository scaffolding only. The dashboard, API, OAuth flow, encrypted storage, and cleanup jobs have not been implemented yet. Do not put real WHOOP credentials or health data in this repository.

## Repository layout

- `apps/dashboard/`: browser UI that composes the display from integration widgets.
- `apps/api/`: local API, OAuth callbacks, data retrieval, storage, and scheduling.
- `integrations/<provider>/server/`: provider-specific authorization, API client, and mapping code. Server-only; never bundle this code into the browser.
- `integrations/<provider>/dashboard/`: provider-specific display components. These consume the local API contract and contain no provider credentials.
- `packages/dashboard-contracts/`: shared, provider-neutral API types when more than one app needs them.
- `devices/`: firmware and notes for microcontroller projects, added as needed.
- `deploy/pi/`: Raspberry Pi service and proxy configuration examples and deployment notes.
- `docs/`: architecture and decisions that affect more than one integration.

## Initial WHOOP integration

The planned WHOOP integration uses `read:sleep`, `read:recovery`, `read:body_measurement`, and `read:cycles`. The OAuth authorization request may also request WHOOP's `offline` scope to obtain a refresh token; whether one is granted must be verified during testing.

The planned callback is `https://connect.surviveness.com/oauth/whoop/callback`, routed by the existing Cloudflare Tunnel to the Pi API on port `4001`. The Pi API should own OAuth state validation, code exchange, token refresh, and WHOOP API calls. The browser should call only the local API.

See [docs/architecture.md](docs/architecture.md) for the planned data flow, retention, and implementation gates.

## Development and deployment

No framework, package manager, or build commands have been selected or installed yet. Add them when implementing the first working slice, and document the resulting setup and checks here.