# Local API

The local backend for the dashboard. It owns provider OAuth callbacks, API requests, token and temporary snapshot storage, and refresh or cleanup scheduling. The planned WHOOP callback is `/oauth/whoop/callback`; the process is intended to listen on port `4001` on the Pi.

Do not expose dashboard or health-data endpoints through the public tunnel. No server implementation exists yet.