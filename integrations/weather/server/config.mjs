const DEFAULT_TIME_ZONE = 'America/Chicago';

function requiredCoordinate(env, name, minimum, maximum) {
  const raw = env[name];
  if (typeof raw !== 'string' || raw.trim() === '') throw new Error(`${name} is required`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number from ${minimum} to ${maximum}`);
  }
  return value;
}

export function createWeatherConfig(env = process.env) {
  const latitude = requiredCoordinate(env, 'WEATHER_LATITUDE', -90, 90);
  const longitude = requiredCoordinate(env, 'WEATHER_LONGITUDE', -180, 180);
  const locationLabel = env.WEATHER_LOCATION_LABEL?.trim();
  if (!locationLabel || locationLabel.length > 80 || /[\u0000-\u001f\u007f]/.test(locationLabel)) {
    throw new Error('WEATHER_LOCATION_LABEL is required and must be 1 to 80 printable characters');
  }

  const temperatureUnit = env.WEATHER_TEMPERATURE_UNIT;
  if (!['celsius', 'fahrenheit'].includes(temperatureUnit)) {
    throw new Error('WEATHER_TEMPERATURE_UNIT must be celsius or fahrenheit');
  }

  const timeZone = env.PI_TIMEZONE ?? DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new Error('PI_TIMEZONE must be a valid IANA timezone');
  }

  return { latitude, longitude, locationLabel, temperatureUnit, timeZone };
}