import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StaffAttendanceQueryDto, UpsertStaffAttendanceDto } from './staff-attendance.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };

function payload(entry: Record<string, unknown>) {
  return plainToInstance(UpsertStaffAttendanceDto, {
    date: '2026-10-01',
    entries: [entry],
  });
}

describe('UpsertStaffAttendanceDto', () => {
  it('accepts a valid entry with leftAt', async () => {
    const errors = await validate(
      payload({ teacherId: '11111111-1111-4111-8111-111111111111', status: 'PRESENT', leftAt: '12:30' }),
      options,
    );

    expect(errors).toEqual([]);
  });

  it('rejects a malformed leftAt time', async () => {
    const errors = await validate(
      payload({ teacherId: '11111111-1111-4111-8111-111111111111', status: 'PRESENT', leftAt: '25:99' }),
      options,
    );

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an unknown status', async () => {
    const errors = await validate(
      payload({ teacherId: '11111111-1111-4111-8111-111111111111', status: 'SLEEPING' }),
      options,
    );

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a malformed month filter', async () => {
    const dto = plainToInstance(StaffAttendanceQueryDto, { month: 'yesterday' });
    const errors = await validate(dto, options);

    expect(errors.length).toBeGreaterThan(0);
  });
});
