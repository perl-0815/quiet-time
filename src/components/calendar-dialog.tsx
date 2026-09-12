"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { getDailyDuration, localDateKey } from "@/lib/calendar";
import { pad, type RecordData } from "@/lib/record";

function localDate(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayDuration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${pad(Math.floor(seconds / 3600))}時間 ${pad(Math.floor(seconds % 3600 / 60))}分 ${pad(seconds % 60)}秒`;
}

export function CalendarDialog({ record, now, onClose }: { record: RecordData; now: number; onClose: () => void }) {
  const [selected, setSelected] = useState(() => localDate(now));
  const [month, setMonth] = useState(() => new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => { dialogRef.current?.showModal(); }, []);

  const today = localDate(now);
  const earliest = new Date(Math.min(record.startedAt, ...record.completedRuns.map((run) => run.startedAt)));
  const earliestMonth = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const duration = getDailyDuration(record, selected, now);
  const selectedKey = localDateKey(selected);

  function changeMonth(delta: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    setMonth(next);
    // Keep the selected day visible, clamped to the month's final day / today.
    const day = new Date(next.getFullYear(), next.getMonth(), Math.min(selected.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
    setSelected(day > today ? today : day);
  }

  function selectToday() {
    setMonth(thisMonth);
    setSelected(today);
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -selected.getDay(), End: 6 - selected.getDay() };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const next = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() + offsets[event.key]);
    if (next > today || next < earliestMonth) return;
    setSelected(next);
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${localDateKey(next)}"]`)?.focus());
  }

  return (
    <dialog ref={dialogRef} className="calendar-dialog" aria-labelledby="calendar-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className="calendar-content">
        <header className="calendar-header">
          <h2 id="calendar-title"><MaterialIcon name="calendar_month" size={21} />カレンダー</h2>
          <button className="icon-button" aria-label="カレンダーを閉じる" onClick={() => dialogRef.current?.close()}><MaterialIcon name="close" /></button>
        </header>
        <div className="calendar-navigation">
          <button className="icon-button" aria-label="前の月" disabled={month <= earliestMonth} onClick={() => changeMonth(-1)}><MaterialIcon name="chevron_left" /></button>
          <p className="calendar-month" aria-live="polite">{month.getFullYear()}年 {month.getMonth() + 1}月</p>
          <button className="icon-button" aria-label="次の月" disabled={month >= thisMonth} onClick={() => changeMonth(1)}><MaterialIcon name="chevron_right" /></button>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">{["日", "月", "火", "水", "木", "金", "土"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid" ref={gridRef} onKeyDown={onGridKeyDown} role="group" aria-label="日付">
          {Array.from({ length: month.getDay() }, (_, index) => <span key={`empty-${index}`} />)}
          {Array.from({ length: dayCount }, (_, index) => {
            const date = new Date(month.getFullYear(), month.getMonth(), index + 1);
            const key = localDateKey(date);
            const total = getDailyDuration(record, date, now);
            return (
              <button key={key} className="calendar-day" data-date={key} data-recorded={total !== null} aria-pressed={key === selectedKey} aria-current={key === localDateKey(today) ? "date" : undefined} aria-label={`${date.getMonth() + 1}月${index + 1}日、${total === null ? "記録なし" : dayDuration(total)}`} disabled={date > today} tabIndex={key === selectedKey ? 0 : -1} onClick={() => setSelected(date)}>
                <span>{index + 1}</span><small aria-hidden="true">{total === null ? "·" : `${Math.floor(total / 3600000)}h`}</small>
              </button>
            );
          })}
        </div>
        <section className="calendar-detail" aria-live="off" aria-label="選択日の時間">
          <div className="calendar-detail-heading"><p>{selected.getMonth() + 1}月{selected.getDate()}日<span>（{["日", "月", "火", "水", "木", "金", "土"][selected.getDay()]}）</span></p><button className="today-button" onClick={selectToday}><MaterialIcon name="today" size={17} />今日</button></div>
          <p className="calendar-duration" data-testid="daily-duration">{duration === null ? "記録なし" : dayDuration(duration)}</p>
          <p className="calendar-caption">この日の合計</p>
        </section>
      </div>
    </dialog>
  );
}
