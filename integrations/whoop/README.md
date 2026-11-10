# WHOOP integration

Initial integration for the owner's WHOOP account. Planned data permissions: `read:sleep`, `read:recovery`, `read:body_measurement`, and `read:cycles`. The `offline` scope may be requested during OAuth to seek refresh-token access; availability must be verified.

Keep OAuth and API code under `server/`, display components under `dashboard/`, and any dashboard-facing response shape in a provider-safe contract. See [architecture](../../docs/architecture.md) before implementing storage or caching.