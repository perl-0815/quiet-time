import assert from "node:assert/strict";
import test from "node:test";
import {
  countedIntervals,
  createRecord,
  getElapsedMilliseconds,
  readRecord,
  resetStoredRecord,
  saveRecord,
  transitionRecord,
  RECORD_KEY,
  V2_RECORD_KEY,
} from "../src/lib/record.ts";
import { getDailyDuration, getLocalDayBounds, localDateKey } from "../src/lib/calendar.ts";

// Exercise local calendar arithmetic in a timezone with DST transitions.
process.env.TZ = "America/New_York";
const HOUR = 3_600_000;
const NOW = new Date(2026, 8, 12, 12).getTime();
const localTime = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();
const day = (year, month, date) => new Date(year, month - 1, date);
const encoded = (record) => JSON.stringify({ version: 3, ...record });
const tick = (record, action, time, id = "page-a") => transitionRecord(record, action, time, id);

class MemoryStorage {
  entries;
  writes = [];
  failWrites = false;

  constructor(initial = {}) { this.entries = new Map(Object.entries(initial)); }
  getItem(key) { return this.entries.get(key) ?? null; }
  setItem(key, value) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.writes.push({ key, value });
    this.entries.set(key, String(value));
  }
}

test("first visit creates an idle record and later reads neither award time nor rewrite it", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(readRecord(storage, NOW), { record: createRecord(NOW), saved: true, hasSavedStart: true });
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0].key, RECORD_KEY);
  const reopened = readRecord(storage, NOW + HOUR).record;
  assert.deepEqual(reopened, createRecord(NOW));
  assert.equal(getElapsedMilliseconds(reopened), 0);
  assert.equal(storage.writes.length, 1);
});

test("legacy migration preserves elapsed time and best exactly once", () => {
  const legacy = { startedAt: String(NOW - 3 * HOUR), longestRecord: String(7 * HOUR) };
  const storage = new MemoryStorage(legacy);
  const expected = {
    ...createRecord(NOW - 3 * HOUR),
    longestRecord: 7 * HOUR,
    currentRuns: [{ startedAt: NOW - 3 * HOUR, endedAt: NOW }],
  };
  assert.deepEqual(readRecord(storage, NOW), { record: expected, saved: true, hasSavedStart: true });
  assert.equal(storage.getItem("startedAt"), legacy.startedAt);
  assert.equal(storage.getItem("longestRecord"), legacy.longestRecord);
  assert.equal(getElapsedMilliseconds(expected), 3 * HOUR);
  assert.equal(getDailyDuration(expected, day(2026, 9, 11), NOW), null);

  storage.entries.set("startedAt", String(NOW - 30 * HOUR));
  assert.deepEqual(readRecord(storage, NOW + HOUR).record, expected);
  assert.equal(storage.writes.length, 1);
});

test("v2 migration retains archived intervals and freezes the old active timer at migration", () => {
  const old = {
    version: 2,
    startedAt: NOW - 3 * HOUR,
    longestRecord: 8 * HOUR,
    completedRuns: [{ startedAt: NOW - 12 * HOUR, endedAt: NOW - 4 * HOUR }],
  };
  const raw = JSON.stringify(old);
  const storage = new MemoryStorage({ [V2_RECORD_KEY]: raw, startedAt: String(NOW - 20 * HOUR) });
  const migrated = readRecord(storage, NOW).record;
  assert.deepEqual(migrated.completedRuns, old.completedRuns);
  assert.deepEqual(migrated.currentRuns, [{ startedAt: old.startedAt, endedAt: NOW }]);
  assert.equal(migrated.startedAt, old.startedAt);
  assert.equal(migrated.longestRecord, old.longestRecord);
  assert.equal(migrated.activeSession, null);
  assert.equal(getElapsedMilliseconds(readRecord(storage, NOW + 24 * HOUR).record), 3 * HOUR);
  assert.equal(storage.getItem(V2_RECORD_KEY), raw);
});

test("failed migration retains readable data and identifies an unsaved first visit", () => {
  const storage = new MemoryStorage({ startedAt: String(NOW - 3 * HOUR) });
  storage.failWrites = true;
  const legacy = readRecord(storage, NOW);
  assert.equal(getElapsedMilliseconds(legacy.record), 3 * HOUR);
  assert.equal(legacy.saved, false);
  assert.equal(legacy.hasSavedStart, true);
  assert.equal(storage.getItem(RECORD_KEY), null);
  assert.equal(storage.getItem("startedAt"), String(NOW - 3 * HOUR));

  const empty = new MemoryStorage();
  empty.failWrites = true;
  assert.deepEqual(readRecord(empty, NOW), { record: createRecord(NOW), saved: false, hasSavedStart: false });
});

