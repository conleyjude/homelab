import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldExpireSnapshot } from './snapshot-expiry.mjs';

test('pre-noon morning snapshot expires after noon', () => {
  const fetched = { fetchedAt: '2026-11-14T16:00:00Z' };
  assert.equal(shouldExpireSnapshot('morning', fetched, new Date('2026-11-14T18:00:00Z'), 'America/Chicago'), true);
});

test('morning snapshot fetched after noon remains visible for the rest of that local day', () => {
  const fetched = { fetchedAt: '2026-11-14T19:00:00Z' };
  assert.equal(shouldExpireSnapshot('morning', fetched, new Date('2026-11-14T19:00:30Z'), 'America/Chicago'), false);
  assert.equal(shouldExpireSnapshot('morning', fetched, new Date('2026-11-15T05:59:30Z'), 'America/Chicago'), false);
});

test('previous-day snapshots expire, including the evening snapshot after midnight', () => {
  const fetched = { fetchedAt: '2026-11-15T05:59:00Z' };
  assert.equal(shouldExpireSnapshot('evening', fetched, new Date('2026-11-15T06:00:00Z'), 'America/Chicago'), true);
});