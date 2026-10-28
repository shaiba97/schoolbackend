import { FinancePayrollService } from './finance-payroll.service';

const TENANT = 'tenant-1';
const USER = 'user-accountant';

// Mock-tx harness: service methods under test run inside withTenant/withTenantRead.
function harness(tx: any) {
  const prisma: any = {
    withTenant: (_t: string, fn: (t: any) => any) => fn(tx),
    withTenantRead: (_t: string, fn: (t: any) => any) => fn(tx),
  };
  return new FinancePayrollService(prisma);
}

function txBase(over: any = {}) {
  const findMany = jest.fn(async () => []);
  return {
    tenantMembership: { findMany, findFirst: jest.fn(async () => null) },
    teacher: { findMany: jest.fn(async () => []) },
    staffPositionAssignment: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    staffAttendance: { findMany: jest.fn(async () => []) },
    salaryDeductionRule: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    position: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    salaryPayout: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    ...over,
  };
}

// Pure helpers through the prototype (no Nest boot).
const pure = Object.create(FinancePayrollService.prototype) as any;

describe('addMonthsClamped', () => {
  it('clamps Jan 31 to Feb 28 (non-leap)', () => {
    expect(pure.addMonthsClamped(new Date('2026-01-31T00:00:00Z'), 1).toISOString())
      .toBe('2026-02-28T00:00:00.000Z');
  });

  it('clamps Jan 31 to Feb 29 (leap year)', () => {
    expect(pure.addMonthsClamped(new Date('2024-01-31T00:00:00Z'), 1).toISOString())
      .toBe('2024-02-29T00:00:00.000Z');
  });

  it('keeps mid-month days unchanged', () => {
    expect(pure.addMonthsClamped(new Date('2026-10-25T00:00:00Z'), 1).toISOString())
      .toBe('2026-11-25T00:00:00.000Z');
  });
});

describe('computeShortage', () => {
  it('multiplies absent days by the daily rate (2 days x $10 = $20)', () => {
    expect(pure.computeShortage(2, 0, { absentDaily: 10, lateRate: 2 })).toBe(20);
  });

  it('adds late penalties on top', () => {
    expect(pure.computeShortage(2, 3, { absentDaily: 10, lateRate: 2 })).toBe(26);
  });

  it('floors net-relevant deduction at zero for empty counts', () => {
    expect(pure.computeShortage(0, 0, { absentDaily: 10, lateRate: 2 })).toBe(0);
  });
});