test("pausing for an hour adds no time and focus resumes from the next session", () => {
  const initial = createRecord(NOW);
  const active = tick(initial, "resume", NOW);
  assert.deepEqual(initial, createRecord(NOW));
  assert.equal(tick(active, "resume", NOW + 5000), active);
  const paused = tick(active, "pause", NOW + 10_000);
  assert.equal(getElapsedMilliseconds(paused), 10_000);
  assert.equal(paused.activeSession, null);
  assert.equal(tick(paused, "checkpoint", NOW + HOUR), paused);

  const resumed = tick(paused, "resume", NOW + HOUR);
  assert.equal(getElapsedMilliseconds(resumed), 10_000);
  const updated = tick(resumed, "checkpoint", NOW + HOUR + 5000);
  assert.equal(getElapsedMilliseconds(updated), 15_000);
  assert.equal(updated.startedAt, NOW);
  assert.deepEqual(updated.currentRuns, [{ startedAt: NOW, endedAt: NOW + 10_000 }]);
});

test("a reopened page counts only the last saved checkpoint and rejects stale-owner events", () => {
  let previous = tick(createRecord(NOW), "resume", NOW);
  previous = tick(previous, "checkpoint", NOW + 10_000);
  const storage = new MemoryStorage();
  saveRecord(storage, previous);
  const restored = readRecord(storage, NOW + HOUR).record;
  assert.equal(getElapsedMilliseconds(restored), 10_000);
  const newOwner = tick(restored, "resume", NOW + HOUR, "page-b");
  assert.equal(getElapsedMilliseconds(newOwner), 10_000);
  assert.deepEqual(newOwner.currentRuns, [{ startedAt: NOW, endedAt: NOW + 10_000 }]);
  for (const action of ["checkpoint", "pause", "reset"]) {
    assert.equal(tick(newOwner, action, NOW + HOUR + 20_000, "page-a"), newOwner);
  }
  assert.equal(getElapsedMilliseconds(tick(newOwner, "checkpoint", NOW + HOUR + 5000, "page-b")), 15_000);
});

test("reset archives focused segments and updates the best without adding the paused gap", () => {
  let record = tick(createRecord(NOW), "resume", NOW);
  record = tick(record, "pause", NOW + 10_000);
  record = tick(record, "resume", NOW + HOUR);
  const resetAt = NOW + HOUR + 5000;
  const storage = new MemoryStorage({ [RECORD_KEY]: encoded(record) });
  const reset = resetStoredRecord(storage, resetAt, "page-a");
  assert.equal(reset.longestRecord, 15_000);
  assert.equal(reset.startedAt, resetAt);
  assert.equal(getElapsedMilliseconds(reset), 0);
  assert.deepEqual(reset.completedRuns, [
    { startedAt: NOW, endedAt: NOW + 10_000 },
    { startedAt: NOW + HOUR, endedAt: resetAt },
  ]);
  assert.deepEqual(reset.currentRuns, []);
  assert.deepEqual(reset.activeSession, { id: "page-a", startedAt: resetAt, updatedAt: resetAt });
  assert.equal(storage.writes.length, 1);
  assert.deepEqual(JSON.parse(storage.getItem(RECORD_KEY)), { version: 3, ...reset });
  assert.equal(resetStoredRecord(storage, resetAt + 3000, "page-a").longestRecord, 15_000);
});

test("failed atomic save leaves start, best and all intervals unchanged", () => {
  const record = tick(createRecord(NOW), "resume", NOW);
  const initial = encoded(record);
  const storage = new MemoryStorage({ [RECORD_KEY]: initial });
  storage.failWrites = true;
  assert.throws(() => resetStoredRecord(storage, NOW + 10_000, "page-a"), /QuotaExceededError/);
  assert.equal(storage.getItem(RECORD_KEY), initial);
  assert.equal(storage.writes.length, 0);
});

test("invalid v3 intervals or sessions fall back to intact older data", () => {
  const invalidRecords = [
    "{broken",
    JSON.stringify({ version: 2, ...createRecord(NOW) }),
    encoded({ ...createRecord(NOW), startedAt: "123" }),
    encoded({ ...createRecord(NOW), longestRecord: -1 }),
    encoded({ ...createRecord(NOW), currentRuns: [{ startedAt: NOW, endedAt: NOW - 1 }] }),
    encoded({ ...createRecord(NOW), activeSession: { id: "a", startedAt: NOW, updatedAt: NOW - 1 } }),
    encoded({ ...createRecord(NOW), activeSession: { id: "", startedAt: NOW, updatedAt: NOW } }),
    encoded({ ...createRecord(NOW), activeSession: { id: "a", startedAt: NOW, updatedAt: 9e15 } }),
  ];
  for (const invalid of invalidRecords) {
    const storage = new MemoryStorage({ [RECORD_KEY]: invalid, startedAt: String(NOW - HOUR) });
    const result = readRecord(storage, NOW);
    assert.equal(getElapsedMilliseconds(result.record), HOUR);
    assert.equal(result.saved, true);
    assert.equal(result.hasSavedStart, true);
  }
});

