# Dashboard app

Vite/React UI compiled into the API container and served to Chromium at `http://localhost:4001` on the physically attached touchscreen. The WHOOP display stays under `integrations/whoop/dashboard/`; the independent Open-Meteo weather strip is under `integrations/weather/dashboard/`. Browser code calls only the local API and contains no provider credentials or server code.

Run `npm install` and `npm run build` in this directory; see the root [README](../../README.md) for Pi deployment details.