describe('listPayrollRegister', () => {
  it('unions admin staff and academic teachers, deduped by user', async () => {
    const tx = txBase();
    (tx.tenantMembership.findMany as jest.Mock).mockResolvedValue([
      { user: { id: 'u1', firstName: 'Hassan', lastName: 'Shaiba', staffNumber: '26ACC0001' }, roles: [{ role: { slug: 'ACCOUNTANT' } }] },
    ]);
    (tx.teacher.findMany as jest.Mock).mockResolvedValue([
      { userId: 'u2', employeeNumber: 'T-001', status: 'ACTIVE', user: { id: 'u2', firstName: 'Amina', lastName: 'Khalid', staffNumber: '26TCH0001' } },
      // same user as admin staff: must not duplicate
      { userId: 'u1', employeeNumber: 'T-002', status: 'ACTIVE', user: { id: 'u1', firstName: 'Hassan', lastName: 'Shaiba', staffNumber: '26ACC0001' } },
    ]);
    const rows: any[] = await harness(tx).listPayrollRegister(TENANT, new Date('2026-10-15T00:00:00Z'));
    expect(rows.map((r) => r.userId)).toEqual(['u1', 'u2']);
    expect(rows.find((r) => r.userId === 'u2')!.roleLabel).toBe('Teacher');
  });

  it('marks a member paid when a PAID payout exists in the cycle month', async () => {
    const tx = txBase();
    (tx.tenantMembership.findMany as jest.Mock).mockResolvedValue([
      { user: { id: 'u1', firstName: 'Hassan', lastName: null, staffNumber: '26ACC0001' }, roles: [{ role: { slug: 'ACCOUNTANT' } }] },
    ]);
    (tx.staffPositionAssignment.findMany as jest.Mock).mockResolvedValue([
      { userId: 'u1', id: 'a1', salaryOverride: null, position: { title: 'Accountant', baseSalary: 5000, currencyCode: 'SDG' } },
    ]);
    (tx.salaryPayout.findMany as jest.Mock).mockResolvedValue([
      { userId: 'u1', status: 'PAID', paidAt: new Date('2026-10-05T00:00:00Z'), netAmount: 5000 },
    ]);
    const rows: any[] = await harness(tx).listPayrollRegister(TENANT, new Date('2026-10-15T00:00:00Z'));
    expect(rows[0].status).toBe('paid');
    expect(rows[0].nextEligibleDate).toBe('2026-11-05');
  });

  it('applies absence deductions to net pay (2 absent x $10 on $5000 base = $4980)', async () => {
    const tx = txBase();
    (tx.tenantMembership.findMany as jest.Mock).mockResolvedValue([
      { user: { id: 'u1', firstName: 'Hassan', lastName: null, staffNumber: '26ACC0001' }, roles: [{ role: { slug: 'ACCOUNTANT' } }] },
    ]);
    (tx.teacher.findMany as jest.Mock).mockResolvedValue([
      { id: 't1', userId: 'u1', employeeNumber: 'T-1', status: 'ACTIVE', user: { id: 'u1', firstName: 'Hassan', lastName: null, staffNumber: '26ACC0001' } },
    ]);
    (tx.staffPositionAssignment.findMany as jest.Mock).mockResolvedValue([
      { userId: 'u1', id: 'a1', salaryOverride: null, position: { title: 'Teacher', baseSalary: 5000, currencyCode: 'SDG' } },
    ]);
    (tx.staffAttendance.findMany as jest.Mock).mockResolvedValue([
      { teacherId: 't1', attendanceDate: new Date('2026-10-03'), status: 'ABSENT' },
      { teacherId: 't1', attendanceDate: new Date('2026-10-04'), status: 'ABSENT' },
      { teacherId: 't1', attendanceDate: new Date('2026-10-05'), status: 'PRESENT' },
    ]);
    (tx.salaryDeductionRule.findMany as jest.Mock).mockResolvedValue([
      { name: '__SHORTAGE_ABSENT_DAILY__', value: 10 },
      { name: '__SHORTAGE_LATE__', value: 2 },
    ]);
    const rows: any[] = await harness(tx).listPayrollRegister(TENANT, new Date('2026-10-15T00:00:00Z'));
    expect(rows[0].absentDays).toBe(2);
    expect(rows[0].deductionAmount).toBe(20);
    expect(rows[0].netPay).toBe(4980);
  });
});

