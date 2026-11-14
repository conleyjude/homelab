# Weather integration

The dashboard's compact weather strip uses the Open-Meteo Forecast API from the existing local API container. Provider requests and WMO mapping live in `server/`; the kiosk component and same-origin API client live in `dashboard/`. The integration has no dependency on WHOOP modules or response contracts.

Configure `WEATHER_LATITUDE`, `WEATHER_LONGITUDE`, `WEATHER_LOCATION_LABEL`, and `WEATHER_TEMPERATURE_UNIT` in `/etc/homelab/whoop.env`. Coordinates are fixed configuration, not credentials. The existing `PI_TIMEZONE` controls Open-Meteo's daily forecast boundary. No API key, geocoder, external SDK, database, or response persistence is used.

The local API returns only the location label, current temperature and mapped condition, today's high/low and maximum precipitation probability, unit, timezone, and fetch time. It keeps a short in-memory cache, capped at 15 minutes and shortened by Open-Meteo cache headers. The dashboard fetches on load and on explicit refresh; WHOOP views remain usable if weather is unavailable. The displayed attribution links to Open-Meteo, whose weather data is published under CC BY 4.0.