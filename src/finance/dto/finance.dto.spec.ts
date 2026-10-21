import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateFeeCategoryDto,
  UpdateFeeCategoryDto,
} from './finance.dto';

const errorsFor = (cls: typeof CreateFeeCategoryDto | typeof UpdateFeeCategoryDto, body: unknown) =>
  validateSync(plainToInstance(cls, body)).map((e) => e.property);

describe('fee category DTO validation', () => {
  it('requires a name on create', () => {
    expect(errorsFor(CreateFeeCategoryDto, {})).toContain('name');
  });

  it('rejects a blank name on create', () => {
    expect(errorsFor(CreateFeeCategoryDto, { name: '' })).toContain('name');
    expect(errorsFor(CreateFeeCategoryDto, { name: '   ' })).toContain('name');
  });

  it('trims the name before validation', () => {
    const dto = plainToInstance(CreateFeeCategoryDto, { name: '  Tuition  ' });
    expect(dto.name).toBe('Tuition');
  });

  it('accepts a description and keeps it optional', () => {
    expect(errorsFor(CreateFeeCategoryDto, { name: 'Tuition' })).not.toContain('description');
    expect(errorsFor(CreateFeeCategoryDto, { name: 'Tuition', description: 'x' })).toEqual([]);
  });

  it('rejects a non-string description', () => {
    expect(errorsFor(CreateFeeCategoryDto, { name: 'Tuition', description: 123 })).toContain('description');
  });

  it('allows a partial update', () => {
    expect(errorsFor(UpdateFeeCategoryDto, {})).toEqual([]);
    expect(errorsFor(UpdateFeeCategoryDto, { description: 'only desc' })).toEqual([]);
  });

  it('rejects a blank name on update', () => {
    expect(errorsFor(UpdateFeeCategoryDto, { name: '  ' })).toContain('name');
  });
});