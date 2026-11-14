import React, { useEffect, useState } from 'react';
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, RefreshCw, Sun } from 'lucide-react';
import { getWeatherSnapshot } from './local-api.js';
import './WeatherStrip.css';

const icons = {
  sun: Sun,
  'cloud-sun': CloudSun,
  cloud: Cloud,
  'cloud-fog': CloudFog,
  'cloud-drizzle': CloudDrizzle,
  'cloud-rain': CloudRain,
  'cloud-snow': CloudSnow,
  'cloud-lightning': CloudLightning,
};

function updatedTime(snapshot) {
  if (!snapshot?.fetchedAt) return '';
  try {
    return new Intl.DateTimeFormat([], {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: snapshot.timeZone,
    }).format(new Date(snapshot.fetchedAt));
  } catch {
    return '';
  }
}

export default function WeatherStrip() {
  const [snapshot, setSnapshot] = useState(null);
  const [state, setState] = useState('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getWeatherSnapshot()
      .then(({ snapshot: result }) => {
        if (!active) return;
        setSnapshot(result);
        setState('ready');
      })
      .catch(() => { if (active) setState('unavailable'); });
    return () => { active = false; };
  }, []);

  async function refresh() {
    setBusy(true);
    try {
      const { snapshot: result } = await getWeatherSnapshot({ refresh: true });
      setSnapshot(result);
      setState('ready');
    } catch {
      setState(snapshot ? 'stale' : 'unavailable');
    } finally {
      setBusy(false);
    }
  }

  const WeatherIcon = icons[snapshot?.current?.icon] ?? Cloud;
  const currentLabel = state === 'loading'
    ? 'Loading forecast'
    : state === 'unavailable'
      ? 'Weather unavailable'
      : snapshot?.current?.condition ?? 'Conditions unavailable';
  const updated = updatedTime(snapshot);

  return <section className={`weather-strip weather-strip--${state}`} aria-label="Local weather">
    <div className="weather-strip__current">
      <WeatherIcon className="weather-strip__icon" size={27} strokeWidth={1.8} aria-hidden="true" />
      <div className="weather-strip__current-copy">
        <span className="weather-strip__location">{snapshot?.location ?? 'Home weather'}</span>
        <div className="weather-strip__reading">
          {snapshot && <strong>{Math.round(snapshot.current.temperature)}{snapshot.temperatureUnit}</strong>}
          <span>{currentLabel}</span>
        </div>
      </div>
    </div>

    {snapshot && <div className="weather-strip__today" aria-label="Today's forecast">
      <div><span className="weather-strip__label">HIGH / LOW</span><strong>{Math.round(snapshot.today.high)}° / {Math.round(snapshot.today.low)}°</strong></div>
      <div><span className="weather-strip__label">PRECIP</span><strong>{Math.round(snapshot.today.precipitationChance)}%</strong></div>
    </div>}

    <div className="weather-strip__meta">
      <span>{state === 'stale' ? `Stale · updated ${updated}` : updated ? `Updated ${updated}` : 'Forecast pending'}</span>
      <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo.com</a>
    </div>

    <button className="weather-strip__refresh" type="button" title="Refresh weather" aria-label="Refresh weather" disabled={busy || state === 'loading'} onClick={refresh}>
      <RefreshCw size={16} className={busy ? 'spin' : ''} aria-hidden="true" />
    </button>
  </section>;
}