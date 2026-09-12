"use client";

import { useRef, useState } from "react";
import { AppMenu } from "@/components/app-menu";
import { CalendarDialog } from "@/components/calendar-dialog";
import { formatStartedAt, getElapsedMilliseconds, pad, splitDuration } from "@/lib/record";
import { useFocusedRecord } from "@/hooks/use-focused-record";

export function QuietClock() {
  const { record, now, storageMessage, resetRecord: resetFocusedRecord } = useFocusedRecord();
  const [announcement, setAnnouncement] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  function openResetDialog() {
    setAnnouncement("");
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
  }

  function resetRecord() {
    if (resetFocusedRecord()) {
      setAnnouncement("記録をリセットしました。");
    }
    dialogRef.current?.close();
  }

  const elapsed = splitDuration(record ? getElapsedMilliseconds(record) : 0);
  const longest = splitDuration(record?.longestRecord ?? 0);
  const durationLabel = record
    ? `${elapsed.days}日 ${pad(elapsed.hours)}時間 ${pad(elapsed.minutes)}分 ${pad(elapsed.seconds)}秒`
    : "記録を読み込んでいます";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-spacer brand" />
        <AppMenu ready={Boolean(record)} onCalendar={() => setCalendarOpen(true)} onReset={openResetDialog} />
      </header>

      <main className="clock-main">
        <section className="clock" aria-labelledby="clock-title">
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
          <p id="clock-title" className="clock-caption">デトックス時間</p>
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
