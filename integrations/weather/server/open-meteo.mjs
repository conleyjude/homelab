const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const MAX_CACHE_SECONDS = 900;
const REQUEST_TIMEOUT_MS = 8000;
const WIND_SPEED_LABELS = { kmh: 'km/h', mph: 'mph', ms: 'm/s', kn: 'kn' };
const WIND_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class WeatherError extends Error {
  constructor(code) {
    super(code);
    this.name = 'WeatherError';
    this.code = code;
  }
}

const conditions = new Map([
  [0, ['Clear', 'sun']],
  [1, ['Mostly clear', 'cloud-sun']],
  [2, ['Partly cloudy', 'cloud-sun']],
  [3, ['Overcast', 'cloud']],
  [45, ['Fog', 'cloud-fog']],
  [48, ['Freezing fog', 'cloud-fog']],
  [51, ['Light drizzle', 'cloud-drizzle']],
  [53, ['Drizzle', 'cloud-drizzle']],
  [55, ['Heavy drizzle', 'cloud-drizzle']],
  [56, ['Freezing drizzle', 'cloud-drizzle']],
  [57, ['Heavy freezing drizzle', 'cloud-drizzle']],
  [61, ['Light rain', 'cloud-rain']],
  [63, ['Rain', 'cloud-rain']],
  [65, ['Heavy rain', 'cloud-rain']],
  [66, ['Freezing rain', 'cloud-rain']],
  [67, ['Heavy freezing rain', 'cloud-rain']],
  [71, ['Light snow', 'cloud-snow']],
  [73, ['Snow', 'cloud-snow']],
  [75, ['Heavy snow', 'cloud-snow']],
  [77, ['Snow grains', 'cloud-snow']],
  [80, ['Light showers', 'cloud-rain']],
  [81, ['Showers', 'cloud-rain']],
  [82, ['Heavy showers', 'cloud-rain']],
  [85, ['Snow showers', 'cloud-snow']],
  [86, ['Heavy snow showers', 'cloud-snow']],
  [95, ['Thunderstorm', 'cloud-lightning']],
  [96, ['Thunderstorm with hail', 'cloud-lightning']],
  [99, ['Heavy thunderstorm with hail', 'cloud-lightning']],
]);

export function mapWeatherCode(code) {
  return conditions.get(code) ?? ['Conditions unknown', 'cloud'];
}

export function mapWindDirection(degrees) {
  if (!Number.isFinite(degrees) || degrees < 0 || degrees > 360) return null;
  return WIND_DIRECTIONS[Math.round((degrees % 360) / 45) % WIND_DIRECTIONS.length];
}

export function buildForecastUrl(config) {
  const url = new URL(FORECAST_ENDPOINT);
  url.search = new URLSearchParams({
    latitude: String(config.latitude),
    longitude: String(config.longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: config.temperatureUnit,
    wind_speed_unit: config.windSpeedUnit,
    timezone: config.timeZone,
    forecast_days: '1',
  }).toString();
  return url;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstFinite(values) {
  return Array.isArray(values) && Number.isFinite(values[0]) ? values[0] : null;
}

export function mapForecast(payload, config, fetchedAt) {
  const current = payload?.current;
  const daily = payload?.daily;
  const high = firstFinite(daily?.temperature_2m_max);
  const low = firstFinite(daily?.temperature_2m_min);
  const precipitationChance = firstFinite(daily?.precipitation_probability_max);
  if (!isRecord(payload) || !isRecord(current) || !isRecord(daily)
    || !Number.isFinite(current.temperature_2m) || !Number.isFinite(current.apparent_temperature)
    || !Number.isInteger(current.weather_code) || !Number.isFinite(current.wind_speed_10m) || current.wind_speed_10m < 0
    || !Number.isFinite(current.wind_direction_10m) || current.wind_direction_10m < 0 || current.wind_direction_10m > 360
    || typeof daily.time?.[0] !== 'string' || high === null || low === null
    || precipitationChance === null || precipitationChance < 0 || precipitationChance > 100) {
    throw new WeatherError('invalid_provider_response');
  }

  const [condition, icon] = mapWeatherCode(current.weather_code);
  const temperatureUnit = config.temperatureUnit === 'fahrenheit' ? '°F' : '°C';
  return {
    location: config.locationLabel,
    timeZone: config.timeZone,
    current: { temperature: current.temperature_2m, feelsLike: current.apparent_temperature, condition, icon },
    wind: {
      speed: current.wind_speed_10m,
      speedUnit: WIND_SPEED_LABELS[config.windSpeedUnit],
      direction: current.wind_direction_10m,
      directionLabel: mapWindDirection(current.wind_direction_10m),
    },
    today: { high, low, precipitationChance },
    temperatureUnit,
    fetchedAt,
  };
}

function parseAge(value) {
  const age = Number(value);
  return Number.isFinite(age) && age >= 0 ? age : 0;
}

export function providerCacheLifetimeSeconds(headers, now = Date.now()) {
  const cacheControl = headers.cacheControl?.toLowerCase() ?? '';
  if (/(^|,)\s*(no-store|no-cache)(\s|,|$)/.test(cacheControl)) return 0;

  const maxAge = /(?:^|,)\s*max-age=(\d+)/.exec(cacheControl);
  if (maxAge) return Math.max(0, Math.min(MAX_CACHE_SECONDS, Number(maxAge[1]) - parseAge(headers.age)));

  if (headers.expires) {
    const expiresAt = Date.parse(headers.expires);
    if (Number.isFinite(expiresAt)) {
      const seconds = Math.floor((expiresAt - now) / 1000) - parseAge(headers.age);
      return Math.max(0, Math.min(MAX_CACHE_SECONDS, seconds));
    }
    return 0;
  }

  return cacheControl ? 0 : MAX_CACHE_SECONDS;
}

export class OpenMeteoClient {
  constructor({ config, fetchImpl = fetch, now = Date.now, timeoutMs = REQUEST_TIMEOUT_MS }) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
  }

  async fetchForecast() {
    let response;
    try {
      response = await this.fetchImpl(buildForecastUrl(this.config), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new WeatherError('provider_timeout');
      throw new WeatherError('provider_unavailable');
    }
    if (!response.ok) throw new WeatherError('provider_request_failed');

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new WeatherError('invalid_provider_response');
    }

    const fetchedAt = new Date(this.now()).toISOString();
    const snapshot = mapForecast(payload, this.config, fetchedAt);
    const lifetimeSeconds = providerCacheLifetimeSeconds({
      cacheControl: response.headers?.get('cache-control'),
      expires: response.headers?.get('expires'),
      age: response.headers?.get('age'),
    }, this.now());
    return { snapshot, lifetimeSeconds };
  }
}