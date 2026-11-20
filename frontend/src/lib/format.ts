import { differenceInCalendarDays, format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday } from "date-fns";

export const fmtDate = (d: string | Date | null | undefined, f = "d MMM yyyy") => (d ? format(new Date(d), f) : "—");
export const timeAgo = (d: string | Date) => `${formatDistanceToNowStrict(new Date(d))} ago`;

export function dueLabel(d: string | null, done = false): { text: string; tone: "muted" | "warn" | "danger" } | null {
  if (!d) return null;
  const date = new Date(d);
  const days = differenceInCalendarDays(date, new Date());
  const text = isToday(date) ? "Today" : isTomorrow(date) ? "Tomorrow" : isYesterday(date) ? "Yesterday" : format(date, days > -300 && days < 300 ? "d MMM" : "d MMM yy");
  if (done) return { text, tone: "muted" };
  return { text, tone: days < 0 ? "danger" : days <= 2 ? "warn" : "muted" };
}

export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** "2026-11-11" for <input type="date"> */
export const toDateInput = (d: string | null | undefined) => (d ? format(new Date(d), "yyyy-MM-dd") : "");
/** End of the chosen local day, so "due 12 Nov" means by the end of 12 Nov. */
export const fromDateInput = (s: string) => (s ? new Date(`${s}T23:59:00`).toISOString() : null);
