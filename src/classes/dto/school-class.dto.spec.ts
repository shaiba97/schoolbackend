import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSchoolClassDto } from './school-class.dto';

describe('CreateSchoolClassDto', () => {
  it('accepts the class form contract', async () => {
    const dto = plainToInstance(CreateSchoolClassDto, {
      className: 'Grade 10',
      educationLevel: 'SECONDARY',
      grade: 'FIRST',
      gender: 'MIXED',
      capacity: 30,
    });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors).toHaveLength(0);
  });

  it('rejects an unknown gender value', async () => {
    const dto = plainToInstance(CreateSchoolClassDto, {
      className: 'Grade 10',
      educationLevel: 'SECONDARY',
      grade: 'FIRST',
      gender: 'COED',
    });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.some((error) => error.property === 'gender')).toBe(true);
  });

  it.each(['name', 'code', 'description', 'sequenceNo', 'supervisorTeacherId'])(
    'rejects the retired class field %s',
    async (field) => {
      const dto = plainToInstance(CreateSchoolClassDto, {
        className: 'Grade 10',
        educationLevel: 'SECONDARY',
        grade: 'FIRST',
        [field]: 'x',
      });

      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe(field);
    },
  );
});
