import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupportContactsService } from './support-contacts.service';

const row = {
  id: 'sc-1',
  contact: 'support@madar.example',
  contactType: 'EMAIL',
  region: 'SUDAN',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function make(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const prismaMock = {
    supportContact: {
      findMany: jest.fn().mockResolvedValue([row]),
      findUnique: jest.fn().mockResolvedValue(row),
      create: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
      delete: jest.fn().mockResolvedValue(row),
      ...overrides,
    },
  };
  return { service: new SupportContactsService(prismaMock as never), prismaMock };
}

describe('SupportContactsService', () => {
  it('creates a scoped contact', async () => {
    const { service, prismaMock } = make();
    const result = await service.create({
      contact: 'support@madar.example',
      contactType: 'EMAIL',
      region: 'SUDAN',
    });
    expect(result.id).toBe('sc-1');
    expect(prismaMock.supportContact.create).toHaveBeenCalledWith({
      data: { contact: 'support@madar.example', contactType: 'EMAIL', region: 'SUDAN' },
      select: expect.objectContaining({ id: true, contact: true }),
    });
  });

  it('translates unique violations into a 409', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'duplicate key value violates unique constraint',
      { code: 'P2002', clientVersion: 'test' },
    );
    const { service } = make({ create: jest.fn().mockRejectedValue(conflict) });
    await expect(
      service.create({ contact: 'dup@madar.example', contactType: 'EMAIL', region: 'SUDAN' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('throws NotFound when updating a missing contact', async () => {
    const { service } = make({ findUnique: jest.fn().mockResolvedValue(null) });
    await expect(service.update('missing', { isActive: false })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('deletes by id and reports the deleted id', async () => {
    const { service } = make();
    const result = await service.remove('sc-1');
    expect(result).toEqual({ id: 'sc-1', deleted: true });
  });

  it('filters the directory by region', async () => {
    const { service, prismaMock } = make();
    await service.list({ region: 'GCC_KSA', contactType: '', isActive: '' });
    expect(prismaMock.supportContact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { region: 'GCC_KSA', contactType: undefined },
      }),
    );
  });

  it('lists only active contacts with public fields for the landing page', async () => {
    const { service, prismaMock } = make();
    const result = await service.publicActive();
    expect(prismaMock.supportContact.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { contact: true, contactType: true, region: true },
      orderBy: [{ region: 'asc' }, { createdAt: 'desc' }],
    });
    expect(result.items).toHaveLength(1);
  });

  it('keeps ConflictException from create with other Prisma errors untouched', async () => {
    const { service } = make({
      create: jest.fn().mockRejectedValue(new ConflictException('other')),
    });
    await expect(
      service.create({ contact: 'x@madar.example', contactType: 'EMAIL', region: 'SUDAN' }),
    ).rejects.toBeTruthy();
  });
});