describe('parent exclusion', () => {
  function parentTx() {
    const tx = txBase();
    (tx.tenantMembership.findMany as jest.Mock).mockResolvedValue([
      { user: { id: 'u1', firstName: 'Hassan', lastName: null, staffNumber: '26ACC0001' }, roles: [{ role: { slug: 'ACCOUNTANT' } }] },
      { user: { id: 'p1', firstName: 'Sara', lastName: 'Parent', staffNumber: '' }, roles: [] },
      { user: { id: 'p2', firstName: 'Omar', lastName: 'Guardian', staffNumber: '' }, roles: [{ role: { slug: 'GUARDIAN' } }] },
    ]);
    return tx;
  }

  it('excludes role-less memberships (parents) from the register', async () => {
    const rows: any[] = await harness(parentTx()).listPayrollRegister(TENANT, new Date('2026-10-15T00:00:00Z'));
    expect(rows.map((r) => r.userId)).toEqual(['u1']);
  });

  it('excludes GUARDIAN-slugged memberships', async () => {
    const rows: any[] = await harness(parentTx()).listPayrollRegister(TENANT, new Date('2026-10-15T00:00:00Z'));
    expect(rows.map((r) => r.userId)).not.toContain('p2');
  });

  it('keeps teacher-record members with no membership (Adil/Hisham path)', async () => {
    const tx = parentTx();
    (tx.teacher.findMany as jest.Mock).mockResolvedValue([
      { id: 't9', userId: 'u9', status: 'ACTIVE', user: { id: 'u9', firstName: 'Noor', lastName: null, staffNumber: '26TCH0009' } },
    ]);
    const rows: any[] = await harness(tx).listPayrollRegister(TENANT, new Date('2026-10-15T00:00:00Z'));
    expect(rows.map((r) => r.userId).sort()).toEqual(['u1', 'u9']);
  });

  it('excludes PARENT-slugged memberships (246 live parent accounts)', async () => {
    const tx = parentTx();
    (tx.tenantMembership.findMany as jest.Mock).mockResolvedValue([
      { user: { id: 'u1', firstName: 'Hassan', lastName: null, staffNumber: '26ACC0001' }, roles: [{ role: { slug: 'ACCOUNTANT' } }] },
      { user: { id: 'p3', firstName: 'Mona', lastName: 'Mother', staffNumber: '' }, roles: [{ role: { slug: 'PARENT' } }] },
    ]);
    const rows: any[] = await harness(tx).listPayrollRegister(TENANT, new Date('2026-10-15T00:00:00Z'));
    expect(rows.map((r) => r.userId)).toEqual(['u1']);
  });

  it('excludes PARENT accounts from staff-options (both tabs)', async () => {
    const tx = txBase({
      tenantMembership: {
        findMany: jest.fn(async () => [
          { user: { id: 'u1', firstName: 'Hassan', lastName: null, staffNumber: '26ACC0001' }, roles: [{ role: { slug: 'ACCOUNTANT' } }] },
          { user: { id: 'p3', firstName: 'Mona', lastName: 'Mother', staffNumber: '' }, roles: [{ role: { slug: 'PARENT' } }] },
        ]),
        findFirst: jest.fn(async () => ({ roles: [{ role: { slug: 'ACCOUNTANT' } }] })),
      },
    });
    const out: any = await harness(tx).listPayrollStaffOptions(TENANT, 'caller');
    expect(out.admin.map((s: any) => s.userId)).toEqual(['u1']);
    expect(out.academic).toEqual([]);
  });

  it('400s salary assignment for a PARENT-only account', async () => {
    const tx = txBase({
      tenantMembership: {
        findFirst: jest.fn(async () => ({ roles: [{ role: { slug: 'PARENT' } }] })),
      },
      teacher: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    });
    await expect(harness(tx).assignStaffSalary(TENANT, { userId: 'p3', amount: 100 })).rejects.toThrow();
  });
});

describe('personnel exclusion', () => {
  it('excludes ADMIN / SUPER_ADMIN accounts from the register', async () => {
    const tx = txBase();
    (tx.tenantMembership.findMany as jest.Mock).mockResolvedValue([
      { user: { id: 'u1', firstName: 'Hassan', lastName: null, staffNumber: '26ACC0001' }, roles: [{ role: { slug: 'ACCOUNTANT' } }] },
      { user: { id: 'admin', firstName: 'Root', lastName: null, staffNumber: 'ADMIN001' }, roles: [{ role: { slug: 'SUPER_ADMIN' } }] },
      { user: { id: 'admin2', firstName: 'Sys', lastName: null, staffNumber: 'ADMIN002' }, roles: [{ role: { slug: 'ADMIN' } }] },
    ]);
    const rows: any[] = await harness(tx).listPayrollRegister(TENANT, new Date('2026-10-15T00:00:00Z'));
    expect(rows.map((r) => r.userId)).toEqual(['u1']);
  });

  it('inherits the position base salary (Janitor $600 -> net $600)', async () => {
    const tx = txBase();
    (tx.tenantMembership.findMany as jest.Mock).mockResolvedValue([
      { user: { id: 'u9', firstName: 'Omar', lastName: null, staffNumber: '26JAN0003' }, roles: [{ role: { slug: 'JANITOR' } }] },
    ]);
    (tx.staffPositionAssignment.findMany as jest.Mock).mockResolvedValue([
      { userId: 'u9', id: 'a9', salaryOverride: null, position: { title: 'Janitor', baseSalary: 600, currencyCode: 'SDG' } },
    ]);
    const rows: any[] = await harness(tx).listPayrollRegister(TENANT, new Date('2026-10-15T00:00:00Z'));
    expect(rows[0].baseSalary).toBe(600);
    expect(rows[0].netPay).toBe(600);
  });
});

