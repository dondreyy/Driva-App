/** Pickup time choices: "Now", or a day in the next week and a time in 30 minute steps. */

export const STEP_MINUTES = 30;

export function dayLabels(now: Date, count = 7): string[] {
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return 'Today';
    if (i === 1) return 'Tomorrow';
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    return d.toLocaleDateString('en-NG', { weekday: 'long' });
  });
}

/** Default later time: the next half hour, plus an hour to find a driver. */
export function defaultLaterMinutes(now: Date): number {
  const minutes = now.getHours() * 60 + now.getMinutes() + 60;
  return Math.min(Math.ceil(minutes / STEP_MINUTES) * STEP_MINUTES, 23 * 60 + 30);
}

export function pickupDate(now: Date, dayOffset: number, minutes: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

export function timeLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function whenLabel(iso: string | null): string {
  if (!iso) return 'Now';
  return new Date(iso).toLocaleString('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
