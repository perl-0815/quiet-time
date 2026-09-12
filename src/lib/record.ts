export const STARTED_AT_KEY = "startedAt";
export const LONGEST_RECORD_KEY = "longestRecord";
export const RECORD_KEY = "quiet-time:record:v2";

export type CompletedRun = { startedAt: number; endedAt: number };
export type RecordData = {
  startedAt: number;
  longestRecord: number;
  completedRuns: CompletedRun[];
};

function isTimestamp(value: unknown, minimum = 1): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= 8.64e15;
}

function readNumber(raw: string | null, minimum: number): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return isTimestamp(value, minimum) ? value : null;
}

function decodeRecord(raw: string | null): RecordData | null {
  if (raw === null) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null || !("version" in data) || data.version !== 2) return null;
    if (!("startedAt" in data) || !isTimestamp(data.startedAt)) return null;
    if (!("longestRecord" in data) || !isTimestamp(data.longestRecord, 0)) return null;
    if (!("completedRuns" in data) || !Array.isArray(data.completedRuns)) return null;

    const completedRuns: CompletedRun[] = [];
    for (const run of data.completedRuns) {
      if (typeof run !== "object" || run === null) return null;
      if (!isTimestamp(run.startedAt) || !isTimestamp(run.endedAt) || run.endedAt < run.startedAt) return null;
      completedRuns.push({ startedAt: run.startedAt, endedAt: run.endedAt });
    }
    return { startedAt: data.startedAt, longestRecord: data.longestRecord, completedRuns };
  } catch {
    return null;
  }
}

function saveRecord(storage: Storage, record: RecordData): void {
  // One key keeps the start, best and completed runs in the same atomic write.
  storage.setItem(RECORD_KEY, JSON.stringify({ version: 2, ...record }));
}

export function createRecord(now: number): RecordData {
  return { startedAt: now, longestRecord: 0, completedRuns: [] };
}

export function isRecordStorageKey(key: string | null): boolean {
  return key === null || key === RECORD_KEY || key === STARTED_AT_KEY || key === LONGEST_RECORD_KEY;
}

export function readRecord(storage: Storage, now: number): { record: RecordData; saved: boolean; hasSavedStart: boolean } {
  const existing = decodeRecord(storage.getItem(RECORD_KEY));
  if (existing) return { record: existing, saved: true, hasSavedStart: true };

  const storedStart = readNumber(storage.getItem(STARTED_AT_KEY), 1);
  const storedLongest = readNumber(storage.getItem(LONGEST_RECORD_KEY), 0);
  const record: RecordData = {
    startedAt: storedStart ?? now,
    longestRecord: storedLongest ?? 0,
    // The old format has no earlier timestamps; do not invent past history.
    completedRuns: [],
  };

  try {
    saveRecord(storage, record);
    // Leave legacy keys untouched as a migration fallback. Once committed,
    // valid v2 data is always preferred and legacy keys are never mirrored.
    return { record, saved: true, hasSavedStart: true };
  } catch {
    // A failed initialization write must not discard a readable existing timer.
    return { record, saved: false, hasSavedStart: storedStart !== null };
  }
}

export function resetStoredRecord(storage: Storage, now: number): RecordData {
  const previous = readRecord(storage, now).record;
  const completedRuns = [...previous.completedRuns];
  // A corrected device clock may precede the saved start. Such an interval
  // has no recorded duration and must not introduce an inverted history run.
  if (now >= previous.startedAt) {
    completedRuns.push({ startedAt: previous.startedAt, endedAt: now });
  }
  const next: RecordData = {
    startedAt: now,
    longestRecord: Math.max(previous.longestRecord, elapsedSince(previous.startedAt, now)),
    completedRuns,
  };
  saveRecord(storage, next);
  return next;
}

export function elapsedSince(startedAt: number, now: number): number {
  return Math.max(0, now - startedAt);
}

export function splitDuration(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatStartedAt(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
