# Dashboard app

Static Vite/React UI served by the Pi's existing host nginx to Chromium running on the physically attached touchscreen. The WHOOP display stays under `integrations/whoop/dashboard/` and calls the API at `http://localhost:4001` using the single configured kiosk origin. It contains no credentials or provider server code.

Run `npm install` and `npm run build` in this directory; see the root [README](../../README.md) for Pi deployment details.
