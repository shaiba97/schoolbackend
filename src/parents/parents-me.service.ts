import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsMeService } from '../students/students-me.service';
import { FinancePortalService } from '../finance/finance-portal.service';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Guardian self-service for the guardian portal (built separately): every
 * method derives the guardian from the authenticated user and verifies the
 * ward link before reading anything, so a guardian only ever sees their own
 * wards. Only PUBLISHED results are visible — the gate lives in
 * `StudentsMeService.resultsForStudent`, shared with the student self view.
 */
@Injectable()
export class ParentsMeService {
  constructor(
    private prisma: PrismaService,
    private studentsMe: StudentsMeService,
    private jwt: JwtService,
    private financePortal: FinancePortalService,
  ) {}

  private async resolveGuardian(
    db: Db,
    tenantId: string,
    userId: string,
  ) {
    const guardian = await db.guardian.findFirst({
      where: { tenantId, userId },
      select: { id: true, userId: true },
    });
    if (!guardian) {
      throw new ForbiddenException('No guardian profile exists for this account in this school');
    }
    return guardian;
  }

  private async requireWard(
    db: Db,
    tenantId: string,
    guardianId: string,
    studentId: string,
  ) {
    const link = await db.studentGuardian.findFirst({
      where: { tenantId, guardianId, studentId },
      select: { studentId: true },
    });
    if (!link) throw new ForbiddenException('This student is not one of your wards');
    const student = await db.student.findFirst({
      where: { id: studentId, tenantId },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  async listChildren(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const guardian = await this.resolveGuardian(db, tenantId, userId);
      return this.childrenOf(db, tenantId, guardian.id);
    });
  }

  /**
   * Guardian's own profile with per-child relationships (relationship lives
   * on the link, so different children can carry different labels).
   */
  async getProfile(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const record = await db.guardian.findFirst({
        where: { tenantId, userId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          guardianNumber: true,
        },
      });
      if (!record) {
        throw new ForbiddenException('No guardian profile exists for this account in this school');
      }
      const links = await db.studentGuardian.findMany({
        where: { tenantId, guardianId: record.id },
        select: {
          relationship: true,
          isPrimary: true,
          student: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      return {
        id: record.id,
        firstName: record.firstName,
        lastName: record.lastName,
        phone: record.phone,
        email: record.email,
        guardianNumber: record.guardianNumber,
        relationships: links.map((link) => ({
          studentId: link.student.id,
          studentName: [link.student.firstName, link.student.lastName]
            .filter(Boolean)
            .join(' '),
          relationship: link.relationship,
          isPrimary: link.isPrimary,
        })),
      };
    });
  }

  private async childrenOf(db: Db, tenantId: string, guardianId: string) {
    const links = await db.studentGuardian.findMany({
      where: { tenantId, guardianId },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            roleNumber: true,
            enrollments: {
              where: { status: 'ACTIVE' },
              select: {
                schoolClass: { select: { id: true, className: true } },
              },
              take: 1,
            },
          },
        },
      },
    });
    return {
      children: links.map((link) => ({
        id: link.student.id,
        fullName: [link.student.firstName, link.student.lastName].filter(Boolean).join(' '),
        roleNumber: link.student.roleNumber,
        className: link.student.enrollments[0]?.schoolClass.className ?? null,
      })),
    };
  }

  async getWardResults(tenantId: string, userId: string, studentId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const guardian = await this.resolveGuardian(db, tenantId, userId);
      const student = await this.requireWard(db, tenantId, guardian.id, studentId);
      return this.studentsMe.resultsForStudent(db, tenantId, student.id);
    });
  }

  async getWardAttendance(tenantId: string, userId: string, studentId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const guardian = await this.resolveGuardian(db, tenantId, userId);
      const student = await this.requireWard(db, tenantId, guardian.id, studentId);
      return this.studentsMe.attendanceForStudent(db, tenantId, student.id);
    });
  }

  async getWardTimetable(tenantId: string, userId: string, studentId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const guardian = await this.resolveGuardian(db, tenantId, userId);
      const student = await this.requireWard(db, tenantId, guardian.id, studentId);
      return this.studentsMe.timetableForStudent(db, tenantId, student.id);
    });
  }

  async getWardCases(tenantId: string, userId: string, studentId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const guardian = await this.resolveGuardian(db, tenantId, userId);
      const student = await this.requireWard(db, tenantId, guardian.id, studentId);
      return this.studentsMe.casesForStudent(db, tenantId, student.id);
    });
  }

  async getWardTrend(
    tenantId: string,
    userId: string,
    studentId: string,
    query: { metric: 'results' | 'attendance'; window: 'week' | 'month' | '3m' | '6m' | '1y' },
  ) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const guardian = await this.resolveGuardian(db, tenantId, userId);
      const student = await this.requireWard(db, tenantId, guardian.id, studentId);
      return this.studentsMe.trendForStudent(db, tenantId, student.id, query);
    });
  }

  // GET /parents/me/children/:childId/finance — the ward's fee ledger. Same
  // ward-link verification as every other ward route: childId is checked
  // against studentGuardian before FinancePortalService is consulted, so a
  // guardian can only ever pull ledgers of their own children.
  async getWardFinance(tenantId: string, userId: string, studentId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const guardian = await this.resolveGuardian(db, tenantId, userId);
      const student = await this.requireWard(db, tenantId, guardian.id, studentId);
      return this.financePortal.getStudentLedger(tenantId, student.id);
    });
  }

  /**
   * Short-lived socket ticket, mirroring the student portal: the guardian
   * session JWT lives in an httpOnly cookie, so the portal exchanges it for
   * a 10-minute socket-audience ticket the gateway verifies.
   */
  async mintSocketTicket(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      await this.resolveGuardian(db, tenantId, userId);
      const ticket = await this.jwt.signAsync(
        { sub: userId, tenantId },
        { expiresIn: '600s', audience: 'socket' },
      );
      return { ticket, expiresIn: 600 };
    });
  }
}
