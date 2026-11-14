import { hourInTimeZone, isSameLocalDay } from './dashboard-time.mjs';

export function shouldExpireSnapshot(period, snapshot, now = new Date(), timeZone = 'UTC') {
  if (!snapshot?.fetchedAt) return false;
  const fetchedAt = new Date(snapshot.fetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) return true;

  if (!isSameLocalDay(fetchedAt, now, timeZone)) return true;

  return period === 'morning'
    && hourInTimeZone(now, timeZone) >= 12
    && hourInTimeZone(fetchedAt, timeZone) < 12;
}