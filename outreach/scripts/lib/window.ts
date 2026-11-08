/**
 * window.ts · THE SENDING HOURS: when a follow-up email of the sequence is scheduled, on the agency's own clock.
 *
 * A next email is never due in the middle of the night: its time is moved forward to the next opening of the window
 * (default Monday to Friday, 9:00 to 17:00, in the agency's time zone). Set it in agency.config.json:
 *   "mail": { "sendHours": { "start": 9, "end": 17, "days": [1, 2, 3, 4, 5] } }   (days: 0 = Sunday … 6 = Saturday)
 * Also: the date the cockpit shows for « Next » (`nextLabel`), in the agency's locale and time zone.
 */
import { agency } from "../../../packages/shared/agency.mjs"

export type SendWindow = { start: number; end: number; days: number[]; tz: string; locale: string }

/** the agency's sending window (its config, else Mon–Fri 9:00–17:00, in its time zone) */
export function sendWindow(env: NodeJS.ProcessEnv = process.env): SendWindow {
  const a = agency(env) as any
  const h = a.mail?.sendHours || {}
  const hour = (v: unknown, d: number) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 24 ? n : d }
  const start = hour(h.start, 9), end = hour(h.end, 17)
  const days = Array.isArray(h.days) && h.days.length ? h.days.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6) : [1, 2, 3, 4, 5]
  let tz = String(a.timezone || "UTC"); try { new Intl.DateTimeFormat("en-US", { timeZone: tz }) } catch { tz = "UTC" }
  return { start: end > start ? start : 9, end: end > start ? end : 17, days: days.length ? days : [1, 2, 3, 4, 5], tz, locale: String(a.locale || "en-US") }
}

/** the wall clock of instant `t` in `tz` */
function wall(t: number, tz: string): { y: number; m: number; d: number; h: number; min: number; wd: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(t).map((x) => [x.type, x.value]))
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(p.weekday))
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute), wd }
}
/** the instant of a wall-clock time in `tz` (DST-safe : the offset is read at that instant) */
export function atWall(y: number, m: number, d: number, h: number, min: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, min)
  const off = (t: number) => { const w = wall(t, tz); return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min) - Math.floor(t / 60_000) * 60_000 }
  let t = guess - off(guess)
  const o2 = off(t); if (guess - o2 !== t) t = guess - o2
  return t
}

/** is `t` inside the sending window ? */
export function inWindow(t: number, w: SendWindow = sendWindow()): boolean {
  const x = wall(t, w.tz)
  return w.days.includes(x.wd) && x.h >= w.start && x.h < w.end
}

/** `t` itself when it is inside the window, else the next opening (the start hour of the next sending day) */
export function nextInWindow(t: number, w: SendWindow = sendWindow()): number {
  if (inWindow(t, w)) return t
  const x = wall(t, w.tz)
  for (let k = 0; k <= 8; k++) {
    const day = new Date(Date.UTC(x.y, x.m - 1, x.d + k))
    if (!w.days.includes(day.getUTCDay())) continue
    const open = atWall(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), w.start, 0, w.tz)
    if (open > t) return open
  }
  return t
}

/** an ISO time moved into the window (the sequencer's nextRunAt) */
export function scheduleIso(iso: string, w: SendWindow = sendWindow()): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(nextInWindow(t, w)).toISOString() : iso
}

/** the cockpit speaks English : the agency's own English locale (en-US : 12-hour, month first), else en-GB (24-hour,
 *  day first, as a French agency writes its dates) — never French words in the English UI */
const uiLocale = (w: SendWindow): string => (/^en(-|$)/i.test(w.locale) ? w.locale : "en-GB")
/** « Tue, Nov 10, 9:00 AM » on the agency's clock (am/pm where its locale says so ; « Tue 10 Nov, 09:00 » in Europe) */
export function wallLabel(t: number, w: SendWindow = sendWindow()): string {
  try {
    return new Intl.DateTimeFormat(uiLocale(w), { timeZone: w.tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(t)
  } catch { return new Date(t).toISOString().slice(0, 16).replace("T", " ") }
}

/** the window in words : « Mon–Fri, 9 AM–5 PM (America/Chicago) » */
export function windowLabel(w: SendWindow = sendWindow()): string {
  const days = w.days.join(",") === "1,2,3,4,5" ? "Mon–Fri" : w.days.length === 7 ? "every day" : w.days.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ")
  const h = (n: number) => { try { return new Intl.DateTimeFormat(uiLocale(w), { hour: "numeric", timeZone: "UTC" }).format(Date.UTC(2026, 0, 5, n)) } catch { return `${n}:00` } }
  return `${days}, ${h(w.start)}–${h(w.end)}`
}
