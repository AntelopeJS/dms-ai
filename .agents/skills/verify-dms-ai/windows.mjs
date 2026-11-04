const MS_DAY = 86_400_000;

/**
 * Where the Overview's and the Activity page's period starts: 24 hours is the last 24 hours, 7 and 30 days start
 * at midnight of the 6th and the 29th day before today (local time), the way the pages draw "since Thu 12:00 AM".
 *
 * @param {number} now The time
 * @param {1 | 7 | 30} days The period
 * @returns {number} Its first millisecond
 */
export function windowStart(now, days) {
  if (days === 1) return now - MS_DAY;
  const day = new Date(now);
  day.setDate(day.getDate() - (days - 1));
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/**
 * The same period `days` before: it ends where the period starts.
 *
 * @param {number} now The time
 * @param {1 | 7 | 30} days The period
 * @returns {number} Its first millisecond
 */
export function previousWindowStart(now, days) {
  const start = windowStart(now, days);
  if (days === 1) return start - MS_DAY;
  const day = new Date(start);
  day.setDate(day.getDate() - days);
  return day.getTime();
}
