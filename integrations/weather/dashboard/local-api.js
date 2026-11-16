const API_BASE = import.meta.env.VITE_LOCAL_API_BASE_URL ?? 'http://localhost:4001';

export async function getWeatherSnapshot({ refresh = false } = {}) {
  const query = refresh ? '?refresh=1' : '';
  const response = await fetch(`${API_BASE}/api/weather/snapshot${query}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error ?? 'weather_unavailable');
    error.status = response.status;
    throw error;
  }
  return body;
}