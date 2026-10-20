import type { BusinessHours } from '@wa/shared';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Whether the business is open at `at` in its own timezone. */
export function isBusinessOpen(
  hours: BusinessHours | null | undefined,
  timezone: string,
  at = new Date(),
): boolean {
  if (!hours) return true;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const weekday =
    parts
      .find((p) => p.type === 'weekday')
      ?.value.toLowerCase()
      .slice(0, 3) ?? 'mon';
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const day = hours[DAY_KEYS.find((d) => d === weekday) ?? 'mon'];
  if (!day || !day.open) return false;
  const now = `${hh}:${mm}`;
  return now >= day.from && now < day.to;
}

export const DEFAULT_HOURS: BusinessHours = {
  mon: { open: true, from: '10:00', to: '20:00' },
  tue: { open: true, from: '10:00', to: '20:00' },
  wed: { open: true, from: '10:00', to: '20:00' },
  thu: { open: true, from: '10:00', to: '20:00' },
  fri: { open: true, from: '10:00', to: '20:00' },
  sat: { open: true, from: '10:00', to: '18:00' },
  sun: { open: false, from: '10:00', to: '14:00' },
};
