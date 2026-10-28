import { ForbiddenException } from '@nestjs/common';
import { ParentsMeService } from './parents-me.service';

type ParentsMockDb = {
  guardian: { findFirst: jest.Mock };
  studentGuardian: { findMany: jest.Mock; findFirst: jest.Mock };
  student: { findFirst: jest.Mock };
};

type StudentsMeMock = {
  resultsForStudent: jest.Mock;
  attendanceForStudent: jest.Mock;
  timetableForStudent: jest.Mock;
  casesForStudent: jest.Mock;
  trendForStudent: jest.Mock;
};

const TENANT = 'tenant-1';
const GUARDIAN_USER = 'guardian-user';
const GUARDIAN_ID = 'guardian-1';
const WARD_ID = 'student-1';

function setup(store: ParentsMockDb) {
  const prisma = {
    withTenantRead: jest.fn((_tenantId: string, fn: (db: any) => unknown) => fn(store)),
    withTenant: jest.fn((_tenantId: string, fn: (db: any) => unknown) => fn(store)),
  };
  const studentsMe: StudentsMeMock = {
    resultsForStudent: jest.fn(),
    attendanceForStudent: jest.fn(),
    timetableForStudent: jest.fn(),
    casesForStudent: jest.fn(),
    trendForStudent: jest.fn(),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('ticket-abc') };
  const financePortal: any = {
    getStudentLedger: jest.fn(async (_t: string, studentId: string) => ({ ledger: studentId })),
  };
  const service = new ParentsMeService(
    prisma as never,
    studentsMe as never,
    jwt as never,
    financePortal as never,
  );
  return { service, studentsMe, jwt, financePortal };
}

function guardianStore(overrides: Partial<ParentsMockDb> = {}): ParentsMockDb {
  return {
    guardian: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: GUARDIAN_ID, userId: GUARDIAN_USER }),
    },
    studentGuardian: { findMany: jest.fn(), findFirst: jest.fn() },
    student: { findFirst: jest.fn() },
    ...overrides,
  };
}

