import { expect, test, type Page } from "@playwright/test";

const NOW = Date.parse("2026-09-12T14:10:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const RECORD_KEY = "quiet-time:record:v2";

async function freezeTime(page: Page, timestamp = NOW) {
  await page.clock.install({ time: timestamp });
  await page.clock.pauseAt(timestamp);
}

async function readStorage(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), RECORD_KEY);
}

async function seedRecord(page: Page, startedAt: number, longestRecord = 0, completedRuns: { startedAt: number; endedAt: number }[] = []) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "メニュー", exact: true })).toBeEnabled();
  await page.evaluate(
    ({ key, record }) => localStorage.setItem(key, JSON.stringify(record)),
    { key: RECORD_KEY, record: { version: 2, startedAt, longestRecord, completedRuns } },
  );
  await page.reload();
}

async function expectDuration(page: Page, label: string) {
  await expect(page.getByRole("timer")).toHaveAttribute("aria-label", label);
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
  await expect(page.getByRole("heading", { name: "広告ゲームを遊ばずに" })).toBeVisible();
  await expectDuration(page, "0日 00時間 00分 00秒");
  expect(await readStorage(page)).toEqual({ version: 2, startedAt: NOW, longestRecord: 0, completedRuns: [] });
  await expect(page.getByTestId("started-at")).toHaveText("2026/09/12 23:10");

  await page.clock.runFor(1000);
  await expectDuration(page, "0日 00時間 00分 01秒");
  expect((await readStorage(page)).startedAt).toBe(NOW);
});

test("closing and reopening counts all elapsed time without a running page", async ({ page, context }) => {
  await freezeTime(page);
  await page.goto("/");
  await expectDuration(page, "0日 00時間 00分 00秒");
  await page.close();

  const reopened = await context.newPage();
  const duration = 3 * DAY + 12 * HOUR + 41 * 60 * 1000 + 8000;
  await freezeTime(reopened, NOW + duration);
  await reopened.goto("/");
  await expectDuration(reopened, "3日 12時間 41分 08秒");
  await expect(reopened.getByTestId("days")).toHaveText("3");
  await expect(reopened.getByTestId("hours")).toHaveText("12");
  await expect(reopened.getByTestId("minutes")).toHaveText("41");
  await expect(reopened.getByTestId("seconds")).toHaveText("08");
  expect((await readStorage(reopened)).startedAt).toBe(NOW);
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
  expect(await readStorage(page)).toEqual({ version: 2, startedAt: NOW, longestRecord: duration, completedRuns: [firstCompleted] });

  await page.clock.runFor(1000);
  await confirmReset(page);
  await expectDuration(page, "0日 00時間 00分 00秒");
  expect(await readStorage(page)).toEqual({
    version: 2,
    startedAt: NOW + 1000,
    longestRecord: duration,
    completedRuns: [firstCompleted, { startedAt: NOW, endedAt: NOW + 1000 }],
  });
  await page.reload();
  await expectDuration(page, "0日 00時間 00分 00秒");
  await expect(page.getByTestId("longest-record")).toHaveText("7日 4時間");
});

test("a reset synchronizes another tab through localStorage", async ({ page, context }) => {
  await freezeTime(page);
  await seedRecord(page, NOW - 3 * DAY, DAY);
  await expectDuration(page, "3日 00時間 00分 00秒");
  const other = await context.newPage();
  await freezeTime(other);
  await other.goto("/");
  await expectDuration(other, "3日 00時間 00分 00秒");
  await confirmReset(page);
  await expectDuration(page, "0日 00時間 00分 00秒");
  await expectDuration(other, "0日 00時間 00分 00秒");
  await expect(other.getByTestId("longest-record")).toHaveText("3日 0時間");
});

test("corrupt saved values recover and a future start never shows negative time", async ({ page }) => {
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
  expect(await readStorage(page)).toEqual({ version: 2, startedAt: NOW, longestRecord: 0, completedRuns: [] });

  await page.evaluate(({ key, future }) => {
    const record = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...record, startedAt: future }));
  }, { key: RECORD_KEY, future: NOW + DAY });
  await page.reload();
  await expectDuration(page, "0日 00時間 00分 00秒");
  await page.clock.runFor(1000);
  await expectDuration(page, "0日 00時間 00分 00秒");
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
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "余白 — 広告ゲームを遊ばずに");
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
  await expectDuration(reopened, "0日 02時間 00分 00秒");
  await confirmReset(reopened);
  await expectDuration(reopened, "0日 00時間 00分 00秒");
  expect(await readStorage(reopened)).toEqual({
    version: 2,
    startedAt: NOW + 2 * HOUR,
    longestRecord: 2 * HOUR,
    completedRuns: [{ startedAt: NOW, endedAt: NOW + 2 * HOUR }],
  });
  await reopened.reload();
  await expectDuration(reopened, "0日 00時間 00分 00秒");
  await expect(reopened.getByTestId("longest-record")).toHaveText("0日 2時間");
  await expect(reopened.locator("html")).toHaveAttribute("data-theme", "dark");
  await openCalendar(reopened);
  await expect(reopened.getByTestId("daily-duration")).toHaveText("01時間 10分 00秒");
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
    await expect(page.getByRole("heading", { name: "広告ゲームを遊ばずに" })).toBeInViewport();
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
  expect(await readStorage(page)).toEqual({ version: 2, startedAt: NOW - 3 * DAY, longestRecord: 7 * DAY, completedRuns: [] });
  await openCalendar(page);
  await page.locator('[data-date="2026-09-08"]').click();
  await expect(page.getByTestId("daily-duration")).toHaveText("記録なし");
  await page.locator('[data-date="2026-09-09"]').click();
  await expect(page.getByTestId("daily-duration")).toHaveText("00時間 50分 00秒");
  await page.getByRole("button", { name: "カレンダーを閉じる" }).click();
  await confirmReset(page);
  await page.reload();
  await expectDuration(page, "0日 00時間 00分 00秒");
  expect((await readStorage(page)).completedRuns).toEqual([{ startedAt: NOW - 3 * DAY, endedAt: NOW }]);
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
  await seedRecord(page, priorReset, 16 * HOUR, [{ startedAt: firstStart, endedAt: priorReset }]);
  await openCalendar(page);
  await expect(page.getByTestId("daily-duration")).toHaveText("23時間 10分 00秒");
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
  await expect(page.getByTestId("daily-duration")).toHaveText("24時間 00分 00秒");
  await page.getByRole("button", { name: "次の月" }).click();
  await page.locator('[data-date="2026-09-11"]').click();
  await expect(page.getByTestId("daily-duration")).toHaveText("24時間 00分 00秒");
  await page.getByRole("button", { name: "今日", exact: true }).click();
  await expect(page.locator('[data-date="2026-09-12"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "メニュー", exact: true })).toBeFocused();

  await confirmReset(page);
  await expectDuration(page, "0日 00時間 00分 00秒");
  await openCalendar(page);
  await expect(page.getByTestId("daily-duration")).toHaveText("23時間 10分 00秒");
  await page.clock.runFor(1000);
  await expect(page.getByTestId("daily-duration")).toHaveText("23時間 10分 01秒");
  await page.reload();
  await openCalendar(page);
  await expect(page.getByTestId("daily-duration")).toHaveText("23時間 10分 01秒");
  expect((await readStorage(page)).completedRuns).toEqual([
    { startedAt: firstStart, endedAt: priorReset },
    { startedAt: priorReset, endedAt: NOW },
  ]);
});
