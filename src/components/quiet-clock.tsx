"use client";

import { useEffect, useRef, useState } from "react";
import { AppMenu } from "@/components/app-menu";
import { CalendarDialog } from "@/components/calendar-dialog";
import {
  createRecord,
  elapsedSince,
  formatStartedAt,
  LONGEST_RECORD_KEY,
  pad,
  readRecord,
  RECORD_KEY,
  resetStoredRecord,
  type RecordData,
  splitDuration,
  STARTED_AT_KEY,
} from "@/lib/record";

export function QuietClock() {
  const [record, setRecord] = useState<RecordData | null>(null);
  const [now, setNow] = useState(0);
  const [storageMessage, setStorageMessage] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const currentRecord = useRef<RecordData | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function synchronize() {
      const time = Date.now();
      let next = currentRecord.current ?? createRecord(time);
      try {
        const result = readRecord(window.localStorage, time);
        // If an unsaved first visit resumes, preserve its in-memory start.
        // A real stored timestamp still takes precedence, including legacy data.
        if (result.saved || result.hasSavedStart || !currentRecord.current) next = result.record;
        setStorageMessage(result.saved ? "" : "このブラウザでは記録を保存できません。今の記録は、この画面を閉じると失われる場合があります。");
      } catch {
        setStorageMessage("このブラウザでは記録を保存できません。今の記録は、この画面を閉じると失われる場合があります。");
      }
      currentRecord.current = next;
      setRecord(next);
      setNow(time);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") synchronize();
    }

    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === RECORD_KEY || event.key === STARTED_AT_KEY || event.key === LONGEST_RECORD_KEY) {
        synchronize();
      }
    }

    synchronize();
    // The interval only refreshes the display; the saved timestamp is the clock.
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", synchronize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", synchronize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  function openResetDialog() {
    setAnnouncement("");
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
  }

  function resetRecord() {
    if (!currentRecord.current) return;
    const time = Date.now();
    try {
      // Read again in case another tab reset while this dialog was open.
      const next = resetStoredRecord(window.localStorage, time);
      currentRecord.current = next;
      setRecord(next);
      setNow(time);
      setStorageMessage("");
      setAnnouncement("記録をリセットしました。");
    } catch {
      // Keep the current timer if saving fails: never imply a reset was saved.
      setStorageMessage("記録を保存できなかったため、リセットしていません。ブラウザのストレージ設定をご確認ください。");
    }
    dialogRef.current?.close();
  }

  const elapsed = splitDuration(record ? elapsedSince(record.startedAt, now) : 0);
  const longest = splitDuration(record?.longestRecord ?? 0);
  const durationLabel = record
    ? `${elapsed.days}日 ${pad(elapsed.hours)}時間 ${pad(elapsed.minutes)}分 ${pad(elapsed.seconds)}秒`
    : "記録を読み込んでいます";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-spacer" />
        <div className="brand" aria-label="余白">
        <svg className="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span>余白</span>
        </div>
        <AppMenu ready={Boolean(record)} onCalendar={() => setCalendarOpen(true)} onReset={openResetDialog} />
      </header>

      <main className="clock-main">
        <section className="clock" aria-labelledby="clock-title">
          <h1 id="clock-title">広告ゲームを遊ばずに</h1>
          <div className="elapsed" role="timer" aria-live="off" aria-label={durationLabel}>
            <div className="day-line" aria-hidden="true">
              <span className="day-number" data-digits={String(elapsed.days).length} data-testid="days">{record ? elapsed.days : "—"}</span>
              <span className="day-unit">日</span>
            </div>
            <div className="time-line" aria-hidden="true">
              <span className="time-part"><span className="time-number" data-testid="hours">{record ? pad(elapsed.hours) : "--"}</span><span className="time-unit">時間</span></span>
              <span className="time-part"><span className="time-number" data-testid="minutes">{record ? pad(elapsed.minutes) : "--"}</span><span className="time-unit">分</span></span>
              <span className="time-part"><span className="time-number" data-testid="seconds">{record ? pad(elapsed.seconds) : "--"}</span><span className="time-unit">秒</span></span>
            </div>
          </div>
          <p className="clock-caption">過ごした時間</p>
        </section>
      </main>

      <footer className="record-footer">
        <dl className="record-details">
          <div>
            <dt>開始日時</dt>
            <dd><time dateTime={record ? new Date(record.startedAt).toISOString() : undefined} data-testid="started-at">{record ? formatStartedAt(record.startedAt) : "----/--/-- --:--"}</time></dd>
          </div>
          <div>
            <dt>最長記録</dt>
            <dd data-testid="longest-record">{record ? `${longest.days}日 ${longest.hours}時間` : "—日 —時間"}</dd>
          </div>
        </dl>
        {storageMessage ? <p className="storage-message" role="status">{storageMessage}</p> : null}
      </footer>

      <p className="sr-only" role="status">{announcement}</p>

      {calendarOpen && record ? <CalendarDialog record={record} now={now} onClose={() => setCalendarOpen(false)} /> : null}

      <dialog ref={dialogRef} className="reset-dialog" aria-labelledby="reset-title" aria-describedby="reset-description" onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <div className="dialog-content">
          <h2 id="reset-title">記録をリセットしますか？</h2>
          <p id="reset-description">今から、新しく時間を計り始めます。<br />最長記録はそのまま残ります。</p>
          <div className="dialog-actions">
            <button ref={cancelRef} className="dialog-cancel" onClick={() => dialogRef.current?.close()}>キャンセル</button>
            <button className="dialog-confirm" onClick={resetRecord}>リセットする</button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
