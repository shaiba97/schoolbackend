import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdmissionGuardianDto } from './admission.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };

describe('AdmissionGuardianDto guardian linking', () => {
  it('accepts a link payload without name or password', async () => {
    const dto = plainToInstance(AdmissionGuardianDto, {
      guardianId: '55555555-5555-4555-8555-555555555555',
      relationship: 'FATHER',
      isPrimary: true,
      canPickup: true,
      emergencyContact: false,
    });
    const errors = await validate(dto, options);

    expect(errors).toEqual([]);
  });

  it('rejects a non-UUID guardian id', async () => {
    const dto = plainToInstance(AdmissionGuardianDto, {
      guardianId: 'not-a-uuid',
      relationship: 'FATHER',
    });
    const errors = await validate(dto, options);

    expect(errors.some((error) => error.property === 'guardianId')).toBe(true);
  });

  it('still requires a password when creating (no guardian id)', async () => {
    const dto = plainToInstance(AdmissionGuardianDto, {
      firstName: 'Amina',
      phone: '+249911234567',
      relationship: 'MOTHER',
    });
    const errors = await validate(dto, options);

    expect(errors.some((error) => error.property === 'password')).toBe(true);
  });

  it('accepts a complete create payload', async () => {
    const dto = plainToInstance(AdmissionGuardianDto, {
      firstName: 'Amina',
      phone: '+249911234567',
      password: 'long-enough-password',
      relationship: 'MOTHER',
    });
    const errors = await validate(dto, options);

    expect(errors).toEqual([]);
  });
});
