export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Guayaquil';
const OFFSET = '-05:00'; // Guayaquil has no DST; kept only in this canonical converter.

export function parseRequestedStart(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) throw new Error('INVALID_START');
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}${OFFSET}`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error('INVALID_START');
  return date;
}
export function localDateTimeToUtc(date: string, time: string): Date { return parseRequestedStart(`${date}T${time}`); }
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) { return aStart < bEnd && aEnd > bStart; }
export function localWeekday(date: Date): number { return (Number(new Intl.DateTimeFormat('en-US', { timeZone: APP_TIMEZONE, weekday: 'short' }).format(date).replace(/\D/g, '')) || ((date.getUTCDay() + 6) % 7)); }
export function localDate(date: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
export function localTime(date: Date): string { return new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date); }
export function minutes(time: string) { const [h = 0, m = 0] = time.split(':').map(Number); return h * 60 + m; }