describe('position linkage', () => {
  it('ignores per-person overrides: position $600 wins over override $900', async () => {
    const tx = txBase();
    (tx.tenantMembership.findMany as jest.Mock).mockResolvedValue([
      { user: { id: 'u9', firstName: 'Omar', lastName: null, staffNumber: '26JAN0003' }, roles: [{ role: { slug: 'JANITOR' } }] },
    ]);
    (tx.staffPositionAssignment.findMany as jest.Mock).mockResolvedValue([
      { userId: 'u9', id: 'a9', salaryOverride: 900, position: { title: 'Janitor', baseSalary: 600, currencyCode: 'SDG' } },
    ]);
    const rows: any[] = await harness(tx).listPayrollRegister(TENANT, new Date('2026-10-15T00:00:00Z'));
    expect(rows[0].baseSalary).toBe(600);
    expect(rows[0].netPay).toBe(600);
  });
});

describe('listPositions scope', () => {
  function posTx(slugs: string[]) {
    return txBase({
      tenantMembership: {
        findFirst: jest.fn(async () => ({
          roles: slugs.map((slug) => ({ role: { slug } })),
        })),
      },
      position: {
        findMany: jest.fn(async (args: any) => {
          (posTx as any).lastWhere = args.where;
          return [];
        }),
      },
    });
  }

  it('scopes academic-affairs callers to teacher positions only', async () => {
    const tx = posTx(['ACADEMIC_AFFAIRS']);
    await harness(tx).listPositions(TENANT, 'caller-1');
    expect((posTx as any).lastWhere.title).toMatchObject({ contains: 'teach' });
  });

  it('gives accountants the full list (still minus admin titles)', async () => {
    const tx = posTx(['ACCOUNTANT']);
    await harness(tx).listPositions(TENANT, 'caller-2');
    expect((posTx as any).lastWhere.title).toBeUndefined();
    expect((posTx as any).lastWhere.NOT).toMatchObject({ title: { in: expect.any(Array) } });
  });

  it('teacher role with an admin role falls back to full scope', async () => {
    const tx = posTx(['TEACHER', 'ADMIN']);
    await harness(tx).listPositions(TENANT, 'caller-3');
    expect((posTx as any).lastWhere.title).toBeUndefined();
  });
});

