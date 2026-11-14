import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTimeInZone, hourInTimeZone, isSameLocalDay } from './dashboard-time.mjs';

test('configured Central time is used when browser host time is UTC', () => {
  const piTime = new Date('2026-11-14T16:50:00Z');
  assert.equal(hourInTimeZone(piTime, 'America/Chicago'), 10);
  assert.equal(formatTimeInZone(piTime, 'America/Chicago', { hour: 'numeric', minute: '2-digit' }), '10:50 AM');
});

test('local-day comparison follows the configured timezone across UTC midnight', () => {
  assert.equal(isSameLocalDay('2026-11-15T05:30:00Z', '2026-11-15T05:50:00Z', 'America/Chicago'), true);
  assert.equal(isSameLocalDay('2026-11-15T05:50:00Z', '2026-11-15T06:10:00Z', 'America/Chicago'), false);
});