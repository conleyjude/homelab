import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createApiServer } from '../src/server.mjs';

function sendWithHost(base, path, host, { method = 'GET', origin, body } = {}) {
  const target = new URL(path, base);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers: { host, ...(origin ? { origin } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: text }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function withServer(run) {
  const calls = [];
  const service = {
    async callback(query) { calls.push(['callback', query.get('state')]); return { result: 'denied' }; },
    async status() { calls.push(['status']); return { connection: 'disconnected', scopes: [] }; },
    snapshot(period) { calls.push(['snapshot', period]); return null; },
    authorizationUrl() { calls.push(['connect']); return 'https://api.prod.whoop.com/oauth/oauth2/auth?fake=1'; },
    async refresh(period) { calls.push(['refresh', period]); return { data: {} }; },
    async disconnect() { calls.push(['disconnect']); return { revoked: false, attempted: true }; },
  };
  const server = createApiServer({ service, config: { dashboardOrigin: 'http://localhost' } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`, calls); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('public tunnel host can reach only the exact OAuth callback endpoint', async () => {
  await withServer(async (base, calls) => {
    const callback = await sendWithHost(base, '/oauth/whoop/callback?state=fake', 'connect.surviveness.com');
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.location, 'http://localhost/?whoop=denied');

    for (const path of ['/healthz', '/api/whoop/status', '/api/whoop/snapshot?period=morning', '/oauth/other']) {
      const response = await sendWithHost(base, path, 'connect.surviveness.com');
      assert.equal(response.status, 404);
    }
    assert.equal((await sendWithHost(base, '/healthz', 'connect.surviveness.com', { method: 'OPTIONS', origin: 'http://localhost' })).status, 404);
    assert.equal((await sendWithHost(base, '/oauth/whoop/callback?state=fake', 'connect.surviveness.com', { method: 'POST' })).status, 404);
    assert.deepEqual(calls, [['callback', 'fake']]);
  });
});

test('local dashboard API works, while untrusted hosts and origins cannot access it', async () => {
  await withServer(async (base, calls) => {
    const health = await sendWithHost(base, '/healthz', 'localhost');
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body), { status: 'ok' });
    const localStatus = await sendWithHost(base, '/api/whoop/status', 'localhost', { origin: 'http://localhost' });
    assert.equal(localStatus.status, 200);
    assert.equal(localStatus.headers['access-control-allow-origin'], 'http://localhost');
    const preflight = await sendWithHost(base, '/api/whoop/connect', 'localhost', { method: 'OPTIONS', origin: 'http://localhost' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-methods'], 'GET, POST');
    const rejectedPreflight = await sendWithHost(base, '/api/whoop/connect', 'localhost', { method: 'OPTIONS', origin: 'https://attacker.example' });
    assert.equal(rejectedPreflight.status, 403);
    const forbiddenHost = await sendWithHost(base, '/api/whoop/status', 'example.com');
    assert.equal(forbiddenHost.status, 404);
    const forbiddenOrigin = await sendWithHost(base, '/api/whoop/connect', 'localhost', { method: 'POST', origin: 'https://attacker.example', body: '{}' });
    assert.equal(forbiddenOrigin.status, 403);
    assert.equal(calls.some(([kind]) => kind === 'connect'), false);
  });
});