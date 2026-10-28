import { NotFoundException } from '@nestjs/common';
import { InquiriesService } from './inquiries.service';

const row = {
  id: 'inq-1',
  fullName: 'Amina Saeed',
  schoolName: 'Al-Manar Academy',
  email: 'amina@almanar.sd',
  phone: '+249912345678',
  region: 'SUDAN',
  subject: null,
  message: 'Please send a quote.',
  status: 'PENDING',
  ipAddress: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function make(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const prismaMock = {
    inquiry: {
      findMany: jest.fn().mockResolvedValue([row]),
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
      delete: jest.fn().mockResolvedValue(row),
      ...overrides,
    },
  };
  return { service: new InquiriesService(prismaMock as never), prismaMock };
}

describe('InquiriesService', () => {
  it('lists with clamped pagination and no cursor beyond the page', async () => {
    const { service, prismaMock } = make();
    const result = await service.list({ limit: '5', status: 'PENDING' });
    expect(result.nextCursor).toBeNull();
    expect(prismaMock.inquiry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING', region: undefined },
        take: 6,
      }),
    );
  });

  it('exposes the next cursor when the page overflows', async () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ ...row, id: `inq-${i}` }));
    const { service } = make({ findMany: jest.fn().mockResolvedValue(items) });
    const result = await service.list({ limit: '5' });
    expect(result.items).toHaveLength(5);
    expect(result.nextCursor).toBe('inq-5');
  });

  it('applies text search across the intake fields', async () => {
    const { service, prismaMock } = make();
    await service.list({ search: ' almanar ' });
    const call = prismaMock.inquiry.findMany.mock.lastCall[0];
    expect(call.where.status).toBeUndefined();
    expect(call.where.region).toBeUndefined();
    expect(call.where.OR).toEqual(
      expect.arrayContaining([expect.objectContaining({ email: expect.anything() })]),
    );
  });

  it('reads one row and 404s on a miss', async () => {
    const { service } = make({ findUnique: jest.fn().mockResolvedValue(null) });
    await expect(service.one('missing')).rejects.toThrow(NotFoundException);
  });

  it('updates only the provided status/subject fields', async () => {
    const { service, prismaMock } = make();
    const result = await service.update('inq-1', { status: 'RESOLVED', subject: 'Quote' });
    expect(result.id).toBe('inq-1');
    expect(prismaMock.inquiry.update).toHaveBeenCalledWith({
      where: { id: 'inq-1' },
      data: { status: 'RESOLVED', subject: 'Quote' },
      select: expect.objectContaining({ status: true, subject: true }),
    });
  });

  it('deletes by id and reports the deleted id', async () => {
    const { service } = make();
    const result = await service.remove('inq-1');
    expect(result).toEqual({ id: 'inq-1', deleted: true });
  });
});