test("clock rollback cannot reduce an already counted checkpoint or invert a segment", () => {
  let record = tick(createRecord(NOW), "resume", NOW);
  record = tick(record, "checkpoint", NOW + 10_000);
  assert.equal(tick(record, "checkpoint", NOW + 5000), record);
  const paused = tick(record, "pause", NOW + 5000);
  assert.equal(getElapsedMilliseconds(paused), 10_000);
  assert.deepEqual(paused.currentRuns, [{ startedAt: NOW, endedAt: NOW + 10_000 }]);
});

test("daily totals exclude a paused night and an entire unopened day", () => {
  const start = localTime(2026, 9, 11, 23, 40);
  let record = tick(createRecord(start), "resume", start);
  record = tick(record, "pause", localTime(2026, 9, 11, 23, 50));
  const resumedAt = localTime(2026, 9, 13, 8);
  record = tick(record, "resume", resumedAt);
  record = tick(record, "checkpoint", resumedAt + 5000);
  assert.equal(getDailyDuration(record, day(2026, 9, 11), resumedAt + 5000), 10 * 60_000);
  assert.equal(getDailyDuration(record, day(2026, 9, 12), resumedAt + 5000), null);
  assert.equal(getDailyDuration(record, day(2026, 9, 13), resumedAt + 5000), 5000);
  assert.equal(getDailyDuration(record, day(2026, 9, 14), resumedAt + 5000), null);
  assert.equal(record.startedAt, start);
});

test("daily totals include counted segments before and after a reset, never extending the final checkpoint", () => {
  let record = tick(createRecord(NOW), "resume", NOW);
  record = tick(record, "reset", NOW + 10_000);
  record = tick(record, "checkpoint", NOW + 15_000);
  assert.equal(getElapsedMilliseconds(record), 5000);
  assert.equal(getDailyDuration(record, day(2026, 9, 12), NOW + HOUR), 15_000);
  assert.deepEqual(countedIntervals(record), [
    { startedAt: NOW, endedAt: NOW + 10_000 },
    { startedAt: NOW + 10_000, endedAt: NOW + 15_000 },
  ]);
});

test("calendar merges overlapping finite intervals from clock corrections", () => {
  const record = {
    ...createRecord(localTime(2026, 9, 12, 8)),
    completedRuns: [{ startedAt: localTime(2026, 9, 12, 10), endedAt: localTime(2026, 9, 12, 14) }],
    currentRuns: [{ startedAt: localTime(2026, 9, 12, 8), endedAt: localTime(2026, 9, 12, 12) }],
    activeSession: { id: "a", startedAt: localTime(2026, 9, 12, 13), updatedAt: localTime(2026, 9, 12, 16) },
  };
  assert.equal(getDailyDuration(record, day(2026, 9, 12), localTime(2026, 9, 12, 18)), 8 * HOUR);
});

test("a tracked zero is distinct from untracked days at midnight", () => {
  const midnight = localTime(2026, 9, 12);
  const record = {
    ...createRecord(midnight),
    completedRuns: [{ startedAt: localTime(2026, 9, 11), endedAt: midnight }],
  };
  assert.equal(getDailyDuration(record, day(2026, 9, 10), midnight), null);
  assert.equal(getDailyDuration(record, day(2026, 9, 11), midnight), 24 * HOUR);
  assert.equal(getDailyDuration(record, day(2026, 9, 12), midnight), 0);
  assert.equal(getDailyDuration(record, day(2026, 9, 13), midnight), null);
});

test("finite counted intervals and local day bounds honor both DST transitions", () => {
  const spring = day(2026, 3, 8);
  const fall = day(2026, 11, 1);
  assert.equal(localDateKey(spring), "2026-03-08");
  assert.equal(localDateKey(localTime(2026, 11, 1)), "2026-11-01");
  for (const [date, hours] of [[spring, 23], [fall, 25]]) {
    const bounds = getLocalDayBounds(date);
    assert.equal(bounds.end - bounds.start, hours * HOUR);
    let record = tick(createRecord(bounds.start), "resume", bounds.start);
    record = tick(record, "pause", bounds.end);
    assert.equal(getElapsedMilliseconds(record), hours * HOUR);
    assert.equal(getDailyDuration(record, date, bounds.end + HOUR), hours * HOUR);
  }
});
