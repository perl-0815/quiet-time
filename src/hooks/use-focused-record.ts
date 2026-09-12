"use client";

import { useEffect, useRef, useState } from "react";
import {
  createRecord,
  isRecordStorageKey,
  readRecord,
  RECORD_KEY,
  saveRecord,
  transitionRecord,
  type RecordData,
} from "@/lib/record";

const STORAGE_WARNING = "このブラウザでは記録を保存できません。今の記録は、この画面を閉じると失われる場合があります。";

export function useFocusedRecord() {
  const [record, setRecord] = useState<RecordData | null>(null);
  const [now, setNow] = useState(0);
  const [storageMessage, setStorageMessage] = useState("");
  const current = useRef<RecordData | null>(null);
  const session = useRef<string | null>(null);
  const reset = useRef<(() => boolean) | null>(null);

  useEffect(() => {
    const sessionId = session.current ?? crypto.randomUUID();
    session.current = sessionId;
    let interval: number | null = null;
    let pageHidden = false;
    let dirty = false;
    let lastObservedRaw: string | null | undefined;

    function canCount() {
      return !pageHidden && document.visibilityState === "visible" && document.hasFocus();
    }

    function latest(storage: Storage, time: number) {
      const raw = storage.getItem(RECORD_KEY);
      // Retain unsaved progress when storage starts working again. A different
      // stored record (e.g. another tab's reset) still takes precedence.
      if (dirty && current.current && (raw === lastObservedRaw || (raw === null && lastObservedRaw === undefined))) {
        return current.current;
      }
      const result = readRecord(storage, time);
      lastObservedRaw = storage.getItem(RECORD_KEY);
      dirty = !result.saved;
      if (dirty) setStorageMessage(STORAGE_WARNING);
      if (!result.saved && !result.hasSavedStart && current.current) return current.current;
      return result.record;
    }

    function show(next: RecordData, time: number) {
      current.current = next;
      setRecord(next);
      setNow(time);
    }

    function update(action: "resume" | "checkpoint" | "pause" | "reset") {
      const time = Date.now();
      let storage: Storage | undefined;
      let base = current.current ?? createRecord(time);
      try {
        storage = window.localStorage;
        base = latest(storage, time);
      } catch { /* Continue the current visit in memory if storage is denied. */ }

      // A clicked reset first takes ownership, so an old tab cannot append a
      // stale interval after another tab has reset the shared record.
      const owned = action === "reset" ? transitionRecord(base, "resume", time, sessionId) : base;
      const next = transitionRecord(owned, action, time, sessionId);
      try {
        if (!storage) throw new Error("Storage unavailable");
        saveRecord(storage, next);
        lastObservedRaw = storage.getItem(RECORD_KEY);
        dirty = false;
        setStorageMessage("");
      } catch {
        if (action === "reset") {
          setStorageMessage("記録を保存できなかったため、リセットしていません。ブラウザのストレージ設定をご確認ください。");
          return false;
        }
        dirty = true;
        setStorageMessage(STORAGE_WARNING);
      }
      show(next, time);
      return true;
    }

    function clearTimer() {
      if (interval === null) return;
      window.clearInterval(interval);
      interval = null;
    }

    function stop() {
      if (interval === null) return;
      clearTimer();
      // Flush the fraction of a second since the last visible checkpoint.
      update("pause");
    }

    function start() {
      if (!canCount()) { stop(); return; }
      if (interval !== null) return;
      update("resume");
      interval = window.setInterval(() => {
        if (!canCount()) { stop(); return; }
        if (current.current?.activeSession?.id !== sessionId) { clearTimer(); return; }
        update("checkpoint");
      }, 1000);
    }

    function synchronize() {
      const time = Date.now();
      let next = current.current ?? createRecord(time);
      try {
        next = latest(window.localStorage, time);
      } catch {
        setStorageMessage(STORAGE_WARNING);
      }
      show(next, time);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") start();
      else stop();
    }

    function onPageHide() { pageHidden = true; stop(); }
    function onPageShow() { pageHidden = false; start(); }
    function onStorage(event: StorageEvent) {
      if (!isRecordStorageKey(event.key) || !canCount()) return;
      synchronize();
      if (current.current?.activeSession?.id !== sessionId) {
        clearTimer();
        if (!current.current?.activeSession) start();
      }
    }

    reset.current = () => {
      if (!canCount()) return false;
      const saved = update("reset");
      // A reset can take over an existing record whose previous owner had focus.
      if (saved && interval === null) start();
      return saved;
    };
    synchronize();
    start();
    window.addEventListener("focus", start);
    window.addEventListener("blur", stop);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      reset.current = null;
      window.removeEventListener("focus", start);
      window.removeEventListener("blur", stop);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return { record, now, storageMessage, resetRecord: () => reset.current?.() ?? false };
}
