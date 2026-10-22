/**
 * The platform's pricing arithmetic, in one place.
 *
 * A tier carries a flat **yearly** price. The console shows the monthly
 * equivalent the way Vercel does - a monthly headline with the yearly
 * amount beneath - and a subscription is bought for a term of one year or
 * more, so the amount due for a term is the yearly price times the years.
 *
 * Both numbers are derived, never stored: a stored monthly price would
 * drift from the yearly price the moment a tier is re-priced, and the
 * recurring revenue in the profit and loss would then be wrong.
 */

/** The shortest subscription: one year. */
export const MINIMUM_TERM_YEARS = 1;

/** The longest subscription a single term may run. */
export const MAXIMUM_TERM_YEARS = 10;

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * The monthly equivalent of a yearly price: 800 a year is 66.67 a month.
 *
 * The rounding is on the multiplied value, so the result is the price in
 * whole cents and not a fraction of a cent.
 */
export function monthlyEquivalent(yearly: number): number {
  if (!Number.isFinite(yearly) || yearly <= 0) return 0;
  return Math.round((yearly / 12) * 100) / 100;
}

/**
 * What a term costs: the yearly price times the years.
 */
export function termTotal(yearly: number, years: number): number {
  if (!Number.isFinite(yearly) || yearly <= 0) return 0;
  return round2(yearly * Math.max(0, years));
}

/**
 * The years a licence runs for, worked out from its start and end. A
 * licence without an end date has no term.
 */
export function termYears(
  startedAt: Date | null | undefined,
  expiresAt: Date | null | undefined,
  baseTermDays = 365,
): number | null {
  if (!startedAt || !expiresAt) return null;
  const days = Math.round(
    (expiresAt.getTime() - startedAt.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (days <= 0 || baseTermDays <= 0) return null;
  return Math.max(1, Math.round(days / baseTermDays));
}