describe('ParentsMeService ward scoping', () => {
  it("lists only the caller's own wards", async () => {
    const store = guardianStore();
    store.studentGuardian.findMany.mockResolvedValue([
      {
        student: {
          id: WARD_ID,
          firstName: 'Alaa',
          lastName: 'Din',
              roleNumber: '26CS1R01',
              enrollments: [{ schoolClass: { className: 'CS 1' } }],
        },
      },
    ]);
    const { service } = setup(store);

    const result = await service.listChildren(TENANT, GUARDIAN_USER);

    expect(result).toEqual({
      children: [{ id: WARD_ID, fullName: 'Alaa Din', roleNumber: '26CS1R01', className: 'CS 1' }],
    });
  });

  it('403s an account with no guardian profile', async () => {
    const store = guardianStore();
    store.guardian.findFirst.mockResolvedValue(null);
    const { service } = setup(store);

    await expect(service.listChildren(TENANT, 'stranger')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("reads published results for the caller's own ward", async () => {
    const store = guardianStore();
    store.studentGuardian.findFirst.mockResolvedValue({ studentId: WARD_ID });
    store.student.findFirst.mockResolvedValue({ id: WARD_ID });
    const { service, studentsMe } = setup(store);
    const rows = { results: [{ id: 'r-1' }], averagePercentage: 90, count: 1 };
    studentsMe.resultsForStudent.mockResolvedValue(rows);

    const result = await service.getWardResults(TENANT, GUARDIAN_USER, WARD_ID);

    expect(result).toEqual(rows);
    expect(studentsMe.resultsForStudent).toHaveBeenCalledWith(expect.anything(), TENANT, WARD_ID);
  });

  it("403s results for another family's child", async () => {
    const store = guardianStore();
    store.studentGuardian.findFirst.mockResolvedValue(null);
    const { service, studentsMe } = setup(store);

    await expect(
      service.getWardResults(TENANT, GUARDIAN_USER, 'other-child'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(studentsMe.resultsForStudent).not.toHaveBeenCalled();
  });

  describe.each([
    ['attendance', 'getWardAttendance', 'attendanceForStudent'],
    ['timetable', 'getWardTimetable', 'timetableForStudent'],
    ['cases', 'getWardCases', 'casesForStudent'],
  ])('ward %s', (_label, serviceMethod, studentsMeMethod) => {
    const wardCalls = {
      getWardAttendance: (
        service: ParentsMeService,
        wardId: string,
      ) => service.getWardAttendance(TENANT, GUARDIAN_USER, wardId),
      getWardTimetable: (
        service: ParentsMeService,
        wardId: string,
      ) => service.getWardTimetable(TENANT, GUARDIAN_USER, wardId),
      getWardCases: (
        service: ParentsMeService,
        wardId: string,
      ) => service.getWardCases(TENANT, GUARDIAN_USER, wardId),
    } as const;
    const studentsMeMocks = {
      attendanceForStudent: (studentsMe: StudentsMeMock) => studentsMe.attendanceForStudent,
      timetableForStudent: (studentsMe: StudentsMeMock) => studentsMe.timetableForStudent,
      casesForStudent: (studentsMe: StudentsMeMock) => studentsMe.casesForStudent,
    } as const;

    it("delegates for the caller's own ward", async () => {
      const store = guardianStore();
      store.studentGuardian.findFirst.mockResolvedValue({ studentId: WARD_ID });
      store.student.findFirst.mockResolvedValue({ id: WARD_ID });
      const { service, studentsMe } = setup(store);
      const payload = { ok: true };
      studentsMeMocks[studentsMeMethod as keyof typeof studentsMeMocks](studentsMe).mockResolvedValue(
        payload,
      );

      const result = await wardCalls[serviceMethod as keyof typeof wardCalls](service, WARD_ID);

      expect(result).toEqual(payload);
      expect(
        studentsMeMocks[studentsMeMethod as keyof typeof studentsMeMocks](studentsMe),
      ).toHaveBeenCalledWith(expect.anything(), TENANT, WARD_ID);
    });

    it("403s another family's child without touching student data", async () => {
      const store = guardianStore();
      store.studentGuardian.findFirst.mockResolvedValue(null);
      const { service, studentsMe } = setup(store);

      await expect(
        wardCalls[serviceMethod as keyof typeof wardCalls](service, 'other-child'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        studentsMeMocks[studentsMeMethod as keyof typeof studentsMeMocks](studentsMe),
      ).not.toHaveBeenCalled();
    });
  });

  describe('ward trend', () => {
    const query = { metric: 'results', window: 'month' } as const;

    it("delegates for the caller's own ward", async () => {
      const store = guardianStore();
      store.studentGuardian.findFirst.mockResolvedValue({ studentId: WARD_ID });
      store.student.findFirst.mockResolvedValue({ id: WARD_ID });
      const { service, studentsMe } = setup(store);
      const payload = { delta: null };
      studentsMe.trendForStudent.mockResolvedValue(payload);

      const result = await service.getWardTrend(TENANT, GUARDIAN_USER, WARD_ID, {
        metric: query.metric,
        window: query.window,
      });

      expect(result).toEqual(payload);
      expect(studentsMe.trendForStudent).toHaveBeenCalledWith(expect.anything(), TENANT, WARD_ID, {
        metric: 'results',
        window: 'month',
      });
    });

    it("403s another family's child without touching student data", async () => {
      const store = guardianStore();
      store.studentGuardian.findFirst.mockResolvedValue(null);
      const { service, studentsMe } = setup(store);

      await expect(
        service.getWardTrend(TENANT, GUARDIAN_USER, 'other-child', {
          metric: 'results',
          window: 'month',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(studentsMe.trendForStudent).not.toHaveBeenCalled();
    });
  });

  describe('ward finance', () => {
    function wardOk() {
      const store = guardianStore();
      store.studentGuardian.findFirst.mockResolvedValue({ studentId: WARD_ID });
      store.student.findFirst.mockResolvedValue({ id: WARD_ID });
      return store;
    }

    it("returns the ledger of the caller's own ward via the finance portal", async () => {
      const { service, financePortal } = setup(wardOk());
      financePortal.getStudentLedger.mockResolvedValue({ totals: { balance: 42 } });

      const result = await service.getWardFinance(TENANT, GUARDIAN_USER, WARD_ID);

      expect(financePortal.getStudentLedger).toHaveBeenCalledWith(TENANT, WARD_ID);
      expect(result).toEqual({ totals: { balance: 42 } });
    });

    it("403s another family's child without touching the ledger", async () => {
      const store = guardianStore();
      store.studentGuardian.findFirst.mockResolvedValue(null);
      const { service, financePortal } = setup(store);

      await expect(
        service.getWardFinance(TENANT, GUARDIAN_USER, 'other-child'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(financePortal.getStudentLedger).not.toHaveBeenCalled();
    });
  });

  it('mints a socket ticket for a known guardian', async () => {
    const store = guardianStore();
    const { service, jwt } = setup(store);

    const result = await service.mintSocketTicket(TENANT, GUARDIAN_USER);

    expect(result).toEqual({ ticket: 'ticket-abc', expiresIn: 600 });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      { sub: GUARDIAN_USER, tenantId: TENANT },
      { expiresIn: '600s', audience: 'socket' },
    );
  });

  it('refuses a socket ticket with no guardian profile', async () => {
    const store = guardianStore();
    store.guardian.findFirst.mockResolvedValue(null);
    const { service, jwt } = setup(store);

    await expect(service.mintSocketTicket(TENANT, 'stranger')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  describe('guardian profile', () => {
    function profileStore() {
      const store = guardianStore();
      store.guardian.findFirst.mockResolvedValue({
        id: GUARDIAN_ID,
        firstName: 'Amna',
        lastName: 'Khalid',
        phone: '+249900000001',
        email: null,
        guardianNumber: '26CPG0001',
      });
      store.studentGuardian.findMany.mockResolvedValue([
        {
          relationship: 'Mother',
          isPrimary: true,
          student: { id: 's-1', firstName: 'Alaa', lastName: 'Din' },
        },
        {
          relationship: 'Aunt',
          isPrimary: false,
          student: { id: 's-2', firstName: 'Omer', lastName: null },
        },
      ]);
      return store;
    }

    it('returns guardian info with per-child relationships', async () => {
      const { service } = setup(profileStore());

      const result = await service.getProfile(TENANT, GUARDIAN_USER);

      expect(result).toMatchObject({
        id: GUARDIAN_ID,
        firstName: 'Amna',
        guardianNumber: '26CPG0001',
      });
      expect(result.relationships).toEqual([
        { studentId: 's-1', studentName: 'Alaa Din', relationship: 'Mother', isPrimary: true },
        { studentId: 's-2', studentName: 'Omer', relationship: 'Aunt', isPrimary: false },
      ]);
    });

    it('403s an account with no guardian profile', async () => {
      const store = profileStore();
      store.guardian.findFirst.mockResolvedValue(null);
      const { service } = setup(store);

      await expect(service.getProfile(TENANT, 'stranger')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
