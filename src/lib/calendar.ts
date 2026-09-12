import type { RecordData } from "./record";

export function localDateKey(value: Date | number): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getLocalDayBounds(value: Date | number): { start: number; end: number } {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  // Calendar arithmetic respects 23-hour and 25-hour days at DST changes.
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

/** Tracked time within the local day, or null when that day has no known record. */
export function getDailyDuration(record: RecordData, dayDate: Date, now: number): number | null {
  const day = getLocalDayBounds(dayDate);
  if (!Number.isFinite(day.start) || !Number.isFinite(now) || day.start > now) return null;
  const limit = Math.min(day.end, now);
  const intervals: { start: number; end: number }[] = [];
  // A newly created/reset record can be a known zero on its start date.
  let tracked = record.startedAt >= day.start && record.startedAt < day.end && record.startedAt <= now;
  const runs = [...record.completedRuns, ...record.currentRuns];
  if (record.activeSession) {
    runs.push({ startedAt: record.activeSession.startedAt, endedAt: record.activeSession.updatedAt });
  }

  for (const run of runs) {
    const start = Math.max(day.start, run.startedAt);
    const end = Math.min(limit, run.endedAt);
    if (start < end) {
      intervals.push({ start, end });
      tracked = true;
    } else if (run.startedAt === run.endedAt && run.startedAt >= day.start && run.startedAt < day.end && run.startedAt <= now) {
      tracked = true;
    }
  }

  if (!tracked) return null;

  // Clock corrections can make recorded runs overlap. Count each instant once.
  intervals.sort((left, right) => left.start - right.start);
  let total = 0;
  let coveredUntil = day.start;
  for (const interval of intervals) {
    total += Math.max(0, interval.end - Math.max(interval.start, coveredUntil));
    coveredUntil = Math.max(coveredUntil, interval.end);
  }
  return total;
}
