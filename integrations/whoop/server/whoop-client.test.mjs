import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWhoopStatus, rateLimitDelaySeconds, requiredScopesGranted, WhoopClient, WhoopError } from './whoop-client.mjs';

test('only requested data scopes count as the required permissions', () => {
  assert.equal(requiredScopesGranted('read:sleep read:recovery read:cycles'), false);
  assert.equal(requiredScopesGranted('offline read:sleep read:recovery read:body_measurement read:cycles'), true);
});

test('WHOOP HTTP errors are bounded and response bodies are never surfaced', async () => {
  for (const [status, code] of [[401, 'reauthorization_required'], [403, 'permission_denied'], [404, 'data_not_found'], [429, 'rate_limited'], [503, 'provider_unavailable']]) {
    const client = new WhoopClient({ clientId: 'fake', clientSecret: 'fake', fetchImpl: async () => new Response('private response body', { status, headers: { 'retry-after': '5' } }) });
    await assert.rejects(client.get('/v2/cycle?limit=1', 'fake-access'), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes('private response body'), false);
      if (status === 429) assert.equal(error.retryAfterSeconds, 5);
      return true;
    });
  }
});

test('unknown transient status maps to a safe provider error', () => {
  const error = mapWhoopStatus(502);
  assert.ok(error instanceof WhoopError);
  assert.equal(error.code, 'provider_unavailable');
});

test('rate-limit reset headers are converted to a bounded retry delay', () => {
  const now = 1700000000000;
  assert.equal(rateLimitDelaySeconds(new Headers({ 'x-ratelimit-reset-after': '7' }), now), 7);
  assert.equal(rateLimitDelaySeconds(new Headers({ 'x-ratelimit-reset': '1700000008' }), now), 8);
  assert.equal(rateLimitDelaySeconds(new Headers({ 'retry-after': '3', 'x-ratelimit-reset-after': '9' }), now), 3);
});