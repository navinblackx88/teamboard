import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "dark" | "light" | "system";
type ThemeState = { theme: Theme; resolved: "dark" | "light"; setTheme: (t: Theme) => void };

const ThemeContext = createContext<ThemeState>({ theme: "system", resolved: "light", setTheme: () => undefined });

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** shadcn's Vite theme provider: toggles the `dark` class on <html>, persisted in localStorage. */
export function ThemeProvider({ children, defaultTheme = "system", storageKey = "ui-theme" }: { children: ReactNode; defaultTheme?: Theme; storageKey?: string }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try { return (localStorage.getItem(storageKey) as Theme) || defaultTheme; } catch { return defaultTheme; }
  });
  const [sysDark, setSysDark] = useState(systemDark);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => setSysDark(mql.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  const resolved = theme === "system" ? (sysDark ? "dark" : "light") : theme;
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setTheme = (t: Theme) => {
    try { localStorage.setItem(storageKey, t); } catch { /* private mode */ }
    setThemeState(t);
  };
  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
