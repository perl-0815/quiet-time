"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { applyTheme, THEME_KEY, type Theme } from "@/lib/theme";

export function AppMenu({ ready, onCalendar, onReset }: { ready: boolean; onCalendar: () => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    function synchronizeTheme() {
      let next: Theme = system.matches ? "dark" : "light";
      try {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === "light" || saved === "dark") next = saved;
      } catch { /* The appearance can still be changed for this visit. */ }
      applyTheme(next);
      setTheme(next);
    }
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === THEME_KEY) synchronizeTheme();
    }
    synchronizeTheme();
    system.addEventListener("change", synchronizeTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      system.removeEventListener("change", synchronizeTheme);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function choose(action: () => void) {
    close();
    action();
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch { /* Session-only fallback. */ }
    applyTheme(next);
    setTheme(next);
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      close();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]") ?? []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }

  return (
    <div className="menu-container" ref={containerRef}>
      <button ref={buttonRef} className="icon-button menu-trigger" aria-label="メニュー" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? "app-menu" : undefined} disabled={!ready} onClick={() => open ? close() : setOpen(true)}>
        <MaterialIcon name="more_vert" />
      </button>
      {open ? (
        <div ref={menuRef} id="app-menu" className="app-menu" role="menu" aria-label="メニュー" onKeyDown={onMenuKeyDown}>
          <button role="menuitem" onClick={() => choose(onCalendar)}><MaterialIcon name="calendar_month" /><span>カレンダー</span></button>
          <button role="menuitemcheckbox" aria-checked={theme === "dark"} onClick={toggleTheme}><MaterialIcon name={theme === "dark" ? "light_mode" : "dark_mode"} /><span>ダークモード</span><span className="theme-switch" aria-hidden="true" data-on={theme === "dark"} /></button>
          <div className="menu-divider" role="separator" />
          <button role="menuitem" onClick={() => choose(onReset)}><MaterialIcon name="restart_alt" /><span>リセット</span></button>
        </div>
      ) : null}
    </div>
  );
}
