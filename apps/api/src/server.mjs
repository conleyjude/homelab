import { createServer } from 'node:http';
import { WhoopError } from '../../../integrations/whoop/server/whoop-client.mjs';

const PUBLIC_HOST = 'connect.surviveness.com';
const CALLBACK_PATH = '/oauth/whoop/callback';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function requestHost(request) {
  const host = request.headers.host;
  if (!host) return null;
  try { return new URL(`http://${host}`).hostname.toLowerCase(); } catch { return null; }
}

function json(response, status, value, allowedOrigin) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(allowedOrigin ? { 'access-control-allow-origin': allowedOrigin, vary: 'Origin' } : {}),
  });
  response.end(JSON.stringify(value));
}

function publicError(error) {
  if (!(error instanceof WhoopError)) return { status: 500, body: { error: 'internal_error' } };
  const statuses = {
    reconnect_required: 401,
    reauthorization_required: 401,
    permission_denied: 403,
    data_not_found: 404,
    rate_limited: 429,
    provider_unavailable: 503,
    provider_request_failed: 502,
    invalid_provider_response: 502,
    missing_scopes: 403,
  };
  const body = { error: error.code };
  if (error.retryAfterSeconds !== undefined) body.retryAfterSeconds = error.retryAfterSeconds;
  return { status: statuses[error.code] ?? 502, body };
}

async function readJson(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 4096) throw new Error('request_too_large');
  }
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error('invalid_json'); }
}

export function createApiServer({ service, config }) {
  return createServer(async (request, response) => {
    const host = requestHost(request);
    const url = new URL(request.url ?? '/', 'http://localhost');
    const origin = request.headers.origin;
    const allowedOrigin = origin === config.dashboardOrigin ? origin : null;

    if (host === PUBLIC_HOST) {
      if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { 'cache-control': 'no-store' });
        response.end();
        return;
      }
      const result = await service.callback(url.searchParams);
      const destination = new URL('/', config.dashboardOrigin);
      destination.searchParams.set('whoop', result.result);
      response.writeHead(303, { location: destination.toString(), 'cache-control': 'no-store' });
      response.end();
      return;
    }

    if (!LOCAL_HOSTS.has(host)) {
      response.writeHead(404, { 'cache-control': 'no-store' });
      response.end();
      return;
    }

    if (request.method === 'OPTIONS') {
      if (allowedOrigin && url.pathname.startsWith('/api/whoop/')) {
        response.writeHead(204, {
          'access-control-allow-origin': allowedOrigin,
          'access-control-allow-methods': 'GET, POST',
          'access-control-allow-headers': 'Content-Type',
          'access-control-max-age': '600',
          vary: 'Origin',
        });
        response.end();
      } else {
        response.writeHead(403, { 'cache-control': 'no-store' });
        response.end();
      }
      return;
    }

    try {
      if (request.method === 'GET' && url.pathname === '/healthz') {
        json(response, 200, { status: 'ok' }, allowedOrigin);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/whoop/status') {
        json(response, 200, await service.status(), allowedOrigin);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/whoop/snapshot') {
        const period = url.searchParams.get('period');
        if (!['morning', 'evening'].includes(period)) return json(response, 400, { error: 'invalid_period' }, allowedOrigin);
        json(response, 200, { period, snapshot: service.snapshot(period) }, allowedOrigin);
        return;
      }
      if (request.method === 'POST' && url.pathname.startsWith('/api/whoop/')) {
        if (!allowedOrigin) return json(response, 403, { error: 'origin_not_allowed' });
        if (url.pathname === '/api/whoop/connect') {
          json(response, 200, { authorizationUrl: service.authorizationUrl() }, allowedOrigin);
          return;
        }
        if (url.pathname === '/api/whoop/refresh') {
          const input = await readJson(request);
          if (!['morning', 'evening'].includes(input.period)) return json(response, 400, { error: 'invalid_period' }, allowedOrigin);
          json(response, 200, { period: input.period, snapshot: await service.refresh(input.period) }, allowedOrigin);
          return;
        }
        if (url.pathname === '/api/whoop/disconnect') {
          json(response, 200, await service.disconnect(), allowedOrigin);
          return;
        }
      }
      json(response, 404, { error: 'not_found' }, allowedOrigin);
    } catch (error) {
      const mapped = publicError(error);
      json(response, mapped.status, mapped.body, allowedOrigin);
    }
  });
}