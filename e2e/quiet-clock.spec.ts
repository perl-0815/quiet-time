import { expect, test, type Page } from "@playwright/test";

const NOW = Date.parse("2026-09-12T14:10:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const RECORD_KEY = "quiet-time:record:v3";
type Run = { startedAt: number; endedAt: number };

function sumRuns(runs: Run[]) {
  return runs.reduce((sum, run) => sum + run.endedAt - run.startedAt, 0);
}

async function freezeTime(page: Page, timestamp = NOW) {
  await page.clock.install({ time: timestamp });
  await page.clock.pauseAt(timestamp);
}

async function readStorage(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), RECORD_KEY);
}

async function seedRecord(page: Page, startedAt: number, longestRecord = 0, completedRuns: Run[] = [], currentRuns: Run[] = startedAt <= NOW ? [{ startedAt, endedAt: NOW }] : []) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "メニュー", exact: true })).toBeEnabled();
  await page.evaluate(
    ({ key, record }) => localStorage.setItem(key, JSON.stringify(record)),
    { key: RECORD_KEY, record: { version: 3, startedAt, longestRecord, completedRuns, currentRuns, activeSession: null } },
  );
  await page.reload();
}

async function expectDuration(page: Page, label: string) {
  await expect(page.getByRole("timer")).toHaveAttribute("aria-label", label);
}

// Portable lifecycle tests simulate focus explicitly. Playwright's headless
// Chromium reports every page as focused, so bringToFront alone is not proof.
async function installLifecycleSimulation(page: Page, initiallyFocused = true) {
  await page.addInitScript(({ recordKey, initiallyFocused }) => {
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => document.documentElement?.dataset.testFocused === undefined
        ? initiallyFocused
        : document.documentElement.dataset.testFocused !== "false",
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => document.documentElement?.dataset.testHidden === "true" ? "hidden" : "visible",
    });
    const audit = { callbacks: 0, writes: 0, live: 0 };
    Object.defineProperty(window, "__quietTimeAudit", { value: audit });
    const intervals = new Set<number>();
    const originalSetInterval = window.setInterval.bind(window);
    const originalClearInterval = window.clearInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const tracked = timeout === 1000 && typeof handler === "function";
      const callback = tracked ? () => { audit.callbacks++; handler(...args); } : handler;
      const id = originalSetInterval(callback, timeout, ...args);
      if (tracked) { intervals.add(id); audit.live = intervals.size; }
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => {
      if (id !== undefined) intervals.delete(id);
      audit.live = intervals.size;
      originalClearInterval(id);
    }) as typeof window.clearInterval;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === recordKey) audit.writes++;
      originalSetItem.call(this, key, value);
    };
  }, { recordKey: RECORD_KEY, initiallyFocused });
}

async function setSimulatedFocus(page: Page, focused: boolean) {
  await page.evaluate((next) => {
    document.documentElement.dataset.testFocused = String(next);
    window.dispatchEvent(new Event(next ? "focus" : "blur"));
  }, focused);
}

async function timerAudit(page: Page, clearCounts = false) {
  return page.evaluate((clear) => {
    const audit = (window as unknown as { __quietTimeAudit: { callbacks: number; writes: number; live: number } }).__quietTimeAudit;
    const result = { ...audit };
    if (clear) { audit.callbacks = 0; audit.writes = 0; }
    return result;
  }, clearCounts);
}

async function openReset(page: Page) {
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("menuitem", { name: "リセット", exact: true }).click();
}

async function openCalendar(page: Page) {
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("menuitem", { name: "カレンダー", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "カレンダー", exact: true })).toBeVisible();
}

async function confirmReset(page: Page) {
  await openReset(page);
  await page.getByRole("button", { name: "リセットする", exact: true }).click();
}

