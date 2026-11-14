import test from 'node:test';
import assert from 'node:assert/strict';
import { WhoopService } from './service.mjs';
import { CALLBACK_URI } from './config.mjs';

const scopes = 'read:sleep read:recovery read:body_measurement read:cycles offline';

function makeService({ fetchImpl, tokens = null, now = () => 100000 } = {}) {
  const memory = { current: tokens, writes: 0, clears: 0 };
  const tokenStore = {
    async read() { return memory.current; },
    async write(value) { memory.current = structuredClone(value); memory.writes += 1; },
    async clear() { memory.current = null; memory.clears += 1; },
  };
  const config = { clientId: 'fake-client', clientSecret: 'fake-secret', tokenEncryptionKey: Buffer.alloc(32), tokenFile: '/tmp/unused', cacheMaxSeconds: 600, timeZone: 'UTC', dashboardOrigin: 'http://localhost' };
  return { service: new WhoopService({ config, tokenStore, fetchImpl, now }), memory };
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('OAuth callback consumes state once, exchanges with exact registered URI, and handles denial', async () => {
  let tokenRequests = 0;
  let requestBody;
  const { service, memory } = makeService({ fetchImpl: async (_url, options) => {
    tokenRequests += 1;
    requestBody = new URLSearchParams(options.body);
    return jsonResponse({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3600, scope: scopes });
  } });
  const authorization = new URL(service.authorizationUrl());
  assert.equal(authorization.searchParams.get('redirect_uri'), CALLBACK_URI);
  assert.equal(authorization.searchParams.get('scope'), scopes);
  const state = authorization.searchParams.get('state');
  const callback = new URLSearchParams({ state, code: 'fake-code' });

  assert.deepEqual(await service.callback(callback), { result: 'connected' });
  assert.equal(requestBody.get('redirect_uri'), CALLBACK_URI);
  assert.equal(memory.writes, 1);
  assert.equal((await service.callback(callback)).result, 'invalid_state');
  assert.equal(tokenRequests, 1);

  const denialUrl = new URL(service.authorizationUrl());
  assert.equal((await service.callback(new URLSearchParams({ state: denialUrl.searchParams.get('state'), error: 'access_denied' }))).result, 'denied');
  assert.equal(tokenRequests, 1);
});

test('OAuth callback rejects invalid state and missing required scopes without storing tokens', async () => {
  const { service, memory } = makeService({ fetchImpl: async () => jsonResponse({ access_token: 'fake-access', expires_in: 3600, scope: 'read:sleep read:recovery read:cycles' }) });
  assert.equal((await service.callback(new URLSearchParams({ state: 'attacker-state', code: 'fake-code' }))).result, 'invalid_state');
  const authorization = new URL(service.authorizationUrl());
  const result = await service.callback(new URLSearchParams({ state: authorization.searchParams.get('state'), code: 'fake-code' }));
  assert.equal(result.result, 'missing_scopes');
  assert.equal(memory.writes, 0);
});

test('connection state asks to reconnect when WHOOP did not grant a refresh token', async () => {
  const { service, memory } = makeService({ tokens: { accessToken: 'short-lived-access', refreshToken: null, expiresAt: 999999, scopes: scopes.split(' ') } });
  assert.deepEqual(await service.status(), { connection: 'reconnect_required', canFetch: true, scopes: scopes.split(' ') });
  assert.equal(memory.clears, 0);
});

test('expired access without a refresh token requires reconnect before data can be fetched', async () => {
  const { service } = makeService({ tokens: { accessToken: 'expired-access', refreshToken: null, expiresAt: 1, scopes: scopes.split(' ') } });
  assert.equal((await service.status()).canFetch, false);
});

test('refresh token rotation is serialized and the replacement refresh token is saved', async () => {
  let refreshRequests = 0;
  let now = 100000;
  const tokens = { accessToken: 'expired-access', refreshToken: 'old-refresh', expiresAt: now - 1, scopes: scopes.split(' ') };
  const { service, memory } = makeService({ tokens, now: () => now, fetchImpl: async (url) => {
    if (url.includes('/oauth2/token')) {
      refreshRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, scope: scopes });
    }
    return jsonResponse({ records: [] }, { headers: { 'cache-control': 'max-age=300' } });
  } });

  const [first, second] = await Promise.all([service.refresh('morning'), service.refresh('evening')]);
  assert.equal(refreshRequests, 1);
  assert.equal(memory.current.accessToken, 'rotated-access');
  assert.equal(memory.current.refreshToken, 'rotated-refresh');
  assert.equal(first.data.sleep.state, 'MISSING');
  assert.equal(second.data.cycle.state, 'MISSING');
  now += 1;
});

