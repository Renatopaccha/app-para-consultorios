import { centsToDollars, dollarsToCents } from './money';

describe('money', () => {
  it.each([[0, 0], [19, 1900], [35.5, 3550], [0.1 + 0.2, 30]])('converts %p dollars to %p cents', (input, expected) => {
    expect(dollarsToCents(input)).toBe(expected);
  });
  it('rejects invalid amounts', () => {
    for (const value of [-1, NaN, Infinity, 1_000_000.01]) expect(() => dollarsToCents(value)).toThrow();
  });
  it('formats cents without losing one cent', () => {
    expect(centsToDollars(3550)).toBe(35.5);
    expect(centsToDollars(1)).toBe(0.01);
  });
});