test("first launch persists a start and refreshes the elapsed display each second", async ({ page }) => {
  await freezeTime(page);
  await page.goto("/");
  await expect(page.getByText("デトックス時間", { exact: true })).toBeVisible();
  await expectDuration(page, "0日 00時間 00分 00秒");
  expect(await readStorage(page)).toMatchObject({ version: 3, startedAt: NOW, longestRecord: 0, completedRuns: [], currentRuns: [], activeSession: { startedAt: NOW, updatedAt: NOW } });
  await expect(page.getByTestId("started-at")).toHaveText("2026/09/12 23:10");

  await page.clock.runFor(1000);
  await expectDuration(page, "0日 00時間 00分 01秒");
  expect((await readStorage(page)).startedAt).toBe(NOW);
  expect((await readStorage(page)).activeSession.updatedAt).toBe(NOW + 1000);
});

test("closing and reopening preserves counted time and excludes the closed interval", async ({ page, context }) => {
  await freezeTime(page);
  await page.goto("/");
  await expectDuration(page, "0日 00時間 00分 00秒");
  await page.clock.runFor(5000);
  await expectDuration(page, "0日 00時間 00分 05秒");
  await page.close();

  const reopened = await context.newPage();
  await freezeTime(reopened, NOW + 3 * DAY + 12 * HOUR);
  await reopened.goto("/");
  await expectDuration(reopened, "0日 00時間 00分 05秒");
  expect((await readStorage(reopened)).startedAt).toBe(NOW);
  await reopened.clock.runFor(1000);
  await expectDuration(reopened, "0日 00時間 00分 06秒");
});

test("simulated blur stops heartbeats and excludes the gap from the timer, best and calendar", async ({ page }) => {
  await freezeTime(page);
  await installLifecycleSimulation(page);
  await page.goto("/");
  await expectDuration(page, "0日 00時間 00分 00秒");
  expect((await timerAudit(page)).live).toBe(1);
  await page.clock.runFor(3000);
  await expectDuration(page, "0日 00時間 00分 03秒");

  await setSimulatedFocus(page, false);
  const paused = await readStorage(page);
  expect(paused.activeSession).toBeNull();
  expect(sumRuns(paused.currentRuns)).toBe(3000);
  await timerAudit(page, true);
  await page.clock.runFor(60_000);
  await expectDuration(page, "0日 00時間 00分 03秒");
  expect(await readStorage(page)).toEqual(paused);
  expect(await timerAudit(page)).toEqual({ callbacks: 0, writes: 0, live: 0 });

  await setSimulatedFocus(page, true);
  await expectDuration(page, "0日 00時間 00分 03秒");
  await page.clock.runFor(2000);
  await expectDuration(page, "0日 00時間 00分 05秒");
  await confirmReset(page);
  await expectDuration(page, "0日 00時間 00分 00秒");
  expect((await readStorage(page)).longestRecord).toBe(5000);
  await openCalendar(page);
  await expect(page.getByTestId("daily-duration")).toHaveText("00時間 00分 05秒");
});

