import test from 'node:test';
import assert from 'node:assert/strict';
import { nextDisplayBoundary, providerCacheLifetimeSeconds, SnapshotCache } from './snapshot-cache.mjs';

test('snapshot expires at the earlier provider cache age or local display boundary', () => {
  let now = Date.parse('2026-03-10T11:00:00Z');
  const cache = new SnapshotCache({ timeZone: 'UTC', maxSeconds: 86400, now: () => now });
  cache.set('morning', { ready: true }, [{ cacheControl: 'public, max-age=600', age: '120' }]);

  assert.deepEqual(cache.get('morning')?.data, { ready: true });
  now += 481000;
  assert.equal(cache.get('morning'), null);
});

test('morning and evening snapshots have explicit local noon and midnight cleanup', () => {
  const morningNoon = Date.parse('2026-03-10T12:00:00Z');
  const eveningMidnight = Date.parse('2026-03-11T00:00:00Z');
  assert.equal(nextDisplayBoundary(Date.parse('2026-03-10T08:00:00Z'), 'morning', 'UTC'), morningNoon);
  assert.equal(nextDisplayBoundary(Date.parse('2026-03-10T20:00:00Z'), 'evening', 'UTC'), eveningMidnight);
  const afternoon = Date.parse('2026-03-10T13:00:00Z');
  assert.equal(nextDisplayBoundary(afternoon, 'morning', 'UTC'), afternoon);
});

test('no-cache and missing cache directives do not create a retained WHOOP snapshot', () => {
  assert.equal(providerCacheLifetimeSeconds({ cacheControl: 'no-cache' }, Date.now()), 0);
  const cache = new SnapshotCache({ maxSeconds: 0 });
  assert.equal(cache.set('morning', { sensitive: true }, [{ cacheControl: null }]), false);
  assert.equal(cache.get('morning'), null);
});

test('shared-cache freshness never extends a shorter private max-age', () => {
  assert.equal(providerCacheLifetimeSeconds({ cacheControl: 'max-age=90, s-maxage=300' }, Date.now()), 90);
  assert.equal(providerCacheLifetimeSeconds({ cacheControl: 's-maxage=300' }, Date.now()), undefined);
});