function zonedParts(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(timestamp instanceof Date ? timestamp : new Date(timestamp));
  return Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
}

export function hourInTimeZone(timestamp, timeZone) {
  return zonedParts(timestamp, timeZone).hour;
}

export function formatTimeInZone(timestamp, timeZone, options = {}) {
  return new Intl.DateTimeFormat([], { ...options, timeZone }).format(new Date(timestamp));
}

export function isSameLocalDay(firstTimestamp, secondTimestamp, timeZone) {
  const first = zonedParts(firstTimestamp, timeZone);
  const second = zonedParts(secondTimestamp, timeZone);
  return first.year === second.year && first.month === second.month && first.day === second.day;
}