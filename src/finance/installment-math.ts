export const MAX_INSTALLMENTS = 3;

export function toCents(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Number((n * 100).toPrecision(12)));
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function normalizeInstallmentCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_INSTALLMENTS);
}

export function splitIntoCents(totalCents: number, parts: number): number[] {
  if (parts <= 1) return [totalCents];
  const base = Math.round(totalCents / parts);
  const out = new Array<number>(parts - 1).fill(base);
  out.push(totalCents - base * (parts - 1));
  return out;
}

export type InstallmentPlan = {
  installmentNumber: number;
  installmentTotal: number;
  amount: number;
  dueDate: string | null;
};

export type BuildOptions = {
  grossAmount: unknown;
  discount?: unknown;
  installmentCount?: unknown;
  dueDates?: (string | Date | null | undefined)[];
  registrationToFirst?: unknown;
};

export function buildInstallmentPlan(opts: BuildOptions): InstallmentPlan[] {
  const gross = toCents(opts.grossAmount);
  const discount = Math.min(Math.max(toCents(opts.discount), 0), Math.max(gross, 0));
  const registration = toCents(opts.registrationToFirst);

  let n = normalizeInstallmentCount(opts.installmentCount);

  const netCents = gross - discount;
  if (n > 1 && Math.round(netCents / n) < 1) n = 1;

  const dueDates = opts.dueDates ?? [];
  const parts = splitIntoCents(netCents, n);

  return parts.map((cents, index) => {
    const isFirst = index === 0;
    const amount = fromCents(cents + (isFirst ? registration : 0));
    const rawDue = dueDates[index];
    return {
      installmentNumber: index + 1,
      installmentTotal: n,
      amount,
      dueDate: rawDue ? new Date(rawDue).toISOString() : null,
    };
  });
}

export function sumPlan(plan: InstallmentPlan[]): number {
  return fromCents(plan.reduce((sum, p) => sum + toCents(p.amount), 0));
}

/**
 * Divide a fee total into `count` equal instalments.
 *
 * The sum always reconciles to `totalAmount` exactly: the first count-1 parts are
 * equal and the final part absorbs the remainder. Rounding happens on integer
 * cents, never on binary floats, so 2,000,000 / 3 does not drift.
 */
export function splitIntoInstallments(totalAmount: unknown, count: unknown): number[] {
  const total = toCents(totalAmount);
  const n = normalizeInstallmentCount(count);
  return splitIntoCents(total, n).map(fromCents);
}