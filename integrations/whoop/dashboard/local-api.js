const API_BASE = import.meta.env.VITE_LOCAL_API_BASE_URL ?? 'http://localhost:4001';

export async function callWhoopApi(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    cache: 'no-store',
    headers: { accept: 'application/json', ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error ?? 'request_failed');
    error.status = response.status;
    error.retryAfterSeconds = body.retryAfterSeconds;
    throw error;
  }
  return body;
}

export const getConnectionStatus = () => callWhoopApi('/api/whoop/status');
export const getSnapshot = (period) => callWhoopApi(`/api/whoop/snapshot?period=${period}`);
export const startConnection = () => callWhoopApi('/api/whoop/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
export const refreshSnapshot = (period) => callWhoopApi('/api/whoop/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ period }) });
export const disconnectWhoop = () => callWhoopApi('/api/whoop/disconnect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });