import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StaffAttendanceService } from '../staff-attendance/staff-attendance.service';
import { AttendanceService } from '../attendance/attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReceptionistService } from './receptionist.service';

describe('ReceptionistService', () => {
  let service: ReceptionistService;
  let realtimeGateway: jest.Mocked<RealtimeGateway>;
  let staffAttendanceService: jest.Mocked<StaffAttendanceService>;
  let attendanceService: jest.Mocked<AttendanceService>;
  let prisma: jest.Mocked<PrismaService>;
  let jwtService: jest.Mocked<JwtService>;

  const mockRealtimeGateway = {
    emitDomainEvent: jest.fn().mockResolvedValue(undefined),
    roomsForTarget: jest.fn(),
  };

  const mockStaffAttendanceService = {
    upsertMemberEntries: jest.fn(),
    listMembers: jest.fn(),
    upsertEntries: jest.fn(),
    listForAdmin: jest.fn(),
  };

  const mockAttendanceService = {
    createSession: jest.fn(),
    findByClassAndDate: jest.fn(),
    markBulk: jest.fn(),
  };

  const mockPrisma = {
    withTenantRead: jest.fn(),
    withTenant: jest.fn(),
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    teacher: {
      findMany: jest.fn(),
    },
    tenantMembership: {
      findFirst: jest.fn(),
    },
    staffMemberAttendance: {
      findMany: jest.fn(),
    },
    staffAttendance: {
      findMany: jest.fn(),
    },
    student: {
      findMany: jest.fn(),
    },
    studentEnrollment: {
      findFirst: jest.fn(),
    },
    attendanceSession: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    attendanceRecord: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    academicYear: {
      findFirst: jest.fn(),
    },
  };

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('mock-ticket'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceptionistService,
        { provide: RealtimeGateway, useValue: mockRealtimeGateway },
        {
          provide: StaffAttendanceService,
          useValue: mockStaffAttendanceService,
        },
        { provide: AttendanceService, useValue: mockAttendanceService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<ReceptionistService>(ReceptionistService);
    realtimeGateway = module.get(RealtimeGateway);
    staffAttendanceService = module.get(StaffAttendanceService);
    attendanceService = module.get(AttendanceService);
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);

    jest.clearAllMocks();
  });

  describe('mapStatusForEntity', () => {
    it('maps PERMITTED to EXCUSED for students', async () => {
      const result = service['mapStatusForEntity']('student', 'PERMITTED');
      expect(result).toBe('EXCUSED');
    });

    it('passes through PRESENT for students', async () => {
      const result = service['mapStatusForEntity']('student', 'PRESENT');
      expect(result).toBe('PRESENT');
    });

    it('passes through LATE for students', async () => {
      const result = service['mapStatusForEntity']('student', 'LATE');
      expect(result).toBe('LATE');
    });

    it('passes through ABSENT for students', async () => {
      const result = service['mapStatusForEntity']('student', 'ABSENT');
      expect(result).toBe('ABSENT');
    });

    it('passes through PRESENT for staff', async () => {
      const result = service['mapStatusForEntity']('staff', 'PRESENT');
      expect(result).toBe('PRESENT');
    });

    it('passes through LATE for staff', async () => {
      const result = service['mapStatusForEntity']('staff', 'LATE');
      expect(result).toBe('LATE');
    });

    it('passes through ABSENT for staff', async () => {
      const result = service['mapStatusForEntity']('staff', 'ABSENT');
      expect(result).toBe('ABSENT');
    });

    it('maps PERMITTED to PERMITTED for staff (new enum value)', async () => {
      const result = service['mapStatusForEntity']('staff', 'PERMITTED');
      expect(result).toBe('PERMITTED');
    });

    it('passes through PRESENT for teacher', async () => {
      const result = service['mapStatusForEntity']('teacher', 'PRESENT');
      expect(result).toBe('PRESENT');
    });

    it('passes through LATE for teacher', async () => {
      const result = service['mapStatusForEntity']('teacher', 'LATE');
      expect(result).toBe('LATE');
    });

    it('passes through ABSENT for teacher', async () => {
      const result = service['mapStatusForEntity']('teacher', 'ABSENT');
      expect(result).toBe('ABSENT');
    });

    it('maps PERMITTED to PERMITTED for teacher (new enum value)', async () => {
      const result = service['mapStatusForEntity']('teacher', 'PERMITTED');
      expect(result).toBe('PERMITTED');
    });
  });

  describe('markAttendance', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const markedById = '4b116007-6ab6-4445-a01f-a93364951670';
    const date = '2026-10-18';

    beforeEach(() => {
      mockPrisma.withTenant.mockImplementation(async (t, fn) => fn(mockPrisma));
      mockPrisma.withTenantRead.mockImplementation(async (t, fn) =>
        fn(mockPrisma),
      );
    });

    it('dispatches to staffAttendanceService.upsertMemberEntries for staff', async () => {
      const dto = {
        entityType: 'staff' as const,
        entityId: 'user-1',
        status: 'PRESENT',
        date,
      };
      mockStaffAttendanceService.upsertMemberEntries.mockResolvedValue([{}]);

      await service.markAttendance(tenantId, markedById, dto);

      expect(staffAttendanceService.upsertMemberEntries).toHaveBeenCalledWith(
        tenantId,
        markedById,
        expect.objectContaining({
          date,
          entries: expect.arrayContaining([
            expect.objectContaining({ userId: 'user-1', status: 'PRESENT' }),
          ]),
        }),
      );
      expect(realtimeGateway.emitDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'attendance_updated',
          rooms: ['school-wide'],
        }),
      );
    });

    it('dispatches to staffAttendanceService.upsertEntries for teacher', async () => {
      const dto = {
        entityType: 'teacher' as const,
        entityId: 'teacher-1',
        status: 'PRESENT',
        date,
      };
      mockStaffAttendanceService.upsertEntries.mockResolvedValue([{}]);

      await service.markAttendance(tenantId, markedById, dto);

      expect(staffAttendanceService.upsertEntries).toHaveBeenCalledWith(
        tenantId,
        markedById,
        expect.objectContaining({
          date,
          entries: expect.arrayContaining([
            expect.objectContaining({
              teacherId: 'teacher-1',
              status: 'PRESENT',
            }),
          ]),
        }),
      );
      expect(realtimeGateway.emitDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'attendance_updated',
          rooms: ['school-wide'],
        }),
      );
    });

    it('dispatches to attendance service for student with PERMITTED→EXCUSED mapping', async () => {
      const dto = {
        entityType: 'student' as const,
        entityId: 'student-1',
        status: 'PERMITTED',
        date,
      };
      mockPrisma.studentEnrollment.findFirst.mockResolvedValue({
        classId: 'class-1',
      });
      mockPrisma.attendanceSession.findFirst.mockResolvedValue({
        id: 'session-1',
        classId: 'class-1',
        tenantId,
        attendanceDate: new Date(date),
      });
      mockPrisma.attendanceRecord.upsert.mockResolvedValue({});

      await service.markAttendance(tenantId, markedById, dto);

      expect(mockPrisma.attendanceRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            attendanceSessionId_studentId: expect.objectContaining({
              attendanceSessionId: 'session-1',
              studentId: 'student-1',
            }),
          }),
          create: expect.objectContaining({ status: 'EXCUSED' }),
          update: expect.objectContaining({ status: 'EXCUSED' }),
        }),
      );
      expect(realtimeGateway.emitDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'attendance_updated',
          rooms: ['school-wide'],
        }),
      );
    });

    it('dispatches to attendance service for student with PRESENT status', async () => {
      const dto = {
        entityType: 'student' as const,
        entityId: 'student-1',
        status: 'PRESENT',
        date,
      };
      mockPrisma.studentEnrollment.findFirst.mockResolvedValue({
        classId: 'class-1',
      });
      mockPrisma.attendanceSession.findFirst.mockResolvedValue({
        id: 'session-1',
        classId: 'class-1',
        tenantId,
        attendanceDate: new Date(date),
      });
      mockPrisma.attendanceRecord.upsert.mockResolvedValue({});

      await service.markAttendance(tenantId, markedById, dto);

      expect(mockPrisma.attendanceRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: 'PRESENT' }),
          update: expect.objectContaining({ status: 'PRESENT' }),
        }),
      );
    });

    it('throws BadRequestException for invalid entityType', async () => {
      const dto = {
        entityType: 'invalid' as any,
        entityId: 'user-1',
        status: 'PRESENT',
        date,
      };
      await expect(
        service.markAttendance(tenantId, markedById, dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAttendanceList', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const date = '2026-10-18';

    beforeEach(() => {
      mockPrisma.withTenantRead.mockImplementation(async (t, fn) =>
        fn(mockPrisma),
      );
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.teacher.findMany.mockResolvedValue([]);
      mockPrisma.staffMemberAttendance.findMany.mockResolvedValue([]);
      mockPrisma.staffAttendance.findMany.mockResolvedValue([]);
      mockPrisma.attendanceSession.findMany.mockResolvedValue([]);
      mockPrisma.attendanceRecord.findMany.mockResolvedValue([]);
      mockPrisma.student.findMany.mockResolvedValue([]);
      mockPrisma.academicYear.findFirst.mockResolvedValue({ id: 'year-1' });
    });

    it('returns staff rows with status from staffMemberAttendance', async () => {
      mockPrisma.staffMemberAttendance.findMany.mockResolvedValue([
        { userId: 'user-1', status: 'PRESENT' },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          firstName: 'John',
          lastName: 'Doe',
          staffNumber: 'STF001',
          phone: '+1234567890',
          memberships: [
            {
              roles: [
                { role: { slug: 'CUSTOM_ABC123', name: 'Security Guard' } },
              ],
            },
          ],
        },
        {
          id: 'user-2',
          firstName: 'Jane',
          lastName: 'Smith',
          staffNumber: 'STF002',
          phone: '+0987654321',
          memberships: [
            {
              roles: [
                { role: { slug: 'CUSTOM_XYZ789', name: 'Janitor' } },
              ],
            },
          ],
        },
        {
          id: 'user-3',
          firstName: 'Amin',
          lastName: 'Khamis',
          staffNumber: '26REC0001',
          phone: '+249966371266',
          memberships: [
            {
              roles: [
                { role: { slug: 'RECEPTIONIST', name: 'Receptionist' } },
              ],
            },
          ],
        },
        {
          id: 'user-4',
          firstName: 'Raw',
          lastName: 'Slug',
          staffNumber: 'STF004',
          phone: '+249966379999',
          memberships: [
            {
              roles: [
                { role: { slug: 'ACCOUNTANT', name: 'ACCOUNTANT' } },
              ],
            },
          ],
        },
      ]);

      const result = await service.getAttendanceList(tenantId, 'staff', date);

      expect(result.rows).toHaveLength(4);
      expect(result.rows[0]).toMatchObject({
        entityId: 'user-1',
        fullName: 'John Doe',
        idLabel: 'STF001',
        contextLabel: 'Security Guard',
        status: 'PRESENT',
      });
      expect(result.rows[1]).toMatchObject({
        contextLabel: 'Janitor',
        status: null,
      });
      expect(result.rows[2]).toMatchObject({
        entityId: 'user-3',
        contextLabel: 'Receptionist',
      });
      expect(result.rows[3].contextLabel).toBe(
        'Financial Affairs (Accountant)',
      );
    });

    it('joins stored name parts verbatim — no null text, no structural assumptions', async () => {
      mockPrisma.staffMemberAttendance.findMany.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'user-multi',
          firstName: 'Mohamed Ahmed Osman',
          staffNumber: 'STF010',
          phone: '+249966370000',
          memberships: [
            {
              roles: [
                { role: { slug: 'CUSTOM_ONEPART', name: 'Janitor' } },
              ],
            },
          ],
        },
      ]);

      const result = await service.getAttendanceList(tenantId, 'staff', date);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].fullName).toBe('Mohamed Ahmed Osman');
    });

    it('returns teacher rows with status from staffAttendance', async () => {
      mockPrisma.staffAttendance.findMany.mockResolvedValue([
        { teacherId: 'teacher-1', status: 'PRESENT' },
      ]);
      mockPrisma.teacher.findMany.mockResolvedValue([
        {
          id: 'teacher-1',
          employeeNumber: 'EMP001',
          user: { firstName: 'Jane', lastName: 'Teacher' },
          specialization: 'Math',
          department: { name: 'mathematics' },
        },
        {
          id: 'teacher-2',
          employeeNumber: 'EMP002',
          user: { firstName: 'Bob', lastName: 'Teacher' },
          specialization: null,
          department: { name: 'Arabic Language' },
        },
        {
          id: 'teacher-3',
          employeeNumber: 'EMP003',
          user: { firstName: 'Provisioned', lastName: 'Teacher' },
          specialization: null,
          department: null,
        },
      ]);

      const result = await service.getAttendanceList(tenantId, 'teacher', date);

      expect(result.rows).toHaveLength(3);
      expect(result.rows[0]).toMatchObject({
        entityId: 'teacher-1',
        fullName: 'Jane Teacher',
        idLabel: 'EMP001',
        contextLabel: 'Math',
        status: 'PRESENT',
      });
      expect(result.rows[1].contextLabel).toBe('Arabic Language');
      expect(result.rows[2].contextLabel).toBe('—');
    });

    it('returns student rows with status from attendanceRecord', async () => {
      const mockSession = {
        id: 'session-1',
        classId: 'class-1',
        attendanceDate: new Date(date),
      };
      mockPrisma.attendanceSession.findMany.mockResolvedValue([mockSession]);
      mockPrisma.attendanceRecord.findMany.mockResolvedValue([
        {
          attendanceSessionId: 'session-1',
          studentId: 'student-1',
          status: 'PRESENT',
        },
        {
          attendanceSessionId: 'session-1',
          studentId: 'student-2',
          status: 'EXCUSED',
        },
      ]);
      mockPrisma.student.findMany.mockResolvedValue([
        {
          id: 'student-1',
          firstName: 'Alice',
          middleName: 'Marie',
          lastName: 'Student',
          roleNumber: 'STU001',
          enrollments: [
            {
              schoolClass: { className: 'Grade 8 - Section B', id: 'class-1' },
            },
          ],
        },
        {
          id: 'student-2',
          firstName: 'Bob',
          lastName: 'Student',
          roleNumber: 'STU002',
          enrollments: [
            {
              schoolClass: { className: 'Grade 8 - Section B', id: 'class-1' },
            },
          ],
        },
        {
          id: 'student-3',
          firstName: 'Charlie',
          lastName: 'Student',
          roleNumber: 'STU003',
          enrollments: [
            {
              schoolClass: { className: 'Grade 9 - Section A', id: 'class-2' },
            },
          ],
        },
      ]);

      const result = await service.getAttendanceList(tenantId, 'student', date);

      expect(result.rows).toHaveLength(3);
      expect(result.rows[0]).toMatchObject({
        entityId: 'student-1',
        fullName: 'Alice Marie Student',
        idLabel: 'STU001',
        status: 'PRESENT',
      });
      expect(result.rows[1]).toMatchObject({
        entityId: 'student-2',
        fullName: 'Bob Student',
        idLabel: 'STU002',
        status: 'EXCUSED',
      });
      expect(result.rows[2].status).toBeNull();
    });
  });
});
