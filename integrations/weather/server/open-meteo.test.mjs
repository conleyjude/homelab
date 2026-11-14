import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherConfig } from './config.mjs';
import { buildForecastUrl, mapForecast, mapWeatherCode, OpenMeteoClient, providerCacheLifetimeSeconds, WeatherError } from './open-meteo.mjs';
import { WeatherService } from './service.mjs';

const config = createWeatherConfig({
  WEATHER_LATITUDE: '41.8781',
  WEATHER_LONGITUDE: '-87.6298',
  WEATHER_LOCATION_LABEL: 'Chicago home',
  WEATHER_TEMPERATURE_UNIT: 'fahrenheit',
  PI_TIMEZONE: 'America/Chicago',
});

const providerForecast = {
  current: { temperature_2m: 68.4, weather_code: 2 },
  daily: {
    time: ['2026-11-14'],
    temperature_2m_max: [72.1],
    temperature_2m_min: [48.3],
    precipitation_probability_max: [35],
  },
};

function forecastResponse(headers = {}) {
  return new Response(JSON.stringify(providerForecast), { status: 200, headers });
}

test('weather config requires bounded coordinates, a label, units, and a valid Pi timezone', () => {
  assert.throws(() => createWeatherConfig({}), /WEATHER_LATITUDE is required/);
  assert.throws(() => createWeatherConfig({
    WEATHER_LATITUDE: '91', WEATHER_LONGITUDE: '0', WEATHER_LOCATION_LABEL: 'Home', WEATHER_TEMPERATURE_UNIT: 'celsius',
  }), /WEATHER_LATITUDE must be a number/);
  assert.throws(() => createWeatherConfig({
    WEATHER_LATITUDE: '0', WEATHER_LONGITUDE: '0', WEATHER_LOCATION_LABEL: 'Home', WEATHER_TEMPERATURE_UNIT: 'kelvin',
  }), /WEATHER_TEMPERATURE_UNIT must be celsius or fahrenheit/);
  assert.throws(() => createWeatherConfig({
    WEATHER_LATITUDE: '0', WEATHER_LONGITUDE: '0', WEATHER_LOCATION_LABEL: 'Home', WEATHER_TEMPERATURE_UNIT: 'celsius', PI_TIMEZONE: 'Mars/Olympus',
  }), /PI_TIMEZONE must be a valid IANA timezone/);
});

test('Open-Meteo request uses configured location, units, timezone, and only screen fields', async () => {
  const url = buildForecastUrl(config);
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    latitude: '41.8781',
    longitude: '-87.6298',
    current: 'temperature_2m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: 'fahrenheit',
    timezone: 'America/Chicago',
    forecast_days: '1',
  });

  let requestedUrl;
  const client = new OpenMeteoClient({
    config,
    now: () => Date.parse('2026-11-14T16:00:00Z'),
    fetchImpl: async (requestUrl) => { requestedUrl = requestUrl.toString(); return forecastResponse(); },
  });
  const result = await client.fetchForecast();
  assert.equal(requestedUrl, url.toString());
  assert.equal(result.snapshot.location, 'Chicago home');
  assert.equal(result.snapshot.temperatureUnit, '°F');
  assert.equal(result.snapshot.current.temperature, 68.4);
  assert.equal(result.snapshot.today.high, 72.1);
});

test('provider mapping returns stable conditions and concise WMO descriptions', () => {
  assert.deepEqual(mapWeatherCode(0), ['Clear', 'sun']);
  assert.deepEqual(mapWeatherCode(95), ['Thunderstorm', 'cloud-lightning']);
  assert.deepEqual(mapWeatherCode(999), ['Conditions unknown', 'cloud']);
  assert.deepEqual(mapForecast(providerForecast, config, '2026-11-14T16:00:00.000Z'), {
    location: 'Chicago home',
    timeZone: 'America/Chicago',
    current: { temperature: 68.4, condition: 'Partly cloudy', icon: 'cloud-sun' },
    today: { high: 72.1, low: 48.3, precipitationChance: 35 },
    temperatureUnit: '°F',
    fetchedAt: '2026-11-14T16:00:00.000Z',
  });
});

test('malformed provider responses, HTTP errors, network errors, and timeouts are safely classified', async () => {
  const clientFor = (fetchImpl) => new OpenMeteoClient({ config, fetchImpl });
  await assert.rejects(clientFor(async () => new Response('not json')).fetchForecast(), (error) => error.code === 'invalid_provider_response');
  await assert.rejects(clientFor(async () => new Response(JSON.stringify({ current: {}, daily: {} }))).fetchForecast(), (error) => error.code === 'invalid_provider_response');
  await assert.rejects(clientFor(async () => new Response('private body', { status: 503 })).fetchForecast(), (error) => {
    assert.equal(error.code, 'provider_request_failed');
    assert.equal(error.message.includes('private body'), false);
    return true;
  });
  await assert.rejects(clientFor(async () => { throw new Error('URL and coordinates must stay private'); }).fetchForecast(), (error) => error.code === 'provider_unavailable');
  await assert.rejects(clientFor(async () => { const error = new Error('timed out'); error.name = 'TimeoutError'; throw error; }).fetchForecast(), (error) => error.code === 'provider_timeout');
});

test('forecast cache is bounded by upstream max-age and no-store prevents retention', async () => {
  let now = Date.parse('2026-11-14T16:00:00Z');
  let requests = 0;
  const service = new WeatherService({
    config,
    now: () => now,
    fetchImpl: async () => { requests += 1; return forecastResponse({ 'cache-control': 'public, max-age=60' }); },
  });

  await service.snapshot();
  await service.snapshot();
  assert.equal(requests, 1);
  now += 60001;
  await service.snapshot();
  assert.equal(requests, 2);

  assert.equal(providerCacheLifetimeSeconds({ cacheControl: 'public, max-age=600', age: '120' }, now), 480);
  assert.equal(providerCacheLifetimeSeconds({ cacheControl: 'max-age=60, must-revalidate' }, now), 60);
  assert.equal(providerCacheLifetimeSeconds({ cacheControl: 'no-store, max-age=600' }, now), 0);
  assert.equal(providerCacheLifetimeSeconds({ cacheControl: null, expires: null, age: null }, now), 900);

  let uncachedRequests = 0;
  const uncached = new WeatherService({
    config,
    fetchImpl: async () => { uncachedRequests += 1; return forecastResponse({ 'cache-control': 'no-store' }); },
  });
  await uncached.snapshot();
  await uncached.snapshot();
  assert.equal(uncachedRequests, 2);
});

test('weather provider errors use a dedicated error type without provider details', async () => {
  const client = new OpenMeteoClient({ config, fetchImpl: async () => { throw new Error('private details'); } });
  await assert.rejects(client.fetchForecast(), (error) => {
    assert.ok(error instanceof WeatherError);
    assert.equal(error.message, 'provider_unavailable');
    return true;
  });
});