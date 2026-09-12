import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecord,
  readRecord,
  resetStoredRecord,
  RECORD_KEY,
} from "../src/lib/record.ts";
import { getDailyDuration, getLocalDayBounds, localDateKey } from "../src/lib/calendar.ts";

// Exercise actual local calendar arithmetic in a timezone with DST transitions.
process.env.TZ = "America/New_York";
const HOUR = 3_600_000;
const NOW = new Date(2026, 8, 12, 12).getTime();
const localTime = (year, month, day, hour = 0) => new Date(year, month - 1, day, hour).getTime();
const day = (year, month, date) => new Date(year, month - 1, date);
const encoded = (record) => JSON.stringify({ version: 2, ...record });

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

test("first visit creates one record and later reads do not rewrite it", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(readRecord(storage, NOW), { record: createRecord(NOW), saved: true, hasSavedStart: true });
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0].key, RECORD_KEY);
  assert.deepEqual(readRecord(storage, NOW + HOUR).record, createRecord(NOW));
  assert.equal(storage.writes.length, 1);
});

test("migration preserves legacy start and best without inventing past runs", () => {
  const legacy = { startedAt: String(NOW - 3 * HOUR), longestRecord: String(7 * HOUR) };
  const storage = new MemoryStorage(legacy);
  const expected = { startedAt: NOW - 3 * HOUR, longestRecord: 7 * HOUR, completedRuns: [] };
  assert.deepEqual(readRecord(storage, NOW), { record: expected, saved: true, hasSavedStart: true });
  assert.equal(storage.getItem("startedAt"), legacy.startedAt);
  assert.equal(storage.getItem("longestRecord"), legacy.longestRecord);

  // Once migrated, old keys cannot overwrite the new record.
  storage.entries.set("startedAt", String(NOW - 30 * HOUR));
  assert.deepEqual(readRecord(storage, NOW).record, expected);
  assert.equal(storage.writes.length, 1);
});

test("failed migration retains a readable legacy start", () => {
  const storage = new MemoryStorage({ startedAt: String(NOW - 3 * HOUR) });
  storage.failWrites = true;
  assert.deepEqual(readRecord(storage, NOW), {
    record: { startedAt: NOW - 3 * HOUR, longestRecord: 0, completedRuns: [] },
    saved: false,
    hasSavedStart: true,
  });
  assert.equal(storage.getItem(RECORD_KEY), null);
  assert.equal(storage.getItem("startedAt"), String(NOW - 3 * HOUR));
});

test("each reset rereads current data and commits history, start and best together", () => {
  const storage = new MemoryStorage({ [RECORD_KEY]: encoded(createRecord(NOW - 3 * HOUR)) });
  const first = resetStoredRecord(storage, NOW);
  assert.deepEqual(first, {
    startedAt: NOW,
    longestRecord: 3 * HOUR,
    completedRuns: [{ startedAt: NOW - 3 * HOUR, endedAt: NOW }],
  });
  assert.equal(storage.writes.length, 1);
  assert.deepEqual(JSON.parse(storage.getItem(RECORD_KEY)), { version: 2, ...first });

  const second = resetStoredRecord(storage, NOW + HOUR);
  assert.equal(second.longestRecord, 3 * HOUR);
  assert.equal(second.startedAt, NOW + HOUR);
  assert.deepEqual(second.completedRuns, [
    ...first.completedRuns,
    { startedAt: NOW, endedAt: NOW + HOUR },
  ]);
  assert.equal(storage.writes.length, 2);
});

test("a failed reset leaves the complete persisted record unchanged", () => {
  const initial = encoded(createRecord(NOW - 3 * HOUR));
  const storage = new MemoryStorage({ [RECORD_KEY]: initial });
  storage.failWrites = true;
  assert.throws(() => resetStoredRecord(storage, NOW), /QuotaExceededError/);
  assert.equal(storage.getItem(RECORD_KEY), initial);
  assert.equal(storage.writes.length, 0);
});

test("invalid v2 JSON or invalid interval data falls back to intact legacy values", () => {
  const invalidRecords = [
    "{broken",
    JSON.stringify({ version: 1, ...createRecord(NOW) }),
    encoded({ ...createRecord(NOW), startedAt: "123" }),
    encoded({ ...createRecord(NOW), longestRecord: -1 }),
    encoded({ ...createRecord(NOW), startedAt: 9e15 }),
    encoded({ ...createRecord(NOW), completedRuns: [{ startedAt: NOW, endedAt: NOW - 1 }] }),
  ];
  for (const invalid of invalidRecords) {
    const storage = new MemoryStorage({ [RECORD_KEY]: invalid, startedAt: String(NOW - HOUR) });
    assert.deepEqual(readRecord(storage, NOW), {
      record: { startedAt: NOW - HOUR, longestRecord: 0, completedRuns: [] },
      saved: true,
      hasSavedStart: true,
    });
  }
});

test("a reset after clock rollback never adds an inverted interval", () => {
  const initial = { ...createRecord(NOW + HOUR), longestRecord: 4 * HOUR };
  const storage = new MemoryStorage({ [RECORD_KEY]: encoded(initial) });
  assert.deepEqual(resetStoredRecord(storage, NOW), {
    startedAt: NOW,
    longestRecord: 4 * HOUR,
    completedRuns: [],
  });
});

test("daily totals include both sides of a reset and clip history to each day", () => {
  const record = {
    startedAt: localTime(2026, 9, 10, 10),
    longestRecord: 24 * HOUR,
    completedRuns: [{ startedAt: localTime(2026, 9, 9, 10), endedAt: localTime(2026, 9, 10, 10) }],
  };
  const now = localTime(2026, 9, 11, 15);
  assert.equal(getDailyDuration(record, day(2026, 9, 8), now), null);
  assert.equal(getDailyDuration(record, day(2026, 9, 9), now), 14 * HOUR);
  assert.equal(getDailyDuration(record, day(2026, 9, 10), now), 24 * HOUR);
  assert.equal(getDailyDuration(record, day(2026, 9, 11), now), 15 * HOUR);
  assert.equal(getDailyDuration(record, day(2026, 9, 12), now), null);
});

test("overlapping runs from clock corrections count each instant only once", () => {
  const record = {
    startedAt: localTime(2026, 9, 12, 13),
    longestRecord: 4 * HOUR,
    completedRuns: [
      { startedAt: localTime(2026, 9, 12, 10), endedAt: localTime(2026, 9, 12, 14) },
      { startedAt: localTime(2026, 9, 12, 8), endedAt: localTime(2026, 9, 12, 12) },
    ],
  };
  assert.equal(getDailyDuration(record, day(2026, 9, 12), localTime(2026, 9, 12, 16)), 8 * HOUR);
});

test("a tracked zero is distinct from an untracked day, including midnight boundaries", () => {
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

test("local dates and totals honor both DST transitions", () => {
  const spring = day(2026, 3, 8);
  const fall = day(2026, 11, 1);
  assert.equal(localDateKey(spring), "2026-03-08");
  assert.equal(localDateKey(localTime(2026, 11, 1)), "2026-11-01");
  const springBounds = getLocalDayBounds(spring);
  const fallBounds = getLocalDayBounds(fall);
  assert.equal(springBounds.end - springBounds.start, 23 * HOUR);
  assert.equal(fallBounds.end - fallBounds.start, 25 * HOUR);
  assert.equal(getDailyDuration(createRecord(springBounds.start), spring, springBounds.end), 23 * HOUR);
  assert.equal(getDailyDuration(createRecord(fallBounds.start), fall, fallBounds.end), 25 * HOUR);
});