describe('staff options + assign salary', () => {
  function optionsTx(callerSlugs: string[]) {
    return txBase({
      tenantMembership: {
        findFirst: jest.fn(async () => ({ roles: callerSlugs.map((slug) => ({ role: { slug } })) })),
        findMany: jest.fn(async () => [
          { user: { id: 'u1', firstName: 'Hassan', lastName: null, staffNumber: '26ACC0001' }, roles: [{ role: { slug: 'ACCOUNTANT' } }] },
          { user: { id: 'admin', firstName: 'Root', lastName: null, staffNumber: 'A1' }, roles: [{ role: { slug: 'SUPER_ADMIN' } }] },
        ]),
      },
      teacher: {
        findMany: jest.fn(async () => [
          { userId: 'u2', employeeNumber: 'T-1', status: 'ACTIVE', user: { id: 'u2', firstName: 'Amina', lastName: null, staffNumber: '26TCH0001' } },
        ]),
        findFirst: jest.fn(async () => null),
      },
    });
  }

  it('academic callers see only teachers (no admin staff list)', async () => {
    const out: any = await harness(optionsTx(['ACADEMIC_AFFAIRS'])).listPayrollStaffOptions(TENANT, 'caller');
    expect(out.academic.map((s: any) => s.userId)).toEqual(['u2']);
    expect(out.admin).toEqual([]);
  });

  it('accountants see teachers plus admin staff minus the ADMIN self', async () => {
    const out: any = await harness(optionsTx(['ACCOUNTANT'])).listPayrollStaffOptions(TENANT, 'caller');
    expect(out.academic.map((s: any) => s.userId)).toEqual(['u2']);
    expect(out.admin.map((s: any) => s.userId)).toEqual(['u1']);
  });

  it('assigns a teacher to the Teacher position with the salary', async () => {
    const tx = txBase({
      tenantMembership: { findFirst: jest.fn(async () => null) },
      teacher: { findFirst: jest.fn(async () => ({ id: 't1', userId: 'u2' })) },
      position: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({ id: 'p-teach', ...args.data })),
        update: jest.fn(),
      },
      staffPositionAssignment: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({ id: 'a1', ...args.data })),
      },
      tenant: { findUnique: jest.fn(async () => ({ currencyCode: 'SDG' })) },
    });
    const out: any = await harness(tx).assignStaffSalary(TENANT, { userId: 'u2', amount: 5000 });
    expect(out.positionTitle).toBe('Teacher');
    expect(out.baseSalary).toBe(5000);
    expect(tx.position.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Teacher', baseSalary: 5000 }) }),
    );
  });

  it('400s a negative salary', async () => {
    await expect(harness(txBase()).assignStaffSalary(TENANT, { userId: 'u1', amount: -1 })).rejects.toThrow();
  });
});

describe('upsertPositionSalary', () => {
  function upsertTx(existing: any) {
    return txBase({
      position: {
        findFirst: jest.fn(async () => existing),
        update: jest.fn(async (args: any) => ({ id: 'p1', title: 'Teacher', baseSalary: args.data.baseSalary })),
        create: jest.fn(async (args: any) => ({ id: 'p2', ...args.data })),
      },
      tenant: { findUnique: jest.fn(async () => ({ currencyCode: 'SDG' })) },
    });
  }

  it('updates the existing row case-insensitively (TEACHER -> Teacher)', async () => {
    const tx = upsertTx({ id: 'p1', title: 'Teacher', baseSalary: 0 });
    const out: any = await harness(tx).upsertPositionSalary(TENANT, { positionKey: 'TEACHER', baseSalary: 600 });
    expect(out).toMatchObject({ id: 'p1', title: 'Teacher', baseSalary: 600 });
    expect(tx.position.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { baseSalary: 600 } }),
    );
  });

  it('creates the row when the key is new', async () => {
    const tx = upsertTx(null);
    const out: any = await harness(tx).upsertPositionSalary(TENANT, { positionKey: 'Janitor', baseSalary: 600 });
    expect(tx.position.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Janitor', baseSalary: 600 }) }),
    );
    expect(out.baseSalary).toBe(600);
  });

  it('400s negative salaries, blank keys, and ADMIN keys', async () => {
    const svc = harness(txBase());
    await expect(svc.upsertPositionSalary(TENANT, { positionKey: 'Teacher', baseSalary: -1 })).rejects.toThrow();
    await expect(svc.upsertPositionSalary(TENANT, { positionKey: '  ', baseSalary: 100 })).rejects.toThrow();
    await expect(svc.upsertPositionSalary(TENANT, { positionKey: 'ADMIN', baseSalary: 100 })).rejects.toThrow();
  });
});

