# Local API

Node.js 22 API process used by the locally attached kiosk browser. It listens on port `4001`, published on Pi loopback only, and serves the compiled dashboard from its image. It owns the WHOOP OAuth callback, encrypted token file, WHOOP v2 calls, and in-memory snapshot cleanup, plus the Open-Meteo forecast request and local weather route. Only the exact public callback route is accepted through `connect.surviveness.com`; dashboard and data routes require a loopback Host.

The API uses Node built-ins only. Start it with `npm start` from this directory after setting the local environment values described in the root [README](../../README.md).
