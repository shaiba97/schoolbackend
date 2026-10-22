import {
  MAXIMUM_TERM_YEARS,
  MINIMUM_TERM_YEARS,
  monthlyEquivalent,
  termTotal,
  termYears,
} from './platform-pricing';

describe('monthlyEquivalent', () => {
  it('turns a yearly price into the monthly equivalent', () => {
    expect(monthlyEquivalent(800)).toBe(66.67);
    expect(monthlyEquivalent(3600)).toBe(300);
    expect(monthlyEquivalent(1200)).toBe(100);
  });

  it('rounds to two decimals', () => {
    expect(monthlyEquivalent(1000)).toBe(83.33);
    expect(monthlyEquivalent(799.99)).toBe(66.67);
  });

  it('treats a tier without a price as nothing to bill', () => {
    expect(monthlyEquivalent(0)).toBe(0);
    expect(monthlyEquivalent(-5)).toBe(0);
  });
});

describe('termTotal', () => {
  it('multiplies the yearly price by the years', () => {
    expect(termTotal(800, 1)).toBe(800);
    expect(termTotal(800, 2)).toBe(1600);
    expect(termTotal(3600, 3)).toBe(10800);
  });

  it('is zero for a tier without a price', () => {
    expect(termTotal(0, 2)).toBe(0);
  });
});

describe('termYears', () => {
  it('reads the years a licence runs for', () => {
    const started = new Date('2026-01-01T00:00:00Z');
    expect(termYears(started, new Date('2027-01-01T00:00:00Z'))).toBe(1);
    expect(termYears(started, new Date('2029-01-01T00:00:00Z'))).toBe(3);
  });

  it('is null without an end date', () => {
    expect(termYears(new Date('2026-01-01T00:00:00Z'), null)).toBeNull();
    expect(termYears(null, new Date('2027-01-01T00:00:00Z'))).toBeNull();
  });
});

describe('the term bounds', () => {
  it('makes a year the shortest subscription', () => {
    expect(MINIMUM_TERM_YEARS).toBe(1);
    expect(MAXIMUM_TERM_YEARS).toBeGreaterThanOrEqual(5);
  });
});
