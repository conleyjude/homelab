# WHOOP integration

Single-user WHOOP v2 OAuth and dashboard integration. The server requests only `read:sleep`, `read:recovery`, `read:body_measurement`, and `read:cycles`, with `offline` requested for optional refresh-token access. It maps minimized response values for the local touchscreen dashboard; it does not fetch profile or workout data.

Server implementation lives in `server/`; UI and its safe local API client live in `dashboard/`. See the root [README](../../README.md) and [architecture](../../docs/architecture.md) for configuration, retention limits, and deployment gates.