describe('register role fallback (no assignment)', () => {
  function fallbackTx() {
    const tx = txBase();
    (tx.tenantMembership.findMany as jest.Mock).mockResolvedValue([
      { user: { id: 'u2', firstName: 'Adil', lastName: 'Nour', staffNumber: '26TCH0002' }, roles: [{ role: { slug: 'TEACHER' } }] },
      { user: { id: 'u3', firstName: 'Hisham', lastName: 'Sharif', staffNumber: '26TCH0003' }, roles: [{ role: { slug: 'TEACHER' } }] },
    ]);
    (tx.teacher.findMany as jest.Mock).mockResolvedValue([
      { id: 't2', userId: 'u2', status: 'ACTIVE', user: { id: 'u2', firstName: 'Adil', lastName: 'Nour', staffNumber: '26TCH0002' } },
      { id: 't3', userId: 'u3', status: 'ACTIVE', user: { id: 'u3', firstName: 'Hisham', lastName: 'Sharif', staffNumber: '26TCH0003' } },
    ]);
    (tx.position.findMany as jest.Mock).mockResolvedValue([
      { title: 'Teacher', baseSalary: 1000000, currencyCode: 'SDG' },
    ]);
    return tx;
  }

  it('resolves assignment-less teachers to the Teacher base and marks them payable', async () => {
    const rows: any[] = await harness(fallbackTx()).listPayrollRegister(TENANT, new Date('2026-10-15T00:00:00Z'));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.baseSalary).toBe(1000000);
      expect(r.netPay).toBe(1000000);
      expect(r.payable).toBe(true);
      expect(r.hasAssignment).toBe(false);
      expect(r.positionTitle).toBe('Teacher');
    }
  });

  it('marks members with no matching position unpayable (base 0)', async () => {
    const tx = fallbackTx();
    (tx.position.findMany as jest.Mock).mockResolvedValue([]);
    const rows: any[] = await harness(tx).listPayrollRegister(TENANT, new Date('2026-10-15T00:00:00Z'));
    expect(rows[0].baseSalary).toBe(0);
    expect(rows[0].payable).toBe(false);
  });
});

describe('paySalary', () => {
  it('400s when the member was already paid in the current cycle', async () => {
    const tx = txBase();
    (tx.staffPositionAssignment.findFirst as jest.Mock).mockResolvedValue({
      id: 'a1', userId: 'u1', salaryOverride: null,
      position: { title: 'Teacher', baseSalary: 5000, currencyCode: 'SDG' },
    });
    (tx.salaryPayout.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', status: 'PAID' });
    await expect(
      harness(tx).paySalary(TENANT, USER, { userId: 'u1', method: 'CASH' }, new Date('2026-10-15T00:00:00Z')),
    ).rejects.toThrow(/already paid/i);
  });

  it('auto-links a teacher with no assignment and pays (Adil/Hisham case)', async () => {
    const payout = {
      id: 'p1', userId: 'u2', periodStart: new Date('2026-10-01'), periodEnd: new Date('2026-10-31'),
      grossAmount: 1000000, totalDeductions: 0, netAmount: 1000000, currencyCode: 'SDG',
      status: 'DRAFT', payslipNo: 'PS-00001', user: null, positionAssignment: null, deductions: [],
    };
    const tx = txBase({
      staffPositionAssignment: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({
          id: 'a-new', ...args.data,
          position: { id: 'p-teach', title: 'Teacher', baseSalary: 1000000, currencyCode: 'SDG' },
        })),
      },
      teacher: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => ({ id: 't1', userId: 'u2' })),
      },
      position: {
        findMany: jest.fn(async () => [{ id: 'p-teach', title: 'Teacher', baseSalary: 1000000, currencyCode: 'SDG' }]),
        findFirst: jest.fn(async () => null),
      },
      tenant: { findUnique: jest.fn(async () => ({ currencyCode: 'SDG' })) },
      salaryPayout: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async (): Promise<any> => null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(payout)
          .mockResolvedValueOnce({ ...payout, status: 'PAID' }),
        create: jest.fn(async () => payout),
        update: jest.fn(async () => ({})),
      },
      financialAccount: { findFirst: jest.fn(async () => ({ id: 'acc1' })) },
      financialTransaction: { create: jest.fn(async () => ({})) },
      financialAuditLog: { create: jest.fn(async () => ({})) },
    });
    const out: any = await harness(tx).paySalary(TENANT, USER, { userId: 'u2', method: 'CASH' }, new Date('2026-10-15T00:00:00Z'));
    expect(tx.staffPositionAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u2', positionId: 'p-teach' }) }),
    );
    expect(out.status).toBe('paid');
  });

  it('404s pay for an unknown person (no membership, no teacher record)', async () => {
    const tx = txBase({
      staffPositionAssignment: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      teacher: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
      tenantMembership: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    });
    await expect(
      harness(tx).paySalary(TENANT, USER, { userId: 'ghost', method: 'CASH' }, new Date('2026-10-15T00:00:00Z')),
    ).rejects.toThrow(/not found/i);
  });

  it('400s pay when the resolved position has no salary set', async () => {
    const tx = txBase({
      staffPositionAssignment: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        create: jest.fn(async (args: any) => ({
          id: 'a-new', ...args.data,
          position: { id: 'p-jan', title: 'Janitor', baseSalary: 0, currencyCode: 'SDG' },
        })),
      },
      teacher: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
      tenantMembership: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => ({ roles: [{ role: { slug: 'JANITOR' } }] })),
      },
      position: {
        findMany: jest.fn(async () => [{ id: 'p-jan', title: 'Janitor', baseSalary: 0, currencyCode: 'SDG' }]),
        findFirst: jest.fn(async () => null),
      },
      tenant: { findUnique: jest.fn(async () => ({ currencyCode: 'SDG' })) },
      salaryPayout: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    });
    await expect(
      harness(tx).paySalary(TENANT, USER, { userId: 'u9', method: 'CASH' }, new Date('2026-10-15T00:00:00Z')),
    ).rejects.toThrow(/no salary set/i);
  });
});