test('disconnect clears tokens and all snapshots even when provider revocation fails', async () => {
  const tokens = { accessToken: 'fake-access', refreshToken: 'fake-refresh', expiresAt: 999999, scopes: scopes.split(' ') };
  const { service, memory } = makeService({ tokens, fetchImpl: async (url) => {
    if (url.endsWith('/v2/user/access')) return new Response(null, { status: 500 });
    return jsonResponse({ records: [{ score_state: 'PENDING_SCORE' }] }, { headers: { 'cache-control': 'max-age=60' } });
  } });
  await service.refresh('evening');
  assert.ok(service.snapshot('evening'));
  const result = await service.disconnect();
  assert.equal(result.attempted, true);
  assert.equal(result.revoked, false);
  assert.equal(memory.current, null);
  assert.equal(memory.clears, 1);
  assert.equal(service.snapshot('evening'), null);
});

test('disconnect waits for an active refresh and removes tokens and data produced by it', async () => {
  let releaseTokenResponse;
  let tokenRequestStarted;
  const started = new Promise((resolve) => { tokenRequestStarted = resolve; });
  const tokenGate = new Promise((resolve) => { releaseTokenResponse = resolve; });
  const tokens = { accessToken: 'expired-access', refreshToken: 'old-refresh', expiresAt: 1, scopes: scopes.split(' ') };
  const { service, memory } = makeService({ tokens, fetchImpl: async (url) => {
    if (url.includes('/oauth2/token')) {
      tokenRequestStarted();
      await tokenGate;
      return jsonResponse({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, scope: scopes });
    }
    if (url.endsWith('/v2/user/access')) return new Response(null, { status: 204 });
    if (url.endsWith('/v2/user/measurement/body')) return jsonResponse({ height_meter: 1.7, weight_kilogram: 65, max_heart_rate: 180 }, { headers: { 'cache-control': 'max-age=300' } });
    return jsonResponse({ records: [] }, { headers: { 'cache-control': 'max-age=300' } });
  } });

  const refreshOperation = service.refresh('morning');
  await started;
  const disconnectOperation = service.disconnect();
  releaseTokenResponse();
  await Promise.all([refreshOperation, disconnectOperation]);

  assert.equal(memory.current, null);
  assert.equal(service.snapshot('morning'), null);
});

test('disconnect prevents an in-flight OAuth callback from persisting newly exchanged credentials', async () => {
  let releaseTokenResponse;
  let tokenRequestStarted;
  let revokeRequests = 0;
  const started = new Promise((resolve) => { tokenRequestStarted = resolve; });
  const tokenGate = new Promise((resolve) => { releaseTokenResponse = resolve; });
  const { service, memory } = makeService({ fetchImpl: async (url) => {
    if (url.includes('/oauth2/token')) {
      tokenRequestStarted();
      await tokenGate;
      return jsonResponse({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600, scope: scopes });
    }
    if (url.endsWith('/v2/user/access')) {
      revokeRequests += 1;
      return new Response(null, { status: 204 });
    }
    throw new Error('unexpected request');
  } });
  const authorization = new URL(service.authorizationUrl());
  const callbackOperation = service.callback(new URLSearchParams({ state: authorization.searchParams.get('state'), code: 'fake-code' }));
  await started;
  const disconnectOperation = service.disconnect();
  releaseTokenResponse();

  const [callback] = await Promise.all([callbackOperation, disconnectOperation]);
  assert.equal(callback.result, 'disconnecting');
  assert.equal(revokeRequests, 1);
  assert.equal(memory.current, null);
  assert.equal(memory.writes, 0);
});