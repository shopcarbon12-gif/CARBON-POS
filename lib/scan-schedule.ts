/**
 * Minimal mirror of the WMS reader scan-schedule evaluator
 * (carbon-warehouse-management/lib/server/scan-schedule.ts) — just the read-side
 * needed by the POS to tell whether the register reader is within its store
 * hours right now. Windows are PAUSE (closed) windows; `to < from` crosses
 * midnight. Days: 0=Sun..6=Sat. No date library — uses Intl with the zone.
 */

export type ScheduleWindow = { days: number[]; from: string; to: string };
export type ScanSchedule = { timezone: string; windows: ScheduleWindow[] };

function parseHHMM(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function nowInZone(tz: string, now: Date): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "00") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "00");
  const dowMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return { dow: dowMap[wd] ?? 0, minutes: hour * 60 + minute };
}

function isInPauseWindow(schedule: ScanSchedule, now: Date): boolean {
  const { dow, minutes } = nowInZone(schedule.timezone, now);
  const yesterday = (dow + 6) % 7;
  for (const w of schedule.windows) {
    const from = parseHHMM(w.from);
    const to = parseHHMM(w.to);
    if (from === null || to === null) continue;
    if (from < to) {
      if (w.days.includes(dow) && minutes >= from && minutes < to) return true;
    } else {
      if (w.days.includes(dow) && minutes >= from) return true;
      if (w.days.includes(yesterday) && minutes < to) return true;
    }
  }
  return false;
}

/** True when the reader is within its open (scanning) hours right now. A
 *  reader with no schedule is treated as always-open. */
export function isReaderScheduledOpen(
  schedule: ScanSchedule | null,
  now: Date = new Date(),
): boolean {
  if (!schedule || !Array.isArray(schedule.windows) || schedule.windows.length === 0) {
    return true;
  }
  return !isInPauseWindow(schedule, now);
}
