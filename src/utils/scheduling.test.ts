import { localDate, localTime, localWeekday, parseRequestedStart } from './scheduling';

describe('agenda en America/Guayaquil', () => {
  it.each([
    ['2026-08-01T09:00:00-05:00', '2026-08-01', '09:00', 5],
    ['2026-08-01T12:00:00-05:00', '2026-08-01', '12:00', 5],
    ['2026-08-01T00:00:00-05:00', '2026-08-01', '00:00', 5],
    ['2026-08-01T23:59:00-05:00', '2026-08-01', '23:59', 5],
    ['2026-08-02T00:00:00-05:00', '2026-08-02', '00:00', 6],
  ])('conserva fecha, hora y weekday local para %s', (input, expectedDate, expectedTime, weekday) => {
    const instant = parseRequestedStart(input);
    expect(localDate(instant)).toBe(expectedDate);
    expect(localTime(instant)).toBe(expectedTime);
    expect(localWeekday(instant)).toBe(weekday);
  });
});
