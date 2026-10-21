import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateFeeStructureDto } from './finance.dto';

const errorsFor = (body: unknown) =>
  validateSync(plainToInstance(CreateFeeStructureDto, body)).map((e) => e.property);

describe('CreateFeeStructureDto â€” installment validation', () => {
  it('accepts a minimal structure', () => {
    expect(errorsFor({ name: 'Tuition', tuitionFee: 2000000 })).toEqual([]);
  });

  it('accepts a three installment structure with matching dates', () => {
    expect(
      errorsFor({
        name: 'Tuition',
        tuitionFee: 2000000,
        installmentCount: 3,
        installmentDueDates: ['2026-01-01', '2026-05-01', '2026-09-01'],
      }),
    ).toEqual([]);
  });

  it('accepts a single installment with one date', () => {
    expect(
      errorsFor({ name: 'Tuition', tuitionFee: 1000000, installmentCount: 1, installmentDueDates: ['2026-01-01'] }),
    ).toEqual([]);
  });

  it('rejects a count below one', () => {
    expect(errorsFor({ name: 'Tuition', tuitionFee: 1, installmentCount: 0 })).toContain('installmentCount');
  });

  it('rejects a count above three', () => {
    expect(errorsFor({ name: 'Tuition', tuitionFee: 1, installmentCount: 4 })).toContain('installmentCount');
  });

  it('rejects a fractional count', () => {
    expect(errorsFor({ name: 'Tuition', tuitionFee: 1, installmentCount: 2.5 })).toContain('installmentCount');
  });

  it('rejects a blank name', () => {
    expect(errorsFor({ name: '   ', tuitionFee: 100 })).toContain('name');
  });

  it('rejects a negative tuition fee', () => {
    expect(errorsFor({ name: 'Tuition', tuitionFee: -5 })).toContain('tuitionFee');
  });

  it('rejects malformed due dates', () => {
    expect(
      errorsFor({ name: 'Tuition', tuitionFee: 1, installmentCount: 1, installmentDueDates: ['not-a-date'] }),
    ).toContain('installmentDueDates');
  });

  it('rejects more dates than the maximum of three', () => {
    expect(
      errorsFor({
        name: 'Tuition',
        tuitionFee: 1,
        installmentCount: 3,
        installmentDueDates: ['2026-01-01', '2026-05-01', '2026-09-01', '2026-12-01'],
      }),
    ).toContain('installmentDueDates');
  });

  it('accepts an optional registration fee', () => {
    expect(
      errorsFor({ name: 'Registration', tuitionFee: 200000, registrationFee: 50000 }),
    ).toEqual([]);
  });

  it('coerces a numeric string tuition fee', () => {
    const dto = plainToInstance(CreateFeeStructureDto, { name: 'Tuition', tuitionFee: '2000000' });
    expect(dto.tuitionFee).toBe(2000000);
    expect(validateSync(dto)).toHaveLength(0);
  });
});

