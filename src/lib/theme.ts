export type Theme = "light" | "dark";
export const THEME_KEY = "quiet-time:theme";

// Runs before the first paint, including when the app is opened offline.
export const THEME_SCRIPT = `(function(){var t;try{t=localStorage.getItem("${THEME_KEY}")}catch{}if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==="dark"?"#1c201c":"#f8f7f4"})()`;

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#1c201c" : "#f8f7f4");
}