test("simulated visibility and page lifecycle pause counting without duplicate intervals", async ({ page }) => {
  await freezeTime(page);
  await installLifecycleSimulation(page);
  await page.goto("/");
  await expectDuration(page, "0日 00時間 00分 00秒");
  await page.evaluate(() => {
    for (let index = 0; index < 6; index++) {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new PageTransitionEvent("pageshow"));
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
  await timerAudit(page, true);
  await page.clock.runFor(2000);
  await expectDuration(page, "0日 00時間 00分 02秒");
  expect(await timerAudit(page)).toEqual({ callbacks: 2, writes: 2, live: 1 });

  await page.evaluate(() => {
    document.documentElement.dataset.testHidden = "true";
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await timerAudit(page, true);
  await page.clock.runFor(30_000);
  await expectDuration(page, "0日 00時間 00分 02秒");
  expect(await timerAudit(page)).toEqual({ callbacks: 0, writes: 0, live: 0 });

  await page.evaluate(() => {
    document.documentElement.dataset.testHidden = "false";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(1000);
  await expectDuration(page, "0日 00時間 00分 03秒");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await timerAudit(page, true);
  await page.clock.runFor(30_000);
  await expectDuration(page, "0日 00時間 00分 03秒");
  expect(await timerAudit(page)).toEqual({ callbacks: 0, writes: 0, live: 0 });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await page.clock.runFor(1000);
  await expectDuration(page, "0日 00時間 00分 04秒");
  expect((await timerAudit(page)).live).toBe(1);
});

test("cancel and Escape preserve the record and return keyboard focus", async ({ page }) => {
  await freezeTime(page);
  await seedRecord(page, NOW - DAY, 7 * DAY);
  await expectDuration(page, "1日 00時間 00分 00秒");
  const before = await readStorage(page);
  const trigger = page.getByRole("button", { name: "メニュー", exact: true });
  const dialog = page.getByRole("dialog", { name: "記録をリセットしますか？" });
  const cancel = page.getByRole("button", { name: "キャンセル", exact: true });
  await openReset(page);
  await expect(dialog).toBeVisible();
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "リセットする", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(cancel).toBeFocused();
  await cancel.click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await readStorage(page)).toEqual(before);

  await openReset(page);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expectDuration(page, "1日 00時間 00分 00秒");
  expect(await readStorage(page)).toEqual(before);
});

test("confirmed reset starts at zero and updates the best only for a longer record", async ({ page }) => {
  await freezeTime(page);
  const duration = 7 * DAY + 4 * HOUR;
  await seedRecord(page, NOW - duration, 2 * DAY);
  await expectDuration(page, "7日 04時間 00分 00秒");
  await confirmReset(page);
  await expectDuration(page, "0日 00時間 00分 00秒");
  await expect(page.getByTestId("longest-record")).toHaveText("7日 4時間");
  const firstCompleted = { startedAt: NOW - duration, endedAt: NOW };
  expect(await readStorage(page)).toMatchObject({ version: 3, startedAt: NOW, longestRecord: duration, currentRuns: [], activeSession: { startedAt: NOW, updatedAt: NOW }, completedRuns: expect.arrayContaining([firstCompleted]) });
  expect(sumRuns((await readStorage(page)).completedRuns)).toBe(duration);

  await page.clock.runFor(1000);
  await confirmReset(page);
  await expectDuration(page, "0日 00時間 00分 00秒");
  expect(await readStorage(page)).toMatchObject({
    version: 3,
    startedAt: NOW + 1000,
    longestRecord: duration,
    currentRuns: [],
    activeSession: { startedAt: NOW + 1000, updatedAt: NOW + 1000 },
    completedRuns: expect.arrayContaining([firstCompleted, { startedAt: NOW, endedAt: NOW + 1000 }]),
  });
  expect(sumRuns((await readStorage(page)).completedRuns)).toBe(duration + 1000);
  await page.reload();
  await expectDuration(page, "0日 00時間 00分 00秒");
  await expect(page.getByTestId("longest-record")).toHaveText("7日 4時間");
});

test("another tab reads the reset when it regains focus", async ({ page, context }) => {
  await freezeTime(page);
  await installLifecycleSimulation(page);
  await seedRecord(page, NOW - 3 * DAY, DAY);
  await expectDuration(page, "3日 00時間 00分 00秒");
  await setSimulatedFocus(page, false);
  const other = await context.newPage();
  await freezeTime(other);
  await installLifecycleSimulation(other);
  await other.goto("/");
  await expectDuration(other, "3日 00時間 00分 00秒");
  await setSimulatedFocus(other, false);
  await setSimulatedFocus(page, true);
  await confirmReset(page);
  await expectDuration(page, "0日 00時間 00分 00秒");
  await expectDuration(other, "3日 00時間 00分 00秒");
  await setSimulatedFocus(page, false);
  await setSimulatedFocus(other, true);
  await expectDuration(other, "0日 00時間 00分 00秒");
  await expect(other.getByTestId("longest-record")).toHaveText("3日 0時間");
});

test("clearing localStorage from another tab starts a new record and keeps the focused heartbeat running", async ({ page, context }) => {
  await freezeTime(page);
  await installLifecycleSimulation(page);
  await page.goto("/");
  await expectDuration(page, "0日 00時間 00分 00秒");
  await page.clock.runFor(5000);
  await expectDuration(page, "0日 00時間 00分 05秒");

  const other = await context.newPage();
  await freezeTime(other, NOW + 5000);
  await installLifecycleSimulation(other, false);
  await other.goto("/");
  await expectDuration(other, "0日 00時間 00分 05秒");
  expect((await timerAudit(other)).live).toBe(0);
  await other.evaluate(() => localStorage.clear());

  await expectDuration(page, "0日 00時間 00分 00秒");
  expect(await readStorage(page)).toMatchObject({
    version: 3,
    startedAt: NOW + 5000,
    currentRuns: [],
    activeSession: { startedAt: NOW + 5000, updatedAt: NOW + 5000 },
  });
  expect((await timerAudit(page)).live).toBe(1);
  await timerAudit(page, true);
  await page.clock.runFor(2000);
  await expectDuration(page, "0日 00時間 00分 02秒");
  expect(await timerAudit(page)).toEqual({ callbacks: 2, writes: 2, live: 1 });
  expect((await readStorage(page)).activeSession.updatedAt).toBe(NOW + 7000);
});

test("an unfocused first visit preserves an unsaved migration without counting the wait for focus", async ({ page }) => {
  await freezeTime(page);
  await installLifecycleSimulation(page, false);
  await page.addInitScript((startedAt) => {
    localStorage.setItem("startedAt", String(startedAt));
    localStorage.setItem("longestRecord", "0");
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  }, NOW - 3 * DAY);
  await page.goto("/");
  await expectDuration(page, "3日 00時間 00分 00秒");
  await expect(page.getByRole("status").filter({ hasText: "このブラウザでは記録を保存できません" })).toBeVisible();
  expect((await timerAudit(page)).live).toBe(0);
  expect(await readStorage(page)).toBeNull();
  await page.clock.runFor(HOUR);
  await expectDuration(page, "3日 00時間 00分 00秒");

  await setSimulatedFocus(page, true);
  await expectDuration(page, "3日 00時間 00分 00秒");
  await page.clock.runFor(1000);
  await expectDuration(page, "3日 00時間 00分 01秒");
  expect((await timerAudit(page)).live).toBe(1);
  expect(await readStorage(page)).toBeNull();
  await expect(page.getByRole("status").filter({ hasText: "このブラウザでは記録を保存できません" })).toBeVisible();
});

test("corrupt saved values recover and a future start does not prevent focused counting", async ({ page }) => {
  await freezeTime(page);
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, "{broken");
      localStorage.setItem("startedAt", "not-a-timestamp");
      localStorage.setItem("longestRecord", "-123");
    }
  }, RECORD_KEY);
  await page.goto("/");
  await expectDuration(page, "0日 00時間 00分 00秒");
  expect(await readStorage(page)).toMatchObject({ version: 3, startedAt: NOW, longestRecord: 0, completedRuns: [], currentRuns: [], activeSession: { startedAt: NOW, updatedAt: NOW } });

  await page.evaluate(({ key, future }) => {
    const record = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...record, startedAt: future }));
  }, { key: RECORD_KEY, future: NOW + DAY });
  await page.reload();
  await expectDuration(page, "0日 00時間 00分 00秒");
  await page.clock.runFor(1000);
  await expectDuration(page, "0日 00時間 00分 01秒");
  expect((await readStorage(page)).startedAt).toBe(NOW + DAY);
});

