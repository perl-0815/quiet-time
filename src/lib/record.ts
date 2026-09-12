export const STARTED_AT_KEY = "startedAt";
export const LONGEST_RECORD_KEY = "longestRecord";
export const V2_RECORD_KEY = "quiet-time:record:v2";
export const RECORD_KEY = "quiet-time:record:v3";

export type CompletedRun = { startedAt: number; endedAt: number };
export type ActiveSession = { id: string; startedAt: number; updatedAt: number };
export type RecordData = {
  startedAt: number;
  longestRecord: number;
  completedRuns: CompletedRun[];
  currentRuns: CompletedRun[];
  activeSession: ActiveSession | null;
};
export type RecordAction = "resume" | "checkpoint" | "pause" | "reset";
type V2Record = Pick<RecordData, "startedAt" | "longestRecord" | "completedRuns">;

function isTimestamp(value: unknown, minimum = 1): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= 8.64e15;
}

function readNumber(raw: string | null, minimum: number): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return isTimestamp(value, minimum) ? value : null;
}

function decodeRuns(value: unknown): CompletedRun[] | null {
  if (!Array.isArray(value)) return null;
  const runs: CompletedRun[] = [];
  for (const run of value) {
    if (typeof run !== "object" || run === null) return null;
    if (!isTimestamp(run.startedAt) || !isTimestamp(run.endedAt) || run.endedAt < run.startedAt) return null;
    runs.push({ startedAt: run.startedAt, endedAt: run.endedAt });
  }
  return runs;
}

function decodeRecord(raw: string | null, version: 3): RecordData | null;
function decodeRecord(raw: string | null, version: 2): V2Record | null;
function decodeRecord(raw: string | null, version: 2 | 3): RecordData | V2Record | null {
  if (raw === null) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null || !("version" in data) || data.version !== version) return null;
    if (!("startedAt" in data) || !isTimestamp(data.startedAt)) return null;
    if (!("longestRecord" in data) || !isTimestamp(data.longestRecord, 0)) return null;
    if (!("completedRuns" in data)) return null;
    const completedRuns = decodeRuns(data.completedRuns);
    if (!completedRuns) return null;
    const base = { startedAt: data.startedAt, longestRecord: data.longestRecord, completedRuns };
    if (version === 2) return base;
    if (!("currentRuns" in data)) return null;
    const currentRuns = decodeRuns(data.currentRuns);
    if (!currentRuns || !("activeSession" in data)) return null;
    let activeSession: ActiveSession | null = null;
    if (data.activeSession !== null) {
      const session = data.activeSession;
      if (typeof session !== "object" || session === null) return null;
      if (!("id" in session) || typeof session.id !== "string" || session.id.length === 0) return null;
      if (!("startedAt" in session) || !isTimestamp(session.startedAt)) return null;
      if (!("updatedAt" in session) || !isTimestamp(session.updatedAt) || session.updatedAt < session.startedAt) return null;
      activeSession = { id: session.id, startedAt: session.startedAt, updatedAt: session.updatedAt };
    }
    return { ...base, currentRuns, activeSession };
  } catch {
    return null;
  }
}

export function saveRecord(storage: Storage, record: RecordData): void {
  // Every persisted interval has a finite end. Reopening never extends it.
  storage.setItem(RECORD_KEY, JSON.stringify({ version: 3, ...record }));
}

export function createRecord(now: number): RecordData {
  return { startedAt: now, longestRecord: 0, completedRuns: [], currentRuns: [], activeSession: null };
}

export function isRecordStorageKey(key: string | null): boolean {
  return key === null || key === RECORD_KEY || key === V2_RECORD_KEY || key === STARTED_AT_KEY || key === LONGEST_RECORD_KEY;
}

export function readRecord(storage: Storage, now: number): { record: RecordData; saved: boolean; hasSavedStart: boolean } {
  const existing = decodeRecord(storage.getItem(RECORD_KEY), 3);
  if (existing) return { record: existing, saved: true, hasSavedStart: true };

  const v2 = decodeRecord(storage.getItem(V2_RECORD_KEY), 2);
  const storedStart = v2?.startedAt ?? readNumber(storage.getItem(STARTED_AT_KEY), 1);
  const storedLongest = v2?.longestRecord ?? readNumber(storage.getItem(LONGEST_RECORD_KEY), 0);
  const record: RecordData = {
    startedAt: storedStart ?? now,
    longestRecord: storedLongest ?? 0,
    completedRuns: v2?.completedRuns ?? [],
    // Preserve the old timer exactly at migration. Historical focus cannot be
    // inferred, so only future sessions adopt the foreground-only behavior.
    currentRuns: storedStart !== null && now >= storedStart ? [{ startedAt: storedStart, endedAt: now }] : [],
    activeSession: null,
  };

  try {
    saveRecord(storage, record);
    // Leave older keys untouched as a migration fallback. Valid v3 data is
    // always preferred, and older keys are never mirrored after migration.
    return { record, saved: true, hasSavedStart: true };
  } catch {
    // A failed initialization write must not discard a readable existing timer.
    return { record, saved: false, hasSavedStart: storedStart !== null };
  }
}

function sessionRun(session: ActiveSession): CompletedRun {
  return { startedAt: session.startedAt, endedAt: session.updatedAt };
}

export function countedIntervals(record: RecordData): CompletedRun[] {
  return [
    ...record.completedRuns,
    ...record.currentRuns,
    ...(record.activeSession ? [sessionRun(record.activeSession)] : []),
  ];
}

export function getElapsedMilliseconds(record: RecordData): number {
  let total = 0;
  for (const run of record.currentRuns) total += elapsedSince(run.startedAt, run.endedAt);
  if (record.activeSession) total += elapsedSince(record.activeSession.startedAt, record.activeSession.updatedAt);
  return total;
}

/** Apply a lifecycle event without reading storage or extending another page's session. */
export function transitionRecord(record: RecordData, action: RecordAction, now: number, sessionId: string): RecordData {
  if (!isTimestamp(now) || !sessionId) throw new RangeError("A valid timestamp and session ID are required.");
  const active = record.activeSession;
  if (action === "resume") {
    if (active?.id === sessionId) return record;
    return {
      ...record,
      currentRuns: active ? [...record.currentRuns, sessionRun(active)] : record.currentRuns,
      activeSession: { id: sessionId, startedAt: now, updatedAt: now },
    };
  }

  // A late blur, timer tick or reset from the old owner cannot alter the page
  // that now owns the focused session.
  if (active && active.id !== sessionId) return record;
  if (!active && action !== "reset") return record;
  const checkpoint = active ? { ...active, updatedAt: Math.max(active.updatedAt, now) } : null;
  if (action === "checkpoint") {
    if (checkpoint!.updatedAt === active!.updatedAt) return record;
    return { ...record, activeSession: checkpoint };
  }

  const currentRuns = checkpoint ? [...record.currentRuns, sessionRun(checkpoint)] : record.currentRuns;
  const paused = { ...record, currentRuns, activeSession: null };
  if (action === "pause") return paused;
  return {
    startedAt: now,
    longestRecord: Math.max(record.longestRecord, getElapsedMilliseconds(paused)),
    completedRuns: [...record.completedRuns, ...currentRuns],
    currentRuns: [],
    activeSession: { id: sessionId, startedAt: now, updatedAt: now },
  };
}

export function resetStoredRecord(storage: Storage, now: number, sessionId: string): RecordData {
  const previous = readRecord(storage, now).record;
  const next = transitionRecord(previous, "reset", now, sessionId);
  if (next === previous) return previous;
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
