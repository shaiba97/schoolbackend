import { FinancePortalService } from './finance-portal.service';

function makeService(tx: any) {
  const prisma: any = {
    withTenant: async (_t: string, cb: any) => cb(tx),
    withTenantRead: async (_t: string, cb: any) => cb(tx),
  };
  const noop: any = {};
  return new FinancePortalService(prisma, noop, noop, noop, noop, noop, noop, noop, noop, { emitDomainEvent: jest.fn(async () => undefined) } as any);
}

function makeTx(students: any[]) {
  const tx: any = {
    student: {
      findMany: jest.fn(async () => students),
      count: jest.fn(async () => students.length),
    },
  };
  return tx;
}

describe('listAssignableStudents — picker contract', () => {
  it('returns a disambiguating displayLabel per student', async () => {
    const tx = makeTx([
      { id: 's-1', firstName: 'Amina', lastName: 'Khalid', educationLevel: 'SECONDARY', grade: 3 },
      { id: 's-2', firstName: 'Amina', lastName: 'Khalid', educationLevel: 'INTERMEDIATE', grade: 8 },
    ]);
    const svc = makeService(tx);
    const res: any = await svc.listAssignableStudents('tenant-1', 1, 20, 'Amina');
    expect(res.data[0].displayLabel).toBe('Amina Khalid — Secondary, Grade 3');
    expect(res.data[1].displayLabel).toBe('Amina Khalid — Intermediate, Grade 8');
    // Existing fields untouched.
    expect(res.data[0]).toMatchObject({ id: 's-1', name: 'Amina Khalid' });
  });

  it('adds an id-equals branch when the query is a UUID', async () => {
    const tx = makeTx([]);
    const svc = makeService(tx);
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    await svc.listAssignableStudents('tenant-1', 1, 20, uuid);
    const where = tx.student.findMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ id: { equals: uuid } });
  });

  it('omits the OR filter entirely when there is no query', async () => {
    const tx = makeTx([]);
    const svc = makeService(tx);
    await svc.listAssignableStudents('tenant-1', 1, 20, undefined);
    const where = tx.student.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
  });
});