test("unavailable storage keeps the page usable and a failed reset never reports success", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await freezeTime(page);
  await seedRecord(page, NOW - 2 * DAY, DAY);
  await expectDuration(page, "2日 00時間 00分 00秒");
  const before = await readStorage(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage unavailable", "QuotaExceededError"); };
  });
  await confirmReset(page);
  await expectDuration(page, "2日 00時間 00分 00秒");
  await expect(page.getByRole("status").filter({ hasText: "リセットしていません" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "記録をリセットしました。" })).toHaveCount(0);
  expect(await readStorage(page)).toEqual(before);

  const readable = await context.newPage();
  readable.on("pageerror", (error) => errors.push(error.message));
  await freezeTime(readable);
  await readable.addInitScript(({ key, startedAt }) => {
    localStorage.removeItem(key);
    localStorage.setItem("startedAt", String(startedAt));
    localStorage.removeItem("longestRecord");
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  }, { key: RECORD_KEY, startedAt: NOW - 3 * DAY });
  await readable.goto("/");
  await expectDuration(readable, "3日 00時間 00分 00秒");
  await expect(readable.getByRole("status").filter({ hasText: "このブラウザでは記録を保存できません" })).toBeVisible();
  expect(await readStorage(readable)).toBeNull();
  expect(await readable.evaluate(() => localStorage.getItem("startedAt"))).toBe(String(NOW - 3 * DAY));

  const blocked = await context.newPage();
  blocked.on("pageerror", (error) => errors.push(error.message));
  await freezeTime(blocked);
  await blocked.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() { throw new DOMException("Storage denied", "SecurityError"); },
    });
  });
  await blocked.goto("/");
  await expectDuration(blocked, "0日 00時間 00分 00秒");
  await expect(blocked.getByRole("status").filter({ hasText: "このブラウザでは記録を保存できません" })).toBeVisible();
  await blocked.clock.runFor(1000);
  await expectDuration(blocked, "0日 00時間 00分 01秒");

  const unsaved = await context.newPage();
  unsaved.on("pageerror", (error) => errors.push(error.message));
  await freezeTime(unsaved);
  await unsaved.addInitScript(() => {
    localStorage.clear();
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  });
  await unsaved.goto("/");
  await expectDuration(unsaved, "0日 00時間 00分 00秒");
  await unsaved.clock.runFor(10_000);
  await expectDuration(unsaved, "0日 00時間 00分 10秒");
  await unsaved.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
  await expectDuration(unsaved, "0日 00時間 00分 10秒");
  expect(errors).toEqual([]);
});

