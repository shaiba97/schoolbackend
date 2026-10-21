import { FinanceDiscountsService } from './finance.service';

const TENANT = 'tenant-1';

function fakePrisma(tx: any) {
  return {
    withTenant: async (_t: string, cb: any) => cb(tx),
    withTenantRead: async (_t: string, cb: any) => cb(tx),
  } as any;
}

// --- listEligibleDiscounts --------------------------------------------------

function eligibleTx(rows: any[]) {
  return {
    discountEligibility: { findMany: jest.fn(async () => rows) },
  };
}

const ROW = (over: any = {}) => ({
  id: 'e1',
  tenantId: TENANT,
  studentId: 'stu-1',
  sourceType: 'SIBLING',
  sourceRefId: 'sd-1',
  valueType: 'PERCENTAGE',
  value: 15,
  label: 'Sibling Discount (15%)',
  academicYearId: null,
  expiresAt: null,
  appliedAmount: 0,
  appliedAt: null,
  ...over,
});

describe('listEligibleDiscounts', () => {
  it('returns usable rows with preChecked flags (SIBLING/TOPPER on)', async () => {
    const tx: any = eligibleTx([
      ROW(),
      ROW({ id: 'e2', sourceType: 'FAMILY_CONDITION', label: 'Family condition', valueType: 'FIXED_AMOUNT', value: 100 }),
      ROW({ id: 'e3', sourceType: 'MANUAL', label: 'Staff child' }),
      ROW({ id: 'e4', sourceType: 'TOPPER', label: 'Topper of 5A' }),
    ]);
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    const res: any[] = await svc.listEligibleDiscounts(TENANT, 'stu-1', 'year-1');
    expect(res.map((r) => [r.id, r.preChecked])).toEqual([
      ['e1', true],
      ['e2', false],
      ['e3', false],
      ['e4', true],
    ]);
    expect(res[0].label).toBe('Sibling Discount (15%)');
  });

  it('keeps year-agnostic rows and drops other-year rows when a year is given', async () => {
    const tx: any = eligibleTx([
      ROW({ id: 'e1', academicYearId: null }),
      ROW({ id: 'e2', academicYearId: 'year-1' }),
      ROW({ id: 'e3', academicYearId: 'year-2' }),
    ]);
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    const res: any[] = await svc.listEligibleDiscounts(TENANT, 'stu-1', 'year-1');
    expect(res.map((r) => r.id)).toEqual(['e1', 'e2']);
  });

  it('drops expired and fully-consumed FIXED rows', async () => {
    const tx: any = eligibleTx([
      ROW({ id: 'e1' }),
      ROW({ id: 'e2', expiresAt: new Date('2020-01-01T00:00:00Z') }),
      ROW({ id: 'e3', valueType: 'FIXED_AMOUNT', value: 100, appliedAmount: 100 }),
      ROW({ id: 'e4', valueType: 'FIXED_AMOUNT', value: 100, appliedAmount: 40 }),
    ]);
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    const res: any[] = await svc.listEligibleDiscounts(TENANT, 'stu-1');
    expect(res.map((r) => r.id)).toEqual(['e1', 'e4']);
  });
});

// --- topper rules CRUD -------------------------------------------------------

function rulesTx(store: any[] = []) {
  return {
    store,
    topperDiscountRule: {
      findMany: jest.fn(async () => store),
      findFirst: jest.fn(async ({ where }: any) => store.find((r) => r.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `rule-${store.length + 1}`, isActive: true, ...data };
        store.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = store.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const ix = store.findIndex((r) => r.id === where.id);
        const [row] = store.splice(ix, 1);
        return row;
      }),
    },
  };
}

describe('topper rules CRUD', () => {
  it('creates a rule', async () => {
    const tx: any = rulesTx();
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    const row: any = await svc.createTopperRule(TENANT, { name: 'Topper 10%', valueType: 'PERCENTAGE', value: 10 });
    expect(row.name).toBe('Topper 10%');
    expect(tx.store).toHaveLength(1);
  });

  it('rejects bad valueType and negative value', async () => {
    const tx: any = rulesTx();
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await expect(
      svc.createTopperRule(TENANT, { name: 'x', valueType: 'BOGUS', value: 10 }),
    ).rejects.toThrow();
    await expect(
      svc.createTopperRule(TENANT, { name: 'x', valueType: 'PERCENTAGE', value: -1 }),
    ).rejects.toThrow();
    expect(tx.store).toHaveLength(0);
  });

  it('updates and deletes', async () => {
    const tx: any = rulesTx([{ id: 'rule-1', name: 'Old', valueType: 'PERCENTAGE', value: 10, isActive: true }]);
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await svc.updateTopperRule(TENANT, 'rule-1', { isActive: false });
    expect(tx.store[0].isActive).toBe(false);
    await svc.deleteTopperRule(TENANT, 'rule-1');
    expect(tx.store).toHaveLength(0);
  });
});

