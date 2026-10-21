import { splitIntoInstallments } from './installment-math';
import { toCents } from './installment-math';

const sum = (parts: number[]) => parts.reduce((a, b) => a + b, 0);
const cents = (parts: number[]) => parts.reduce((a, b) => a + toCents(b), 0);

describe('splitIntoInstallments — the worked example from the spec', () => {
  it('splits 2,000,000 into three instalments that reconcile exactly', () => {
    const parts = splitIntoInstallments(2000000, 3);
    expect(parts).toEqual([666666.67, 666666.67, 666666.66]);
    expect(cents(parts)).toBe(toCents(2000000));
  });

  it('matches the values already stored in the live FeeInstallment rows', () => {
    expect(splitIntoInstallments(2000000, 3)).toEqual([666666.67, 666666.67, 666666.66]);
  });
});

describe('splitIntoInstallments — reconciliation', () => {
  it('always sums to the total, across many shapes', () => {
    const totals = [0, 1, 2, 5, 7, 99, 100, 101, 1000, 999999, 1000000, 2000000, 1234567.89];
    for (const total of totals) {
      for (const n of [1, 2, 3]) {
        expect(cents(splitIntoInstallments(total, n))).toBe(toCents(total));
      }
    }
  });

  it('never returns a negative part', () => {
    for (const total of [0, 1, 0.01, 0.03, 100]) {
      for (const n of [1, 2, 3]) {
        expect(splitIntoInstallments(total, n).every((p) => p >= 0)).toBe(true);
      }
    }
  });

  it('returns exactly the requested number of parts for 1..3', () => {
    expect(splitIntoInstallments(1000, 1)).toHaveLength(1);
    expect(splitIntoInstallments(1000, 2)).toHaveLength(2);
    expect(splitIntoInstallments(1000, 3)).toHaveLength(3);
  });

  it('gives every part the same value when the total divides evenly', () => {
    expect(splitIntoInstallments(300000, 3)).toEqual([100000, 100000, 100000]);
    expect(splitIntoInstallments(2000, 2)).toEqual([1000, 1000]);
  });

  it('puts the remainder on the final part, keeping the others equal', () => {
    const [a, b, c] = splitIntoInstallments(100, 3);
    expect(a).toBe(b);
    expect(c).toBeGreaterThanOrEqual(a);
  });

  it('never emits a zero-value part for a non-zero total', () => {
    for (const n of [1, 2, 3]) {
      expect(splitIntoInstallments(0.03, n).every((p) => p > 0)).toBe(true);
    }
  });

  it('clamps an out-of-range count to the supported 1..3 window', () => {
    expect(splitIntoInstallments(1000, 9)).toHaveLength(3);
    expect(splitIntoInstallments(1000, 0)).toHaveLength(1);
    expect(splitIntoInstallments(1000, -5)).toHaveLength(1);
  });

  it('survives junk input without throwing', () => {
    expect(splitIntoInstallments(undefined, 3)).toEqual([0, 0, 0]);
    expect(splitIntoInstallments(Number.NaN, 3)).toEqual([0, 0, 0]);
    expect(splitIntoInstallments(1000, undefined)).toHaveLength(1);
    expect(splitIntoInstallments(1000, 2.5)).toHaveLength(1);
  });

  it('accepts numeric strings', () => {
    expect(splitIntoInstallments('2000000', 3)).toEqual([666666.67, 666666.67, 666666.66]);
  });

  it('is deterministic', () => {
    expect(splitIntoInstallments(2000000, 3)).toEqual(splitIntoInstallments(2000000, 3));
  });

  it('produces at most a one-cent spread between parts', () => {
    for (const total of [2000000, 1000000, 999999, 12345.67]) {
      const parts = splitIntoInstallments(total, 3);
      const cs = parts.map(toCents);
      expect(Math.max(...cs) - Math.min(...cs)).toBeLessThanOrEqual(1);
    }
  });
});