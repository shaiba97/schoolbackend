import {
  buildInstallmentPlan,
  splitIntoCents,
  normalizeInstallmentCount,
  toCents,
  fromCents,
  sumPlan,
} from './installment-math';

const sum = (n: number[]) => n.reduce((a, b) => a + b, 0);

describe('splitIntoCents', () => {
  it('splits 2,000,000 into three rounding the first parts and absorbing the remainder', () => {
    expect(fromCents(splitIntoCents(200000000, 3)[0])).toBe(666666.67);
    expect(fromCents(splitIntoCents(200000000, 3)[1])).toBe(666666.67);
    expect(fromCents(splitIntoCents(200000000, 3)[2])).toBe(666666.66);
  });

  it('always sums back to the total', () => {
    for (const total of [200000000, 10000, 1, 7, 999999999]) {
      expect(sum(splitIntoCents(total, 3))).toBe(total);
      expect(sum(splitIntoCents(total, 2))).toBe(total);
    }
  });

  it('returns a single part for a single installment', () => {
    expect(splitIntoCents(5000, 1)).toEqual([5000]);
  });
});

describe('normalizeInstallmentCount', () => {
  it('clamps to the allowed 1..3 range and rejects junk', () => {
    expect(normalizeInstallmentCount(1)).toBe(1);
    expect(normalizeInstallmentCount(2)).toBe(2);
    expect(normalizeInstallmentCount(3)).toBe(3);
    expect(normalizeInstallmentCount(9)).toBe(3);
    expect(normalizeInstallmentCount(0)).toBe(1);
    expect(normalizeInstallmentCount(-4)).toBe(1);
    expect(normalizeInstallmentCount(undefined)).toBe(1);
    expect(normalizeInstallmentCount(null)).toBe(1);
    expect(normalizeInstallmentCount(2.5)).toBe(1);
    expect(normalizeInstallmentCount(Number.NaN)).toBe(1);
  });
});

describe('buildInstallmentPlan', () => {
  it('meets the 2,000,000 over three installments criterion', () => {
    const plan = buildInstallmentPlan({ grossAmount: 2000000, installmentCount: 3 });
    expect(plan.map((p) => p.amount)).toEqual([666666.67, 666666.67, 666666.66]);
    expect(sumPlan(plan)).toBe(2000000);
    expect(plan.map((p) => p.installmentNumber)).toEqual([1, 2, 3]);
    expect(plan.every((p) => p.installmentTotal === 3)).toBe(true);
  });

  it('spreads a 15% sibling discount proportionally and totals exactly 1,700,000', () => {
    const plan = buildInstallmentPlan({ grossAmount: 2000000, discount: 300000, installmentCount: 3 });
    expect(sumPlan(plan)).toBe(1700000);
    expect(plan.map((p) => p.amount)).toEqual([566666.67, 566666.67, 566666.66]);
  });

  it('does not double-subtract the discount', () => {
    const plan = buildInstallmentPlan({ grossAmount: 2000000, discount: 300000, installmentCount: 3 });
    expect(sumPlan(plan)).toBe(1700000);
  });

  it('folds the registration fee into installment 1 only', () => {
    const plan = buildInstallmentPlan({
      grossAmount: 2000000,
      installmentCount: 3,
      registrationToFirst: 200000,
    });
    expect(plan.map((p) => p.amount)).toEqual([866666.67, 666666.67, 666666.66]);
    expect(sumPlan(plan)).toBe(2200000);
  });

  it('only ever differs between installments by the absorbed remainder', () => {
    const plan = buildInstallmentPlan({ grossAmount: 2000000, discount: 300000, installmentCount: 3 });
    const amounts = plan.map((p) => toCents(p.amount));
    expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
  });

  it('assigns each installment its own absolute due date', () => {
    const plan = buildInstallmentPlan({
      grossAmount: 2000000,
      installmentCount: 3,
      dueDates: ['2026-01-01', '2026-05-01', '2026-09-01'],
    });
    expect(plan.map((p) => p.dueDate?.slice(0, 10))).toEqual(['2026-01-01', '2026-05-01', '2026-09-01']);
  });

  it('handles a single installment with registration', () => {
    const plan = buildInstallmentPlan({ grossAmount: 1000000, registrationToFirst: 50000 });
    expect(plan).toHaveLength(1);
    expect(plan[0].amount).toBe(1050000);
    expect(plan[0].installmentTotal).toBe(1);
  });

  it('never produces zero-amount installments for tiny fees', () => {
    const plan = buildInstallmentPlan({ grossAmount: 0.01, installmentCount: 3 });
    expect(plan).toHaveLength(1);
    expect(plan[0].amount).toBe(0.01);
  });

  it('treats a 100% discount as zero without going negative', () => {
    const plan = buildInstallmentPlan({ grossAmount: 2000000, discount: 2000000, installmentCount: 3 });
    expect(sumPlan(plan)).toBe(0);
    expect(plan.every((p) => p.amount >= 0)).toBe(true);
  });

  it('clamps a discount larger than the amount instead of producing negative installments', () => {
    const plan = buildInstallmentPlan({ grossAmount: 100, discount: 500, installmentCount: 3 });
    expect(sumPlan(plan)).toBe(0);
    expect(plan.every((p) => p.amount >= 0)).toBe(true);
  });

  it('survives undefined and non-finite inputs', () => {
    expect(sumPlan(buildInstallmentPlan({ grossAmount: undefined, installmentCount: 3 }))).toBe(0);
    expect(sumPlan(buildInstallmentPlan({ grossAmount: Number.NaN, installmentCount: 3 }))).toBe(0);
  });

  it('is deterministic for the same input', () => {
    const a = buildInstallmentPlan({ grossAmount: 2000000, installmentCount: 3, registrationToFirst: 200000 });
    const b = buildInstallmentPlan({ grossAmount: 2000000, installmentCount: 3, registrationToFirst: 200000 });
    expect(a).toEqual(b);
  });
});

describe('toCents', () => {
  it('avoids the float half-cent defect', () => {
    expect(fromCents(toCents(1.005))).toBe(1.01);
    expect(fromCents(toCents(2.675))).toBe(2.68);
    expect(fromCents(toCents(0.1 + 0.2))).toBe(0.3);
  });

  it('treats junk as zero', () => {
    expect(toCents(undefined)).toBe(0);
    expect(toCents(null)).toBe(0);
    expect(toCents(Number.NaN)).toBe(0);
    expect(toCents(Number.POSITIVE_INFINITY)).toBe(0);
  });
});