test("the installed app shell reopens, ticks, and saves a reset while offline", async ({ page, context }) => {
  await freezeTime(page);
  await page.goto("/");
  await expectDuration(page, "0日 00時間 00分 00秒");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "ダークモード" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/", scope: "/", lang: "ja" });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: "192x192", type: "image/png" }),
    expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "maskable" }),
  ]));
  for (const icon of manifest.icons as { src: string }[]) {
    const response = await page.request.get(icon.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
    expect((await response.body()).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "QuietTime");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(ogImage).toBeTruthy();
  const ogUrl = new URL(ogImage!);
  const ogResponse = await page.request.get(ogUrl.pathname + ogUrl.search);
  expect(ogResponse.ok()).toBe(true);
  const ogBody = await ogResponse.body();
  expect(ogBody.readUInt32BE(16)).toBe(1200);
  expect(ogBody.readUInt32BE(20)).toBe(630);
  const favicon = page.locator('link[rel="icon"][type="image/svg+xml"]');
  await expect(favicon).toHaveAttribute("href", "/icons/favicon.svg");
  const faviconResponse = await page.request.get((await favicon.getAttribute("href"))!);
  expect(faviconResponse.ok()).toBe(true);
  expect(faviconResponse.headers()["content-type"]).toContain("image/svg+xml");

  await context.setOffline(true);
  await page.reload();
  await expectDuration(page, "0日 00時間 00分 00秒");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.clock.runFor(1000);
  await expectDuration(page, "0日 00時間 00分 01秒");
  await page.close();

  const reopened = await context.newPage();
  await freezeTime(reopened, NOW + 2 * HOUR);
  await reopened.goto("/");
  await expectDuration(reopened, "0日 00時間 00分 01秒");
  await confirmReset(reopened);
  await expectDuration(reopened, "0日 00時間 00分 00秒");
  expect(await readStorage(reopened)).toMatchObject({
    version: 3,
    startedAt: NOW + 2 * HOUR,
    longestRecord: 1000,
    currentRuns: [],
    activeSession: { startedAt: NOW + 2 * HOUR, updatedAt: NOW + 2 * HOUR },
  });
  expect(sumRuns((await readStorage(reopened)).completedRuns)).toBe(1000);
  await reopened.reload();
  await expectDuration(reopened, "0日 00時間 00分 00秒");
  await expect(reopened.getByTestId("longest-record")).toHaveText("0日 0時間");
  await expect(reopened.locator("html")).toHaveAttribute("data-theme", "dark");
  await openCalendar(reopened);
  await expect(reopened.getByTestId("daily-duration")).toHaveText("00時間 00分 00秒");
  await reopened.locator('[data-date="2026-09-12"]').click();
  await expect(reopened.getByTestId("daily-duration")).toHaveText("00時間 00分 01秒");
});