// --- computeTopperAwards -----------------------------------------------------

function computeTx() {
  const elig: any[] = [];
  return {
    elig,
    exam: {
      findFirst: jest.fn(async () => ({
        id: 'exam-1',
        name: 'Term 1 Final',
        academicYearId: 'year-1',
        publishedAt: new Date('2026-10-01T00:00:00Z'),
      })),
    },
    academicYear: {
      findUnique: jest.fn(async () => ({ id: 'year-1', endsOn: new Date('2027-06-30T00:00:00Z') })),
    },
    examSubject: {
      findMany: jest.fn(async () => [
        { id: 'es-1', classSubject: { classId: 'c1', schoolClass: { className: '5A' } } },
        { id: 'es-2', classSubject: { classId: 'c1', schoolClass: { className: '5A' } } },
        { id: 'es-3', classSubject: { classId: 'c2', schoolClass: { className: '5B' } } },
      ]),
    },
    examResult: {
      findMany: jest.fn(async () => [
        { studentId: 's1', examSubjectId: 'es-1', marks: 80 },
        { studentId: 's1', examSubjectId: 'es-2', marks: 70 },
        { studentId: 's2', examSubjectId: 'es-1', marks: 95 },
        { studentId: 's4', examSubjectId: 'es-3', marks: 61 },
        { studentId: 's5', examSubjectId: 'es-3', marks: 60 },
      ]),
    },
    studentEnrollment: {
      findMany: jest.fn(async () => [
        { studentId: 's1', classId: 'c1' },
        { studentId: 's2', classId: 'c1' },
        { studentId: 's4', classId: 'c2' },
        { studentId: 's5', classId: 'c2' },
      ]),
    },
    topperDiscountRule: {
      findMany: jest.fn(async () => [
        { id: 'rule-1', name: 'Topper 10%', valueType: 'PERCENTAGE', value: 10, isActive: true },
      ]),
    },
    schoolClass: { findMany: jest.fn(async () => []) },
    discountEligibility: {
      findFirst: jest.fn(async ({ where }: any) =>
        elig.find(
          (r) =>
            r.studentId === where.studentId &&
            r.sourceType === where.sourceType &&
            r.sourceRefId === where.sourceRefId &&
            r.academicYearId === where.academicYearId,
        ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `elig-${elig.length + 1}`, tenantId: TENANT, ...data };
        elig.push(row);
        return row;
      }),
    },
  };
}

describe('computeTopperAwards', () => {
  it('awards each class winner per active rule with year expiry', async () => {
    const tx: any = computeTx();
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    const res: any = await svc.computeTopperAwards(TENANT);
    expect(res.examId).toBe('exam-1');
    // s1 wins c1 (150), s4 wins c2 (61)
    expect(res.awarded).toBe(2);
    expect(res.skipped).toBe(0);
    const labels = tx.elig.map((r: any) => [r.studentId, r.label]);
    expect(labels).toEqual([
      ['s1', 'Topper of 5A — Term 1 Final'],
      ['s4', 'Topper of 5B — Term 1 Final'],
    ]);
    expect(tx.elig[0].academicYearId).toBe('year-1');
    expect(new Date(tx.elig[0].expiresAt).getFullYear()).toBe(2027);
  });

  it('is idempotent: a second run skips already-awarded rows', async () => {
    const tx: any = computeTx();
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await svc.computeTopperAwards(TENANT);
    const res: any = await svc.computeTopperAwards(TENANT);
    expect(res.awarded).toBe(0);
    expect(res.skipped).toBe(2);
  });

  it('throws when no published exam exists', async () => {
    const tx: any = computeTx();
    tx.exam.findFirst = jest.fn(async () => null);
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await expect(svc.computeTopperAwards(TENANT)).rejects.toThrow('No published exam');
  });
});
