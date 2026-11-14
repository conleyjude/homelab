function dateParts(timestamp, timeZone) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(values.map(({ type, value }) => [type, Number(value)]));
}

function localTimeToEpoch({ year, month, day, hour, minute = 0, second = 0 }, timeZone) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  let estimate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = dateParts(estimate, timeZone);
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const adjustment = represented - desired;
    if (adjustment === 0) break;
    estimate -= adjustment;
  }
  return estimate;
}

export function nextDisplayBoundary(timestamp, period, timeZone) {
  const local = dateParts(timestamp, timeZone);
  const hour = period === 'morning' ? 12 : 0;
  const currentLocal = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  let dayStart = Date.UTC(local.year, local.month - 1, local.day);
  let boundaryLocal = dayStart + hour * 60 * 60 * 1000;
  if (period === 'morning' && currentLocal >= boundaryLocal) return timestamp;
  if (currentLocal >= boundaryLocal) boundaryLocal += 24 * 60 * 60 * 1000;
  const target = new Date(boundaryLocal);
  return localTimeToEpoch({
    year: target.getUTCFullYear(),
    month: target.getUTCMonth() + 1,
    day: target.getUTCDate(),
    hour,
  }, timeZone);
}

export function providerCacheLifetimeSeconds({ cacheControl, expires, age }, now) {
  const directives = new Map((cacheControl ?? '').split(',').map((part) => {
    const [name, ...rest] = part.trim().toLowerCase().split('=');
    return [name, rest.join('=').replace(/^"|"$/g, '')];
  }));
  if (directives.has('no-store') || directives.has('no-cache') || directives.has('must-revalidate')) return 0;

  const maxAge = directives.get('max-age');
  const sharedMaxAge = directives.get('s-maxage');
  let lifetime;
  if (maxAge !== undefined && /^\d+$/.test(maxAge)) {
    lifetime = Number(maxAge);
  } else if (expires) {
    const expiresAt = Date.parse(expires);
    if (!Number.isNaN(expiresAt)) lifetime = Math.max(0, Math.floor((expiresAt - now) / 1000));
  }
  if (lifetime === undefined) return undefined;
  if (sharedMaxAge !== undefined && /^\d+$/.test(sharedMaxAge)) lifetime = Math.min(lifetime, Number(sharedMaxAge));
  const ageSeconds = Number(age);
  return Math.max(0, lifetime - (Number.isFinite(ageSeconds) ? ageSeconds : 0));
}

export class SnapshotCache {
  #snapshots = new Map();

  constructor({ timeZone = 'UTC', maxSeconds = 0, now = Date.now }) {
    this.timeZone = timeZone;
    this.maxSeconds = maxSeconds;
    this.now = now;
  }

  get(period) {
    const snapshot = this.#snapshots.get(period);
    if (!snapshot) return null;
    if (snapshot.expiresAt <= this.now()) {
      this.#snapshots.delete(period);
      return null;
    }
    return { data: snapshot.data, fetchedAt: snapshot.fetchedAt };
  }

  set(period, data, providerHeaders = []) {
    const fetchedAtMs = this.now();
    let lifetimeSeconds = this.maxSeconds;
    for (const headers of providerHeaders) {
      const providerLifetime = providerCacheLifetimeSeconds(headers, fetchedAtMs);
      lifetimeSeconds = providerLifetime === undefined ? 0 : Math.min(lifetimeSeconds, providerLifetime);
    }
    const expiresAt = Math.min(
      fetchedAtMs + lifetimeSeconds * 1000,
      nextDisplayBoundary(fetchedAtMs, period, this.timeZone),
    );
    if (expiresAt <= fetchedAtMs) {
      this.#snapshots.delete(period);
      return false;
    }
    this.#snapshots.set(period, { data, fetchedAt: new Date(fetchedAtMs).toISOString(), expiresAt });
    return true;
  }

  clear(period) {
    if (period) this.#snapshots.delete(period);
    else this.#snapshots.clear();
  }

  cleanup() {
    const now = this.now();
    for (const [period, snapshot] of this.#snapshots) {
      if (snapshot.expiresAt <= now) this.#snapshots.delete(period);
    }
  }
}