test("small portrait screens keep the timer, menu and footer within one screen", async ({ page }) => {
  await freezeTime(page);
  await page.goto("/");
  await expectDuration(page, "0日 00時間 00分 00秒");
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }));
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewportWidth);
    expect(dimensions.height).toBeLessThanOrEqual(dimensions.viewportHeight);
    const footer = await page.locator("footer").boundingBox();
    expect(footer).not.toBeNull();
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(viewport.height);
    const menu = await page.getByRole("button", { name: "メニュー", exact: true }).boundingBox();
    expect(menu!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByText("デトックス時間", { exact: true })).toBeInViewport();
    await expect(page.getByTestId("started-at")).toBeInViewport();
    await openCalendar(page);
    const calendar = await page.getByRole("dialog", { name: "カレンダー", exact: true }).boundingBox();
    expect(calendar!.x).toBeGreaterThanOrEqual(0);
    expect(calendar!.x + calendar!.width).toBeLessThanOrEqual(viewport.width);
    expect(calendar!.y + calendar!.height).toBeLessThanOrEqual(viewport.height);
    await page.getByRole("button", { name: "カレンダーを閉じる" }).click();
  }
});

test("legacy data migrates without losing its start, best or making up history", async ({ page }) => {
  await freezeTime(page);
  await page.addInitScript(() => {
    localStorage.setItem("startedAt", String(Date.parse("2026-09-09T14:10:00.000Z")));
    localStorage.setItem("longestRecord", String(7 * 24 * 60 * 60 * 1000));
  });
  await page.goto("/");
  await expectDuration(page, "3日 00時間 00分 00秒");
  expect(await readStorage(page)).toMatchObject({ version: 3, startedAt: NOW - 3 * DAY, longestRecord: 7 * DAY, completedRuns: [], currentRuns: [{ startedAt: NOW - 3 * DAY, endedAt: NOW }] });
  await openCalendar(page);
  await page.locator('[data-date="2026-09-08"]').click();
  await expect(page.getByTestId("daily-duration")).toHaveText("記録なし");
  await page.locator('[data-date="2026-09-09"]').click();
  await expect(page.getByTestId("daily-duration")).toHaveText("00時間 50分 00秒");
  await page.getByRole("button", { name: "カレンダーを閉じる" }).click();
  await confirmReset(page);
  await page.reload();
  await expectDuration(page, "0日 00時間 00分 00秒");
  expect((await readStorage(page)).completedRuns).toEqual(expect.arrayContaining([{ startedAt: NOW - 3 * DAY, endedAt: NOW }]));
  expect(sumRuns((await readStorage(page)).completedRuns)).toBe(3 * DAY);
});

