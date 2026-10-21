import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TimetableCellDto, TimetableQueryDto } from './timetable.dto';

const base = {
  day: 'MON',
  periodNo: 1,
  isBreak: false,
  startTime: '08:00',
  endTime: '09:00',
};

describe('timetable DTOs', () => {
  it('allows an omitted academic year for the full read', async () => {
    const dto = plainToInstance(TimetableQueryDto, {});
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.some((error) => error.property === 'academicYearId')).toBe(false);
  });

  it('rejects a non-UUID academic year for the full read', async () => {
    const dto = plainToInstance(TimetableQueryDto, { academicYearId: 'not-a-uuid' });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.some((error) => error.property === 'academicYearId')).toBe(true);
  });

  it('rejects invalid time and period values', async () => {
    const dto = plainToInstance(TimetableCellDto, {
      ...base,
      startTime: '8:00',
      endTime: '09:00',
      periodNo: 0,
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.some((error) => error.property === 'startTime')).toBe(true);
    expect(errors.some((error) => error.property === 'periodNo')).toBe(true);
  });
});
