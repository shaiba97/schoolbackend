import { BadRequestException } from '@nestjs/common';

type Parser = {
  parseDay(value: unknown, field: string): Date;
  parsePeriod(start: unknown, end: unknown): { start: Date; end: Date };
};

// Exercises the private helpers through the prototype without booting Nest.
const svc = Object.create(
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./finance-payroll.service').FinancePayrollService.prototype,
) as Parser;

describe('payroll period parsing', () => {
  it('parses ISO dates as UTC midnight', () => {
    const { start, end } = svc.parsePeriod('2026-01-01', '2026-01-31');
    expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  it('accepts Date instances and does not alias the caller object', () => {
    const input = new Date('2026-03-01T00:00:00.000Z');
    const parsed = svc.parseDay(input, 'periodStart');
    expect(parsed.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(parsed).not.toBe(input);
  });

  it('rejects unparseable values with a 400', () => {
    expect(() => svc.parseDay('not-a-date', 'periodStart')).toThrow(BadRequestException);
    expect(() => svc.parseDay(undefined, 'periodStart')).toThrow(BadRequestException);
    expect(() => svc.parseDay('', 'periodEnd')).toThrow(BadRequestException);
    expect(() => svc.parsePeriod(undefined, undefined)).toThrow(BadRequestException);
  });

  it('names the offending field', () => {
    expect(() => svc.parseDay('nope', 'periodEnd')).toThrow(/periodEnd/);
  });

  it('rejects an inverted range', () => {
    expect(() => svc.parsePeriod('2026-03-31', '2026-03-01')).toThrow(/periodStart/);
  });

  it('allows a single-day range', () => {
    const { start, end } = svc.parsePeriod('2026-05-05', '2026-05-05');
    expect(start.getTime()).toBe(end.getTime());
  });
});