test("the three-item menu supports keyboard navigation and persists dark mode", async ({ page }) => {
  await freezeTime(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "メニュー", exact: true });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "メニュー", exact: true });
  await expect(menu.locator('[role^="menuitem"]')).toHaveCount(3);
  await expect(page.getByRole("menuitem", { name: "カレンダー", exact: true })).toBeFocused();
  const darkMode = page.getByRole("menuitemcheckbox", { name: "ダークモード" });
  await expect(darkMode).not.toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(darkMode).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(darkMode).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("quiet-time:theme"))).toBe("dark");
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "リセット", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await trigger.click();
  await expect(darkMode).toBeChecked();
});

test("calendar totals survive resets and reopening with bounded month navigation", async ({ page }) => {
  await freezeTime(page);
  const firstStart = Date.parse("2026-08-30T18:00:00+09:00");
  const priorReset = Date.parse("2026-08-31T10:00:00+09:00");
  const currentRuns = [
    { startedAt: Date.parse("2026-08-31T12:00:00+09:00"), endedAt: Date.parse("2026-08-31T14:00:00+09:00") },
    { startedAt: Date.parse("2026-09-11T09:00:00+09:00"), endedAt: Date.parse("2026-09-11T09:30:00+09:00") },
    { startedAt: Date.parse("2026-09-12T10:00:00+09:00"), endedAt: Date.parse("2026-09-12T11:00:00+09:00") },
  ];
  await seedRecord(page, priorReset, 16 * HOUR, [{ startedAt: firstStart, endedAt: priorReset }], currentRuns);
  await openCalendar(page);
  await expect(page.getByTestId("daily-duration")).toHaveText("01時間 00分 00秒");
  await expect(page.locator('[data-date="2026-09-13"]')).toBeDisabled();
  await expect(page.getByRole("button", { name: "次の月" })).toBeDisabled();
  await page.getByRole("button", { name: "前の月" }).click();
  await expect(page.locator(".calendar-month")).toHaveText("2026年 8月");
  await expect(page.getByRole("button", { name: "前の月" })).toBeDisabled();
  await page.locator('[data-date="2026-08-29"]').click();
  await expect(page.getByTestId("daily-duration")).toHaveText("記録なし");
  await page.locator('[data-date="2026-08-30"]').click();
  await expect(page.getByTestId("daily-duration")).toHaveText("06時間 00分 00秒");
  await page.locator('[data-date="2026-08-31"]').click();
  await expect(page.getByTestId("daily-duration")).toHaveText("12時間 00分 00秒");
  await page.getByRole("button", { name: "次の月" }).click();
  await page.locator('[data-date="2026-09-11"]').click();
  await expect(page.getByTestId("daily-duration")).toHaveText("00時間 30分 00秒");
  await page.getByRole("button", { name: "今日", exact: true }).click();
  await expect(page.locator('[data-date="2026-09-12"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "メニュー", exact: true })).toBeFocused();

  await confirmReset(page);
  await expectDuration(page, "0日 00時間 00分 00秒");
  await openCalendar(page);
  await expect(page.getByTestId("daily-duration")).toHaveText("01時間 00分 00秒");
  await page.clock.runFor(1000);
  await expect(page.getByTestId("daily-duration")).toHaveText("01時間 00分 01秒");
  await page.reload();
  await openCalendar(page);
  await expect(page.getByTestId("daily-duration")).toHaveText("01時間 00分 01秒");
  expect((await readStorage(page)).completedRuns).toEqual(expect.arrayContaining([
    { startedAt: firstStart, endedAt: priorReset },
    ...currentRuns,
  ]));
  expect(sumRuns((await readStorage(page)).completedRuns)).toBe(19.5 * HOUR);
});