describe('shortage rates', () => {
  it('setShortageRates rejects negative rates', async () => {
    await expect(harness(txBase()).setShortageRates(TENANT, { absentDaily: -5 })).rejects.toThrow();
  });

  it('getShortageRates defaults to zero when no rows exist', async () => {
    await expect(harness(txBase()).getShortageRates(TENANT)).resolves.toEqual({ absentDaily: 0, lateRate: 0 });
  });
});


describe('listMyPayouts', () => {
  it('sums paid nets within the paid-at year and pending nets of DRAFT/APPROVED', async () => {
    const payouts = [
      { id: 'p1', user: {}, status: 'PAID', paidAt: new Date('2026-03-05T00:00:00Z'), netAmount: 1000, currencyCode: 'SDG', periodStart: new Date('2026-02-01'), periodEnd: new Date('2026-02-28'), createdAt: new Date('2026-02-20'), deductions: [] },
      { id: 'p2', user: {}, status: 'PAID', paidAt: new Date('2025-12-30T00:00:00Z'), netAmount: 900, currencyCode: 'SDG', periodStart: new Date('2025-12-01'), periodEnd: new Date('2025-12-31'), createdAt: new Date('2025-12-20'), deductions: [] },
      { id: 'p3', user: {}, status: 'APPROVED', paidAt: null, netAmount: 700, currencyCode: 'SDG', periodStart: new Date('2026-09-01'), periodEnd: new Date('2026-09-30'), createdAt: new Date('2026-09-20'), deductions: [] },
      { id: 'p4', user: {}, status: 'CANCELLED', paidAt: null, netAmount: 500, currencyCode: 'SDG', periodStart: new Date('2026-08-01'), periodEnd: new Date('2026-08-31'), createdAt: new Date('2026-08-20'), deductions: [] },
    ];
    const tx = {
      salaryPayout: {
        findMany: jest.fn(async () => payouts),
      },
    };
    const out: any = await harness(tx).listMyPayouts(TENANT, 'u-me', new Date('2026-10-15T00:00:00Z'));
    expect(out.payouts).toHaveLength(4);
    expect(out.ytd.paidTotal).toBe(1000);
    expect(out.ytd.pendingTotal).toBe(700);
    expect(out.ytd.currencyCode).toBe('SDG');
    expect(out.ytd.year).toBe(2026);
  });

  it('queries only the callers own payouts', async () => {
    const tx = { salaryPayout: { findMany: jest.fn(async () => []) } };
    await harness(tx).listMyPayouts(TENANT, 'u-me');
    expect(tx.salaryPayout.findMany.mock.calls[0][0].where).toEqual({ tenantId: TENANT, userId: 'u-me' });
  });
});
