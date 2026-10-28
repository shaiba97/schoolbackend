import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { renderPayslip } from './finance-payslip';
import { composeSiblingDiscount, SiblingRuleLike } from './sibling-discount.helper';
import { bridgeFamilyConditionApproval } from './discount-eligibility.bridge';

const num = (v: unknown): number => Number(v ?? 0);
const round2 = (v: number): number => Math.round(v * 100) / 100;
const lower = (v: unknown): string => String(v ?? '').toLowerCase();
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

// Never on payroll: students/guardians, nor the admin accounts themselves.
const STAFF_ROLE_BLOCK = ['STUDENT', 'GUARDIAN', 'ADMIN', 'SUPER_ADMIN', 'SYSTEM_ADMIN'];
// Payroll-scoped extension: parents are never a paid role, so they stay out
// of the register, the staff-options dropdown (both tabs), salary assignment
// and auto-linking. listEmployees keeps the narrower STAFF_ROLE_BLOCK.
const REGISTER_ROLE_BLOCK = [...STAFF_ROLE_BLOCK, 'PARENT'];

type DeductionValueType = 'PERCENTAGE' | 'FIXED_AMOUNT';

@Injectable()
export class FinancePayrollService {
  constructor(private prisma: PrismaService) {}

  private fullName(u: { firstName: string; lastName?: string | null }): string {
    return `${u.firstName} ${u.lastName ?? ''}`.trim();
  }

  private async audit(
    tx: any,
    tenantId: string,
    action: string,
    entityType: string,
    entityId: string,
    performedBy: string,
    before?: unknown,
    after?: unknown,
  ) {
    await tx.financialAuditLog.create({
      data: {
        tenantId,
        action,
        entityType,
        entityId,
        performedBy,
        ...(before !== undefined ? { before: before as any } : {}),
        ...(after !== undefined ? { after: after as any } : {}),
      },
    });
  }

  private dedAmount(gross: number, valueType: DeductionValueType, value: number): number {
    return valueType === 'PERCENTAGE' ? round2((gross * value) / 100) : round2(value);
  }

  private parseDay(value: unknown, field: string): Date {
    const day = value instanceof Date ? new Date(value.getTime()) : new Date(value as any);
    if (Number.isNaN(day.getTime())) {
      throw new BadRequestException(
        `${field} is not a valid date. Expected an ISO date such as 2026-01-31`,
      );
    }
    return day;
  }

  private parsePeriod(startValue: unknown, endValue: unknown): { start: Date; end: Date } {
    const start = this.parseDay(startValue, 'periodStart');
    const end = this.parseDay(endValue, 'periodEnd');
    if (start.getTime() > end.getTime()) {
      throw new BadRequestException('periodStart must not be after periodEnd');
    }
    return { start, end };
  }

  private async nextPayslipNo(tx: any, tenantId: string): Promise<string> {
    const last = await tx.salaryPayout.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { payslipNo: true },
    });
    let n = 1;
    if (last?.payslipNo) {
      const m = /(\d+)$/.exec(last.payslipNo);
      if (m) n = parseInt(m[1], 10) + 1;
    }
    return `PS-${String(n).padStart(5, '0')}`;
  }

  // -------------------------------------------------------------------------
  // Positions
  // -------------------------------------------------------------------------

  // Position dropdown scope by caller:
  // - Academic Affairs callers (TEACHER / ACADEMIC_AFFAIRS, no admin/accountant
  //   role) see only teacher positions.
  // - Everyone else sees all active positions except admin-titled ones — the
  //   ADMIN self is never assignable.
  private static ADMIN_POSITION_TITLES = ['ADMIN', 'SUPER_ADMIN', 'SYSTEM_ADMIN'];
  private static TEACHER_SCOPED_ROLES = ['TEACHER', 'ACADEMIC_AFFAIRS'];
  private static FULL_SCOPE_ROLES = ['ADMIN', 'SUPER_ADMIN', 'SYSTEM_ADMIN', 'ACCOUNTANT'];

  async listPositions(tenantId: string, callerUserId?: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      let teacherOnly = false;
      if (callerUserId) {
        const membership = await tx.tenantMembership.findFirst({
          where: { tenantId, userId: callerUserId, status: 'ACTIVE' },
          include: { roles: { include: { role: { select: { slug: true } } } } },
        });
        const slugs: string[] = (membership as any)?.roles?.map((r: any) => r.role.slug) ?? [];
        const hasFull = slugs.some((s) => FinancePayrollService.FULL_SCOPE_ROLES.includes(s));
        teacherOnly =
          !hasFull && slugs.some((s) => FinancePayrollService.TEACHER_SCOPED_ROLES.includes(s));
      }
      const rows = await tx.position.findMany({
        where: {
          tenantId,
          NOT: { title: { in: FinancePayrollService.ADMIN_POSITION_TITLES } },
          ...(teacherOnly ? { title: { contains: 'teach', mode: 'insensitive' } } : {}),
        },
        include: {
          department: { select: { name: true } },
          _count: { select: { assignments: true } },
        },
        orderBy: [{ isActive: 'desc' }, { title: 'asc' }],
      });
      return rows.map((p: any) => ({
        id: p.id,
        title: p.title,
        description: p.description ?? '',
        baseSalary: num(p.baseSalary),
        currencyCode: p.currencyCode,
        isActive: p.isActive,
        departmentId: p.departmentId,
        departmentName: p.department?.name ?? '',
        staffCount: p._count?.assignments ?? 0,
      }));
    });
  }

  async listDepartments(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.department.findMany({
        where: { tenantId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async createPosition(
    tenantId: string,
    dto: { title: string; baseSalary: number; currencyCode?: string; departmentId?: string; description?: string },
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const p = await tx.position.create({
        data: {
          tenantId,
          title: dto.title,
          baseSalary: dto.baseSalary,
          currencyCode: dto.currencyCode || tenant?.currencyCode || 'SDG',
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.departmentId ? { departmentId: dto.departmentId } : {}),
        },
      });
      return { id: p.id };
    });
  }

  async updatePosition(
    tenantId: string,
    id: string,
    dto: { title?: string; baseSalary?: number; currencyCode?: string; departmentId?: string; description?: string; isActive?: boolean },
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.position.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Position not found');
      const p = await tx.position.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.baseSalary !== undefined ? { baseSalary: dto.baseSalary } : {}),
          ...(dto.currencyCode !== undefined ? { currencyCode: dto.currencyCode } : {}),
          ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId || null } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      return { id: p.id };
    });
  }

  async deletePosition(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const active = await tx.staffPositionAssignment.count({ where: { tenantId, positionId: id, endDate: null } });
      if (active > 0) {
        await tx.position.update({ where: { id }, data: { isActive: false } });
        return { id, deactivated: true };
      }
      await tx.position.delete({ where: { id } });
      return { id, deleted: true };
    });
  }

  // -------------------------------------------------------------------------
  // Deduction rules
  // -------------------------------------------------------------------------

  // Reserved rule names backing the payroll attendance-shortage engine.
  // They are stored inactive so the generic payout rule engine never picks
  // them up, and they are hidden from the deduction-rules list.
  private static SHORTAGE_ABSENT_KEY = '__SHORTAGE_ABSENT_DAILY__';
  private static SHORTAGE_LATE_KEY = '__SHORTAGE_LATE__';

  async listDeductionRules(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const rows = await tx.salaryDeductionRule.findMany({
        where: { tenantId, NOT: { name: { startsWith: '__SHORTAGE_' } } },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      });
      return rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        valueType: r.valueType,
        value: num(r.value),
        description: r.description ?? '',
        appliesToPositionId: r.appliesToPositionId,
        isActive: r.isActive,
      }));
    });
  }

  async createDeductionRule(
    tenantId: string,
    dto: { name: string; valueType: DeductionValueType; value: number; description?: string; appliesToPositionId?: string },
  ) {
    return this.prisma.withTenant(tenantId, async (tx) =>
      tx.salaryDeductionRule.create({
        data: {
          tenantId,
          name: dto.name,
          valueType: dto.valueType,
          value: dto.value,
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.appliesToPositionId ? { appliesToPositionId: dto.appliesToPositionId } : {}),
        },
      }),
    );
  }

  async updateDeductionRule(
    tenantId: string,
    id: string,
    dto: { name?: string; valueType?: DeductionValueType; value?: number; description?: string; isActive?: boolean; appliesToPositionId?: string | null },
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.salaryDeductionRule.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Deduction rule not found');
      await tx.salaryDeductionRule.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.valueType !== undefined ? { valueType: dto.valueType } : {}),
          ...(dto.value !== undefined ? { value: dto.value } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.appliesToPositionId !== undefined ? { appliesToPositionId: dto.appliesToPositionId || null } : {}),
        },
      });
      return { id };
    });
  }

  async deleteDeductionRule(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.salaryDeductionRule.update({ where: { id }, data: { isActive: false } });
      return { id, deactivated: true };
    });
  }

  // -------------------------------------------------------------------------
  // Staff assignments / employees
  // -------------------------------------------------------------------------

  private mapAssignment(a: any) {
    return {
      id: a.id,
      userId: a.userId,
      staffName: a.user ? this.fullName(a.user) : '',
      staffNumber: a.user?.staffNumber ?? '',
      positionId: a.positionId,
      positionTitle: a.position?.title ?? '',
      baseSalary: num(a.position?.baseSalary),
      salaryOverride: a.salaryOverride != null ? num(a.salaryOverride) : null,
      effectiveSalary: num(a.salaryOverride ?? a.position?.baseSalary),
      currencyCode: a.position?.currencyCode ?? 'SDG',
      startDate: iso(a.startDate),
      endDate: iso(a.endDate),
      isActive: a.endDate == null,
    };
  }

  async listAssignments(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const rows = await tx.staffPositionAssignment.findMany({
        where: { tenantId },
        include: {
          user: { select: { firstName: true, lastName: true, staffNumber: true } },
          position: { select: { title: true, baseSalary: true, currencyCode: true } },
        },
        orderBy: [{ endDate: 'asc' }, { startDate: 'desc' }],
      });
      return rows.map((a: any) => this.mapAssignment(a));
    });
  }

  async assignStaff(
    tenantId: string,
    dto: { userId: string; positionId: string; salaryOverride?: number; startDate?: string },
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const position = await tx.position.findFirst({ where: { id: dto.positionId, tenantId } });
      if (!position) throw new NotFoundException('Position not found');
      const startDate = dto.startDate ? this.parseDay(dto.startDate, 'startDate') : new Date();
      await tx.staffPositionAssignment.updateMany({
        where: { tenantId, userId: dto.userId, endDate: null },
        data: { endDate: startDate },
      });
      const a = await tx.staffPositionAssignment.create({
        data: {
          tenantId,
          userId: dto.userId,
          positionId: dto.positionId,
          startDate,
          ...(dto.salaryOverride != null ? { salaryOverride: dto.salaryOverride } : {}),
        },
      });
      return { id: a.id };
    });
  }

  async endAssignment(tenantId: string, id: string, endDate?: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const a = await tx.staffPositionAssignment.findFirst({ where: { id, tenantId } });
      if (!a) throw new NotFoundException('Assignment not found');
      await tx.staffPositionAssignment.update({
        where: { id },
        data: { endDate: endDate ? this.parseDay(endDate, 'endDate') : new Date() },
      });
      return { id, ended: true };
    });
  }

  async listEmployees(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const memberships = await tx.tenantMembership.findMany({
        where: { tenantId, status: 'ACTIVE' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, staffNumber: true } },
          roles: { include: { role: { select: { slug: true } } } },
        },
      });
      const assignments = await tx.staffPositionAssignment.findMany({
        where: { tenantId, endDate: null },
        include: { position: { select: { id: true, title: true, baseSalary: true, currencyCode: true } } },
      });
      const byUser = new Map<string, any>(assignments.map((a: any) => [a.userId, a]));
      return memberships
        .filter((m: any) => {
          const slugs = m.roles.map((r: any) => r.role.slug);
          return slugs.length === 0 || slugs.some((s: string) => !STAFF_ROLE_BLOCK.includes(s));
        })
        .map((m: any) => {
          const a = byUser.get(m.user.id);
          return {
            userId: m.user.id,
            name: this.fullName(m.user),
            email: m.user.email ?? '',
            staffNumber: m.user.staffNumber ?? '',
            roles: m.roles.map((r: any) => r.role.slug),
            assignmentId: a?.id ?? null,
            positionId: a?.positionId ?? null,
            positionTitle: a?.position?.title ?? null,
            baseSalary: a ? num(a.position?.baseSalary) : null,
            salaryOverride: a && a.salaryOverride != null ? num(a.salaryOverride) : null,
            effectiveSalary: a ? num(a.salaryOverride ?? a.position?.baseSalary) : null,
            currencyCode: a?.position?.currencyCode ?? null,
          };
        });
    });
  }

  // -------------------------------------------------------------------------
  // Monthly pay register (2-tab payroll workspace)
  //
  // Code-only layer over existing models — no migration:
  // - Roster = active tenant memberships (non-student/guardian) UNION active
  //   teachers (academic), deduped by user id. No manual assignment step.
  // - Monthly lock = a PAID SalaryPayout whose paidAt falls in the current
  //   calendar month. Next eligible date = addMonthsClamped(lastPaidAt, 1),
  //   so a Jan-31 payout re-opens Feb-28 (Feb-29 leap), never Mar-03.
  // - Shortage rates live in inactive reserved SalaryDeductionRule rows, so
  //   the generic payout engine and the rules list never see them.
  // - SalaryPayout.positionAssignmentId is required, so paying requires an
  //   active position assignment (400 otherwise — assign a position first).
  // -------------------------------------------------------------------------

  addMonthsClamped(date: Date, months: number): Date {
    const d = new Date(date.getTime());
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d;
  }

  computeShortage(absentDays: number, lateDays: number, rates: { absentDaily: number; lateRate: number }): number {
    return round2(Math.max(0, absentDays) * rates.absentDaily + Math.max(0, lateDays) * rates.lateRate);
  }

  private monthRange(now: Date): { start: Date; end: Date; label: string } {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const label = start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return { start, end, label };
  }

  private fmtDay(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  // Normalizes position identity across every payroll surface: case-insensitive,
  // underscores and spaces treated as equal ('Academic_admin' === 'Academic Admin').
  normTitle(s: unknown): string {
    return String(s ?? '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  }

  prettySlug(slug: string): string {
    const clean = String(slug ?? '').replace(/_/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
    return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : '';
  }

  private async readShortageRates(tx: any, tenantId: string): Promise<{ absentDaily: number; lateRate: number }> {
    const rows = await tx.salaryDeductionRule.findMany({
      where: {
        tenantId,
        name: { in: [FinancePayrollService.SHORTAGE_ABSENT_KEY, FinancePayrollService.SHORTAGE_LATE_KEY] },
      },
    });
    const byName = new Map<string, number>(rows.map((r: any) => [r.name, num(r.value)]));
    return {
      absentDaily: byName.get(FinancePayrollService.SHORTAGE_ABSENT_KEY) ?? 0,
      lateRate: byName.get(FinancePayrollService.SHORTAGE_LATE_KEY) ?? 0,
    };
  }

  async getShortageRates(tenantId: string): Promise<{ absentDaily: number; lateRate: number }> {
    return this.prisma.withTenantRead(tenantId, (tx) => this.readShortageRates(tx, tenantId));
  }

  async setShortageRates(tenantId: string, dto: { absentDaily?: number; lateRate?: number }) {
    const entries: Array<[string, number | undefined]> = [
      [FinancePayrollService.SHORTAGE_ABSENT_KEY, dto.absentDaily],
      [FinancePayrollService.SHORTAGE_LATE_KEY, dto.lateRate],
    ];
    for (const [, v] of entries) {
      if (v !== undefined && !(Number.isFinite(v) && v >= 0)) {
        throw new BadRequestException('Shortage rates must be >= 0');
      }
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      for (const [name, v] of entries) {
        if (v === undefined) continue;
        const existing = await tx.salaryDeductionRule.findFirst({ where: { tenantId, name } });
        if (existing) {
          await tx.salaryDeductionRule.update({ where: { id: existing.id }, data: { value: v } });
        } else {
          await tx.salaryDeductionRule.create({
            data: {
              tenantId,
              name,
              valueType: 'FIXED_AMOUNT',
              value: v,
              isActive: false,
              description: 'Payroll attendance-shortage engine rate (reserved)',
            },
          });
        }
      }
      return this.readShortageRates(tx, tenantId);
    });
  }

  // Single write path for position salaries: { positionKey, baseSalary }.
  // positionKey accepts 'TEACHER' / 'Teacher' / 'teacher' etc.; the stored
  // title is title-cased and matched case-insensitively, so the Positions
  // tab, the register, and the DB can never disagree on identity.
  async upsertPositionSalary(tenantId: string, dto: { positionKey: string; baseSalary: number }) {
    const amount = Number(dto.baseSalary);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('Salary must be >= 0');
    }
    const key = String(dto.positionKey ?? '').trim();
    if (!key) throw new BadRequestException('positionKey is required');
    if (['ADMIN', 'SUPER_ADMIN', 'SYSTEM_ADMIN'].includes(key.toUpperCase())) {
      throw new BadRequestException('This position cannot be assigned a salary');
    }
    const title = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.position.findFirst({
        where: { tenantId, title: { equals: title, mode: 'insensitive' } },
      });
      if (existing) {
        const p = await tx.position.update({ where: { id: existing.id }, data: { baseSalary: amount } });
        return { id: p.id, title: p.title, baseSalary: num(p.baseSalary) };
      }
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const p = await tx.position.create({
        data: { tenantId, title, baseSalary: amount, currencyCode: (tenant as any)?.currencyCode || 'SDG' },
      });
      return { id: p.id, title: p.title, baseSalary: num(p.baseSalary) };
    });
  }

  async setSalaryOverride(tenantId: string, dto: { userId: string; amount: number }) {
    if (!(Number.isFinite(dto.amount) && dto.amount >= 0)) {
      throw new BadRequestException('Salary must be >= 0');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const assignment = await tx.staffPositionAssignment.findFirst({
        where: { tenantId, userId: dto.userId, endDate: null },
      });
      if (!assignment) {
        throw new BadRequestException('Staff member has no active position assignment; assign a position first');
      }
      await tx.staffPositionAssignment.update({ where: { id: assignment.id }, data: { salaryOverride: dto.amount } });
      return { id: assignment.id, salaryOverride: dto.amount };
    });
  }

  async listPayrollRegister(tenantId: string, now: Date = new Date()) {
    const { start, end, label } = this.monthRange(now);
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const [memberships, teachers, assignments, payouts, attendance, rates, positions] = await Promise.all([
        tx.tenantMembership.findMany({
          where: { tenantId, status: 'ACTIVE' },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, staffNumber: true } },
            roles: { include: { role: { select: { slug: true } } } },
          },
        }),
        tx.teacher.findMany({
          where: { tenantId, status: 'ACTIVE' },
          include: { user: { select: { id: true, firstName: true, lastName: true, staffNumber: true } } },
        }),
        tx.staffPositionAssignment.findMany({
          where: { tenantId, endDate: null },
          include: { position: { select: { title: true, baseSalary: true, currencyCode: true } } },
        }),
        tx.salaryPayout.findMany({
          where: { tenantId, status: 'PAID', paidAt: { gte: start, lte: end } },
        }),
        tx.staffAttendance.findMany({
          where: { tenantId, attendanceDate: { gte: start, lte: end } },
        }),
        this.readShortageRates(tx, tenantId),
        tx.position.findMany({
          where: { tenantId, isActive: true },
          select: { title: true, baseSalary: true, currencyCode: true },
        }),
      ]);

      const byUser = new Map<string, any>();
      for (const m of memberships as any[]) {
        const slugs: string[] = (m.roles ?? []).map((r: any) => r.role.slug);
        // Parents (and any other non-payable account) are kept out: role-less
        // memberships and fully-blocked ones never reach the register.
        // Register-scoped only — listEmployees semantics are untouched.
        if (slugs.length === 0 || slugs.every((s) => REGISTER_ROLE_BLOCK.includes(s))) continue;
        if (!m.user) continue;
        byUser.set(m.user.id, {
          userId: m.user.id,
          name: this.fullName(m.user),
          staffNumber: m.user.staffNumber ?? '',
          roleLabel: slugs.find((s) => !REGISTER_ROLE_BLOCK.includes(s)) ?? 'Staff',
          isTeacher: false,
        });
      }
      for (const t of teachers as any[]) {
        if (!t.user) continue;
        const existing = byUser.get(t.user.id);
        if (existing) {
          existing.isTeacher = true;
          if (existing.roleLabel === 'Staff') existing.roleLabel = 'Teacher';
        } else {
          byUser.set(t.user.id, {
            userId: t.user.id,
            name: this.fullName(t.user),
            staffNumber: t.user.staffNumber ?? t.employeeNumber ?? '',
            roleLabel: 'Teacher',
            isTeacher: true,
          });
        }
      }

      const assignmentByUser = new Map<string, any>(
        (assignments as any[]).map((a) => [a.userId, a]),
      );
      const positionByTitle = new Map<string, any>(
        (positions as any[]).map((p) => [this.normTitle(p.title), p]),
      );
      const teacherIdByUser = new Map<string, string>(
        (teachers as any[]).filter((t) => t.user).map((t) => [t.user.id, t.id]),
      );
      const paidByUser = new Map<string, any>(
        (payouts as any[]).map((p) => [p.userId, p]),
      );
      const absentByTeacher = new Map<string, number>();
      const lateByTeacher = new Map<string, number>();
      for (const row of attendance as any[]) {
        if (row.status === 'ABSENT') absentByTeacher.set(row.teacherId, (absentByTeacher.get(row.teacherId) ?? 0) + 1);
        if ((row.status as string) === 'LATE') lateByTeacher.set(row.teacherId, (lateByTeacher.get(row.teacherId) ?? 0) + 1);
      }

      return [...byUser.values()].map((m) => {
        const a = assignmentByUser.get(m.userId);
        // Position base is the single source of truth: editing a position
        // salary in the Positions tab propagates to every holder instantly.
        // Members without an assignment (e.g. Academic Affairs teachers) fall
        // back to their role-derived position so they are payable without a
        // manual linking step.
        let positionTitle: string;
        let base: number;
        let currencyCode: string;
        if (a?.position) {
          positionTitle = a.position.title;
          base = num(a.position.baseSalary);
          currencyCode = a.position.currencyCode ?? 'SDG';
        } else {
          const fallbackTitle = m.isTeacher ? 'Teacher' : this.prettySlug(m.roleLabel);
          const match = positionByTitle.get(this.normTitle(fallbackTitle));
          positionTitle = match?.title ?? (m.isTeacher ? 'Teacher' : m.roleLabel);
          base = match ? num(match.baseSalary) : 0;
          currencyCode = match?.currencyCode ?? 'SDG';
        }
        const teacherId = teacherIdByUser.get(m.userId);
        const absentDays = teacherId ? absentByTeacher.get(teacherId) ?? 0 : 0;
        // StaffAttendanceStatus has no LATE yet — reserved for when it lands.
        const lateDays = teacherId ? lateByTeacher.get(teacherId) ?? 0 : 0;
        const deductionAmount = this.computeShortage(absentDays, lateDays, rates);
        const paid = paidByUser.get(m.userId);
        const lastPaidAt = paid?.paidAt ? new Date(paid.paidAt) : null;
        return {
          userId: m.userId,
          name: m.name,
          staffNumber: m.staffNumber,
          roleLabel: m.roleLabel,
          positionTitle,
          baseSalary: base,
          currencyCode,
          absentDays,
          lateDays,
          deductionAmount,
          netPay: round2(base - deductionAmount),
          status: paid ? 'paid' : 'pending',
          lastPaidAt: lastPaidAt ? lastPaidAt.toISOString() : null,
          nextEligibleDate: lastPaidAt ? this.fmtDay(this.addMonthsClamped(lastPaidAt, 1)) : this.fmtDay(now),
          hasAssignment: !!a,
          payable: base > 0,
          cycleLabel: label,
        };
      });
    });
  }

  // Ensures the member is linked to a position, creating the link on the fly
  // when they have none (e.g. Academic Affairs teachers). The role-derived
  // title follows the same normTitle identity as the register fallback and
  // the upsert contract, so all three can never disagree. Throws when the
  // person is unknown, role-less, or blocked (ADMIN self).
  private async ensureAssignment(tx: any, tenantId: string, userId: string) {
    const existing = await tx.staffPositionAssignment.findFirst({
      where: { tenantId, userId, endDate: null },
      include: { position: true },
    });
    if (existing) return existing;

    const teacher = await tx.teacher.findFirst({ where: { tenantId, userId, status: 'ACTIVE' } });
    const membership = await tx.tenantMembership.findFirst({
      where: { tenantId, userId, status: 'ACTIVE' },
      include: { roles: { include: { role: { select: { slug: true } } } } },
    });
    if (!teacher && !membership) throw new NotFoundException('Staff member not found');
    const slug: string | undefined = teacher
      ? 'TEACHER'
      : (membership as any)?.roles?.map((r: any) => r.role.slug)?.find((s: string) => !REGISTER_ROLE_BLOCK.includes(s));
    if (!slug) throw new BadRequestException('Staff member has no assignable role');
    if (REGISTER_ROLE_BLOCK.includes(slug)) throw new BadRequestException('This account cannot be assigned a salary');

    const title = this.prettySlug(slug);
    const actives = await tx.position.findMany({ where: { tenantId, isActive: true } });
    let position = (actives as any[]).find((p) => this.normTitle(p.title) === this.normTitle(title)) ?? null;
    if (!position) {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      position = await tx.position.create({
        data: { tenantId, title, baseSalary: 0, currencyCode: (tenant as any)?.currencyCode || 'SDG' },
      });
    }
    return tx.staffPositionAssignment.create({
      data: { tenantId, userId, positionId: (position as any).id, startDate: new Date() },
      include: { position: true },
    });
  }

  async paySalary(
    tenantId: string,
    approverId: string,
    dto: { userId: string; method: string; reference?: string; notes?: string },
    now: Date = new Date(),
  ) {
    const METHOD = ['CASH', 'BANKAK', 'FAWRY', 'BANK_TRANSFER'];
    if (!METHOD.includes(dto.method)) throw new BadRequestException('Unknown payment method');
    const { start, end } = this.monthRange(now);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const assignment = await this.ensureAssignment(tx, tenantId, dto.userId);
      const dup = await tx.salaryPayout.findFirst({
        where: { tenantId, userId: dto.userId, status: 'PAID', paidAt: { gte: start, lte: end } },
      });
      if (dup) throw new BadRequestException('Salary already paid for the current month cycle');

      const gross = num(assignment.position.baseSalary);
      if (!(gross > 0)) throw new BadRequestException('Position has no salary set; set it in the Positions tab first');
      const teacher = await tx.teacher.findFirst({ where: { tenantId, userId: dto.userId, status: 'ACTIVE' } });
      let absentDays = 0;
      let lateDays = 0;
      if (teacher) {
        const rows = await tx.staffAttendance.findMany({
          where: { tenantId, teacherId: teacher.id, attendanceDate: { gte: start, lte: end } },
        });
        for (const r of rows as any[]) {
          if (r.status === 'ABSENT') absentDays += 1;
          if ((r.status as string) === 'LATE') lateDays += 1;
        }
      }
      const rates = await this.readShortageRates(tx, tenantId);
      const shortage = this.computeShortage(absentDays, lateDays, rates);
      const rules = await this.rulesForPosition(tx, tenantId, assignment.positionId);

      let rulesTotal = 0;
      const ruleLines = (rules as any[]).map((r) => {
        const value = num(r.value);
        const amount = this.dedAmount(gross, r.valueType, value);
        rulesTotal += amount;
        return { rule: r, value, amount };
      });

      const payslipNo = await this.nextPayslipNo(tx, tenantId);
      const payout = await tx.salaryPayout.create({
        data: {
          tenantId,
          userId: dto.userId,
          positionAssignmentId: assignment.id,
          periodStart: start,
          periodEnd: end,
          grossAmount: gross,
          totalDeductions: round2(rulesTotal + shortage),
          netAmount: round2(gross - rulesTotal - shortage),
          currencyCode: assignment.position.currencyCode,
          payslipNo,
          createdBy: approverId,
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          deductions: {
            create: [
              ...ruleLines.map((l) => ({
                ruleId: l.rule.id,
                label: l.rule.name,
                valueType: l.rule.valueType,
                value: l.value,
                calculatedAmount: l.amount,
              })),
              ...(absentDays > 0
                ? [{
                    label: `Absence shortage (${absentDays} day${absentDays === 1 ? '' : 's'})`,
                    valueType: 'FIXED_AMOUNT' as const,
                    value: shortage - lateDays * rates.lateRate,
                    calculatedAmount: round2(absentDays * rates.absentDaily),
                    note: `${absentDays} unexcused absence(s) x ${rates.absentDaily}`,
                  }]
                : []),
              ...(lateDays > 0
                ? [{
                    label: `Late arrival penalty (${lateDays} late)`,
                    valueType: 'FIXED_AMOUNT' as const,
                    value: lateDays * rates.lateRate,
                    calculatedAmount: round2(lateDays * rates.lateRate),
                    note: `${lateDays} late arrival(s) x ${rates.lateRate}`,
                  }]
                : []),
            ],
          },
        },
        include: this.payoutInclude,
      });

      await tx.salaryPayout.update({ where: { id: payout.id }, data: { status: 'APPROVED', approvedBy: approverId } });
      await this.audit(tx, tenantId, 'PAYOUT_APPROVED', 'SalaryPayout', payout.id, approverId, undefined, { status: 'APPROVED' });

      const account = await tx.financialAccount.findFirst({ where: { tenantId }, orderBy: { name: 'asc' } });
      if (!account) throw new BadRequestException('No financial account available; create one first');
      await tx.financialTransaction.create({
        data: {
          tenantId,
          accountId: account.id,
          type: 'DEBIT',
          amount: round2(gross - rulesTotal - shortage),
          reference: payslipNo,
          referenceType: 'SALARY_PAYOUT',
        },
      });
      await tx.salaryPayout.update({
        where: { id: payout.id },
        data: {
          status: 'PAID',
          paidAt: now,
          accountId: account.id,
          paymentMethod: dto.method,
          reference: dto.reference ?? null,
        },
      });
      await this.audit(tx, tenantId, 'PAYOUT_PAID', 'SalaryPayout', payout.id, approverId, undefined, {
        status: 'PAID',
        netAmount: round2(gross - rulesTotal - shortage),
        accountId: account.id,
      });

      const full = await tx.salaryPayout.findFirst({ where: { id: payout.id }, include: this.payoutInclude });
      return this.mapPayout(full);
    });
  }

  // -------------------------------------------------------------------------
  // Staff salary assignment (form dialogue source)
  //
  // The select lists PEOPLE, not positions:
  // - Academic Affairs callers see only teachers (their own source).
  // - Admin-side callers see teachers PLUS all admin-created staff, minus
  //   the ADMIN self (any REGISTER_ROLE_BLOCK slug).
  // Saving assigns the person to their position (find-or-create by role
  // title) and sets the position base salary — the register is
  // position-driven, so this propagates to every holder instantly.
  // -------------------------------------------------------------------------

  private async callerSlugs(tx: any, tenantId: string, callerUserId?: string): Promise<string[]> {
    if (!callerUserId) return [];
    const membership = await tx.tenantMembership.findFirst({
      where: { tenantId, userId: callerUserId, status: 'ACTIVE' },
      include: { roles: { include: { role: { select: { slug: true } } } } },
    });
    return (membership as any)?.roles?.map((r: any) => r.role.slug) ?? [];
  }

  async listPayrollStaffOptions(tenantId: string, callerUserId?: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const slugs = await this.callerSlugs(tx, tenantId, callerUserId);
      const hasFull =
        slugs.length === 0 ||
        slugs.some((s) => FinancePayrollService.FULL_SCOPE_ROLES.includes(s));
      const [memberships, teachers] = await Promise.all([
        hasFull
          ? tx.tenantMembership.findMany({
              where: { tenantId, status: 'ACTIVE' },
              include: {
                user: { select: { id: true, firstName: true, lastName: true, staffNumber: true } },
                roles: { include: { role: { select: { slug: true } } } },
              },
            })
          : [],
        tx.teacher.findMany({
          where: { tenantId, status: 'ACTIVE' },
          include: { user: { select: { id: true, firstName: true, lastName: true, staffNumber: true } } },
        }),
      ]);
      const academic = (teachers as any[])
        .filter((t) => t.user)
        .map((t) => ({
          userId: t.user.id,
          name: this.fullName(t.user),
          staffNumber: t.user.staffNumber ?? t.employeeNumber ?? '',
          group: 'academic' as const,
          roleLabel: 'Teacher',
        }));
      const admin = (memberships as any[])
        .filter((m) => {
          if (!m.user) return false;
          const rs: string[] = (m.roles ?? []).map((r: any) => r.role.slug);
          return rs.length > 0 && rs.every((s) => !REGISTER_ROLE_BLOCK.includes(s));
        })
        .map((m) => ({
          userId: m.user.id,
          name: this.fullName(m.user),
          staffNumber: m.user.staffNumber ?? '',
          group: 'admin' as const,
          roleLabel: (m.roles as any[]).map((r) => r.role.slug).find((s) => !REGISTER_ROLE_BLOCK.includes(s)) ?? 'Staff',
        }));
      return { academic, admin };
    });
  }

  async assignStaffSalary(tenantId: string, dto: { userId: string; amount: number }) {
    if (!(Number.isFinite(dto.amount) && dto.amount >= 0)) {
      throw new BadRequestException('Salary must be >= 0');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const membership = await tx.tenantMembership.findFirst({
        where: { tenantId, userId: dto.userId, status: 'ACTIVE' },
        include: {
          user: { select: { id: true } },
          roles: { include: { role: { select: { slug: true } } } },
        },
      });
      const teacher = await tx.teacher.findFirst({ where: { tenantId, userId: dto.userId, status: 'ACTIVE' } });
      if (!membership && !teacher) throw new NotFoundException('Staff member not found');
      const roleSlug: string | undefined = teacher
        ? 'TEACHER'
        : (membership as any)?.roles?.map((r: any) => r.role.slug)?.find((s: string) => !REGISTER_ROLE_BLOCK.includes(s));
      if (!roleSlug) throw new BadRequestException('Staff member has no assignable role');
      if (REGISTER_ROLE_BLOCK.includes(roleSlug)) throw new BadRequestException('This account cannot be assigned a salary');

      const title = roleSlug.charAt(0) + roleSlug.slice(1).toLowerCase();
      let position = await tx.position.findFirst({
        where: { tenantId, title: { equals: title, mode: 'insensitive' } },
      });
      if (!position) {
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
        position = await tx.position.create({
          data: { tenantId, title, baseSalary: dto.amount, currencyCode: (tenant as any)?.currencyCode || 'SDG' },
        });
      } else {
        await tx.position.update({ where: { id: position.id }, data: { baseSalary: dto.amount } });
      }
      let assignment = await tx.staffPositionAssignment.findFirst({
        where: { tenantId, userId: dto.userId, positionId: position.id, endDate: null },
      });
      if (!assignment) {
        assignment = await tx.staffPositionAssignment.create({
          data: { tenantId, userId: dto.userId, positionId: position.id, startDate: new Date() },
        });
      }
      return { userId: dto.userId, positionId: position.id, positionTitle: position.title, baseSalary: dto.amount, assignmentId: assignment.id };
    });
  }

  // -------------------------------------------------------------------------
  // Payouts
  // -------------------------------------------------------------------------

  private mapPayout(p: any) {
    return {
      id: p.id,
      userId: p.userId,
      staffName: p.user ? this.fullName(p.user) : '',
      staffNumber: p.user?.teacherProfile?.employeeNumber ?? p.user?.staffNumber ?? '',
      staffEmail: p.user?.email ?? '',
      staffPhone: p.user?.phone ?? '',
      staffSubject: p.user?.teacherProfile?.specialization ?? '',
      departmentName:
        p.user?.teacherProfile?.department?.name ??
        p.positionAssignment?.position?.department?.name ??
        '',
      payslipNo: p.payslipNo,
      positionAssignmentId: p.positionAssignmentId,
      positionTitle: p.positionAssignment?.position?.title ?? '',
      financialPeriodId: p.financialPeriodId,
      periodName: p.financialPeriod?.name ?? '',
      periodStart: iso(p.periodStart),
      periodEnd: iso(p.periodEnd),
      grossAmount: num(p.grossAmount),
      totalDeductions: num(p.totalDeductions),
      netAmount: num(p.netAmount),
      currencyCode: p.currencyCode,
      status: lower(p.status),
      accountId: p.accountId,
      approvedBy: p.approvedBy,
      paidAt: iso(p.paidAt),
      paymentMethod: p.paymentMethod ?? '',
      reference: p.reference ?? '',
      notes: p.notes ?? '',
      createdAt: iso(p.createdAt),
      deductions: (p.deductions ?? []).map((d: any) => ({
        id: d.id,
        ruleId: d.ruleId,
        label: d.label,
        valueType: d.valueType,
        value: num(d.value),
        amount: num(d.calculatedAmount),
        note: d.note ?? '',
      })),
    };
  }

  private payoutInclude = {
    user: {
      select: {
        firstName: true,
        lastName: true,
        staffNumber: true,
        email: true,
        phone: true,
        teacherProfile: {
          select: {
            employeeNumber: true,
            specialization: true,
            department: { select: { name: true } },
          },
        },
      },
    },
    positionAssignment: {
      include: {
        position: {
          select: { title: true, currencyCode: true, department: { select: { name: true } } },
        },
      },
    },
    financialPeriod: { select: { name: true } },
    deductions: { orderBy: { createdAt: 'asc' as const } },
  };

  async listPayouts(tenantId: string, status?: string, limit?: number) {
    const requested = Number.isFinite(limit) ? Math.trunc(limit as number) : 300;
    const take = requested === 0 ? undefined : Math.min(Math.max(requested, 1), 5000);
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const rows = await tx.salaryPayout.findMany({
        where: { tenantId, ...(status ? { status: status.toUpperCase() as any } : {}) },
        include: this.payoutInclude,
        orderBy: { createdAt: 'desc' },
        ...(take ? { take } : {}),
      });
      return rows.map((p: any) => this.mapPayout(p));
    });
  }

  // Teacher-portal self-service: the caller's own payslips plus year-to-date
  // aggregates. The userId comes from the session (teachers/me), never from
  // the wire, so a teacher can only see their own payouts. Aggregates follow
  // the same statuses the accountant register uses: PAID counts as confirmed
  // income, DRAFT/APPROVED are still pending.
  async listMyPayouts(tenantId: string, userId: string, now: Date = new Date()) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const rows = await tx.salaryPayout.findMany({
        where: { tenantId, userId: userId },
        include: this.payoutInclude,
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        take: 120,
      });
      const payouts = rows.map((p: any) => this.mapPayout(p));
      const year = now.getUTCFullYear();
      let paidTotal = 0;
      let pendingTotal = 0;
      let currencyCode = '';
      for (const p of payouts) {
        currencyCode = currencyCode || p.currencyCode || '';
        // mapPayout lower-cases status — compare against the mapped values.
        if (p.status === 'paid') {
          const paidYear = p.paidAt ? new Date(p.paidAt).getUTCFullYear() : null;
          if (paidYear === year) paidTotal = round2(paidTotal + num(p.netAmount));
        } else if (p.status === 'draft' || p.status === 'approved') {
          pendingTotal = round2(pendingTotal + num(p.netAmount));
        }
      }
      return {
        payouts,
        ytd: { year, paidTotal, pendingTotal, currencyCode },
      };
    });
  }

  private async rulesForPosition(tx: any, tenantId: string, positionId: string) {
    return tx.salaryDeductionRule.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [{ appliesToPositionId: null }, { appliesToPositionId: positionId }],
      },
      orderBy: { name: 'asc' },
    });
  }

  async createPayout(
    tenantId: string,
    createdBy: string,
    dto: { userId: string; periodStart: string; periodEnd: string; financialPeriodId?: string; notes?: string },
  ) {
    const period = this.parsePeriod(dto.periodStart, dto.periodEnd);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const assignment = await tx.staffPositionAssignment.findFirst({
        where: { tenantId, userId: dto.userId, endDate: null },
        include: { position: true },
      });
      if (!assignment) throw new BadRequestException('Staff member has no active position assignment');

      const gross = num(assignment.salaryOverride ?? assignment.position.baseSalary);
      const currency = assignment.position.currencyCode;
      const rules = await this.rulesForPosition(tx, tenantId, assignment.positionId);

      let total = 0;
      const lines = rules.map((r: any) => {
        const value = num(r.value);
        const amount = this.dedAmount(gross, r.valueType, value);
        total += amount;
        return { rule: r, value, amount };
      });

      const payslipNo = await this.nextPayslipNo(tx, tenantId);
      const payout = await tx.salaryPayout.create({
        data: {
          tenantId,
          userId: dto.userId,
          positionAssignmentId: assignment.id,
          periodStart: period.start,
          periodEnd: period.end,
          grossAmount: gross,
          totalDeductions: round2(total),
          netAmount: round2(gross - total),
          currencyCode: currency,
          payslipNo,
          createdBy,
          ...(dto.financialPeriodId ? { financialPeriodId: dto.financialPeriodId } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          deductions: {
            create: lines.map((l) => ({
              ruleId: l.rule.id,
              label: l.rule.name,
              valueType: l.rule.valueType,
              value: l.value,
              calculatedAmount: l.amount,
            })),
          },
        },
        include: this.payoutInclude,
      });
      return this.mapPayout(payout);
    });
  }

  async generateBatch(
    tenantId: string,
    createdBy: string,
    dto: { periodStart: string; periodEnd: string; financialPeriodId?: string },
  ) {
    const period = this.parsePeriod(dto.periodStart, dto.periodEnd);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const assignments = await tx.staffPositionAssignment.findMany({
        where: { tenantId, endDate: null },
        include: { position: true },
      });
      let generated = 0;
      for (const assignment of assignments) {
        const existing = await tx.salaryPayout.findFirst({
          where: {
            tenantId,
            userId: assignment.userId,
            status: { not: 'CANCELLED' },
            periodStart: period.start,
            periodEnd: period.end,
          },
        });
        if (existing) continue;

        const gross = num(assignment.salaryOverride ?? assignment.position.baseSalary);
        const rules = await this.rulesForPosition(tx, tenantId, assignment.positionId);
        let total = 0;
        const lines = rules.map((r: any) => {
          const value = num(r.value);
          const amount = this.dedAmount(gross, r.valueType, value);
          total += amount;
          return { rule: r, value, amount };
        });
        const payslipNo = await this.nextPayslipNo(tx, tenantId);
        await tx.salaryPayout.create({
          data: {
            tenantId,
            userId: assignment.userId,
            positionAssignmentId: assignment.id,
            periodStart: period.start,
            periodEnd: period.end,
            grossAmount: gross,
            totalDeductions: round2(total),
            netAmount: round2(gross - total),
            currencyCode: assignment.position.currencyCode,
            payslipNo,
            createdBy,
            ...(dto.financialPeriodId ? { financialPeriodId: dto.financialPeriodId } : {}),
            deductions: {
              create: lines.map((l) => ({
                ruleId: l.rule.id,
                label: l.rule.name,
                valueType: l.rule.valueType,
                value: l.value,
                calculatedAmount: l.amount,
              })),
            },
          },
        });
        generated += 1;
      }
      return { generated };
    });
  }

  private async recalcTotals(tx: any, tenantId: string, payoutId: string) {
    const payout = await tx.salaryPayout.findFirst({ where: { id: payoutId, tenantId } });
    if (!payout) throw new NotFoundException('Payout not found');
    const agg = await tx.salaryDeductionApplication.aggregate({
      where: { tenantId, payoutId },
      _sum: { calculatedAmount: true },
    });
    const total = round2(num(agg._sum.calculatedAmount));
    const gross = num(payout.grossAmount);
    await tx.salaryPayout.update({
      where: { id: payoutId },
      data: { totalDeductions: total, netAmount: round2(gross - total) },
    });
  }

  async addPayoutDeduction(
    tenantId: string,
    payoutId: string,
    dto: { label: string; valueType: DeductionValueType; value: number; note?: string; ruleId?: string },
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const payout = await tx.salaryPayout.findFirst({ where: { id: payoutId, tenantId } });
      if (!payout) throw new NotFoundException('Payout not found');
      if (payout.status !== 'DRAFT') throw new BadRequestException('Only draft payouts can be edited');
      const amount = this.dedAmount(num(payout.grossAmount), dto.valueType, dto.value);
      await tx.salaryDeductionApplication.create({
        data: {
          tenantId,
          payoutId,
          label: dto.label,
          valueType: dto.valueType,
          value: dto.value,
          calculatedAmount: amount,
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...(dto.ruleId ? { ruleId: dto.ruleId } : {}),
        },
      });
      await this.recalcTotals(tx, tenantId, payoutId);
      const full = await tx.salaryPayout.findFirst({ where: { id: payoutId }, include: this.payoutInclude });
      return this.mapPayout(full);
    });
  }

  async removePayoutDeduction(tenantId: string, payoutId: string, deductionId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const payout = await tx.salaryPayout.findFirst({ where: { id: payoutId, tenantId } });
      if (!payout) throw new NotFoundException('Payout not found');
      if (payout.status !== 'DRAFT') throw new BadRequestException('Only draft payouts can be edited');
      await tx.salaryDeductionApplication.deleteMany({ where: { id: deductionId, payoutId, tenantId } });
      await this.recalcTotals(tx, tenantId, payoutId);
      const full = await tx.salaryPayout.findFirst({ where: { id: payoutId }, include: this.payoutInclude });
      return this.mapPayout(full);
    });
  }

  async approvePayout(tenantId: string, userId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const payout = await tx.salaryPayout.findFirst({ where: { id, tenantId } });
      if (!payout) throw new NotFoundException('Payout not found');
      if (payout.status !== 'DRAFT') throw new BadRequestException('Only draft payouts can be approved');
      await tx.salaryPayout.update({ where: { id }, data: { status: 'APPROVED', approvedBy: userId } });
      await this.audit(tx, tenantId, 'PAYOUT_APPROVED', 'SalaryPayout', id, userId, undefined, { status: 'APPROVED' });
      return { id, status: 'approved' };
    });
  }

  async cancelPayout(tenantId: string, userId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const payout = await tx.salaryPayout.findFirst({ where: { id, tenantId } });
      if (!payout) throw new NotFoundException('Payout not found');
      if (payout.status === 'PAID') throw new BadRequestException('Paid payouts cannot be cancelled');
      await tx.salaryPayout.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit(tx, tenantId, 'PAYOUT_CANCELLED', 'SalaryPayout', id, userId, undefined, { status: 'CANCELLED' });
      return { id, status: 'cancelled' };
    });
  }

  async payPayout(
    tenantId: string,
    userId: string,
    id: string,
    dto: { accountId?: string; method?: string; reference?: string },
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const payout = await tx.salaryPayout.findFirst({ where: { id, tenantId } });
      if (!payout) throw new NotFoundException('Payout not found');
      if (payout.status !== 'APPROVED') throw new BadRequestException('Only approved payouts can be paid');

      let accountId = dto.accountId;
      if (!accountId) {
        const account = await tx.financialAccount.findFirst({ where: { tenantId }, orderBy: { name: 'asc' } });
        if (!account) throw new BadRequestException('No financial account available; create one first');
        accountId = account.id;
      } else {
        const account = await tx.financialAccount.findFirst({ where: { id: accountId, tenantId } });
        if (!account) throw new NotFoundException('Financial account not found');
      }

      let financialPeriodId = payout.financialPeriodId;
      if (!financialPeriodId) {
        const period = await tx.financialPeriod.findFirst({
          where: { tenantId, isClosed: false },
          orderBy: { startDate: 'desc' },
        });
        financialPeriodId = period?.id ?? null;
      }

      await tx.financialTransaction.create({
        data: {
          tenantId,
          accountId,
          type: 'DEBIT',
          amount: payout.netAmount,
          reference: payout.payslipNo,
          referenceType: 'SALARY_PAYOUT',
        },
      });

      await tx.salaryPayout.update({
        where: { id },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          accountId,
          paymentMethod: dto.method ?? 'bank_transfer',
          reference: dto.reference ?? null,
          financialPeriodId,
        },
      });
      await this.audit(tx, tenantId, 'PAYOUT_PAID', 'SalaryPayout', id, userId, undefined, {
        status: 'PAID',
        netAmount: num(payout.netAmount),
        accountId,
      });
      return { id, status: 'paid' };
    });
  }

  async getPayslip(tenantId: string, id: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const payout = await tx.salaryPayout.findFirst({
        where: { id, tenantId },
        include: {
          ...this.payoutInclude,
          tenant: { select: { name: true } },
        },
      });
      if (!payout) throw new NotFoundException('Payout not found');
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      const buffer = await renderPayslip({
        tenantName: tenant?.name ?? '',
        staffName: payout.user ? this.fullName(payout.user) : '',
        staffNumber: payout.user?.staffNumber ?? '',
        positionTitle: payout.positionAssignment?.position?.title ?? '',
        payslipNo: payout.payslipNo,
        periodStart: new Date(payout.periodStart),
        periodEnd: new Date(payout.periodEnd),
        grossAmount: num(payout.grossAmount),
        totalDeductions: num(payout.totalDeductions),
        netAmount: num(payout.netAmount),
        currency: payout.currencyCode,
        deductions: (payout.deductions ?? []).map((d: any) => ({
          label: d.label,
          valueType: d.valueType,
          value: num(d.value),
          amount: num(d.calculatedAmount),
        })),
      });
      return { buffer, filename: `${payout.payslipNo}.pdf` };
    });
  }

  // -------------------------------------------------------------------------
  // Sibling groups
  // -------------------------------------------------------------------------

  private async mapGroup(tx: any, g: any) {
    return {
      id: g.id,
      name: g.name ?? '',
      relation: g.relation,
      createdAt: iso(g.createdAt),
      members: (g.members ?? []).map((m: any) => ({
        id: m.id,
        studentId: m.studentId,
        studentName: m.student ? this.fullName(m.student) : '',
        roleNumber: m.student?.roleNumber ?? '',
        educationLevel: m.student?.educationLevel ?? '',
        grade: m.student?.grade ?? '',
      })),
    };
  }

  async listSiblingGroups(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const rows = await tx.siblingGroup.findMany({
        where: { tenantId },
        include: {
          members: {
            include: {
              student: { select: { firstName: true, lastName: true, roleNumber: true, educationLevel: true, grade: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      return Promise.all(rows.map((g: any) => this.mapGroup(tx, g)));
    });
  }

  async createSiblingGroup(
    tenantId: string,
    dto: { name?: string; relation: 'SISTERS' | 'BROTHERS' | 'SISTERS_AND_BROTHERS'; studentIds: string[] },
  ) {
    if (!dto.studentIds || dto.studentIds.length < 2) {
      throw new BadRequestException('A sibling group needs at least two students');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const g = await tx.siblingGroup.create({
        data: {
          tenantId,
          relation: dto.relation,
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          members: {
            create: dto.studentIds.map((studentId) => ({ studentId })),
          },
        },
        include: {
          members: {
            include: {
              student: { select: { firstName: true, lastName: true, roleNumber: true, educationLevel: true, grade: true } },
            },
          },
        },
      });
      return this.mapGroup(tx, g);
    });
  }

  async addSiblingMember(tenantId: string, groupId: string, studentId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const group = await tx.siblingGroup.findFirst({ where: { id: groupId, tenantId } });
      if (!group) throw new NotFoundException('Sibling group not found');
      await tx.siblingGroupMember.create({ data: { tenantId, groupId, studentId } });
      const g = await tx.siblingGroup.findFirst({
        where: { id: groupId },
        include: {
          members: {
            include: {
              student: { select: { firstName: true, lastName: true, roleNumber: true, educationLevel: true, grade: true } },
            },
          },
        },
      });
      return this.mapGroup(tx, g);
    });
  }

  async removeSiblingMember(tenantId: string, groupId: string, studentId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.siblingGroupMember.deleteMany({ where: { tenantId, groupId, studentId } });
      return { groupId, studentId, removed: true };
    });
  }

  async deleteSiblingGroup(tenantId: string, groupId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.siblingGroup.deleteMany({ where: { id: groupId, tenantId } });
      return { id: groupId, deleted: true };
    });
  }

  // -------------------------------------------------------------------------
  // Sibling discount rules
  // -------------------------------------------------------------------------

  async listSiblingRules(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const rows = await tx.siblingDiscountRule.findMany({
        where: { tenantId },
        orderBy: [{ isActive: 'desc' }, { minSiblingCount: 'asc' }],
      });
      return rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        relationType: r.relationType,
        minSiblingCount: r.minSiblingCount,
        valueType: r.valueType,
        value: num(r.value),
        isActive: r.isActive,
      }));
    });
  }

  async createSiblingRule(
    tenantId: string,
    dto: { name: string; relationType: 'SISTERS' | 'BROTHERS' | 'SISTERS_AND_BROTHERS'; minSiblingCount: number; valueType: DeductionValueType; value: number },
  ) {
    const amount = Number(dto.value);
    if (!(amount >= 0) || (dto.valueType === 'PERCENTAGE' && !(amount <= 100))) {
      throw new BadRequestException('Value must be >= 0 (percentage <= 100)');
    }
    return this.prisma.withTenant(tenantId, async (tx) =>
      tx.siblingDiscountRule.create({
        data: {
          tenantId,
          name: dto.name,
          relationType: dto.relationType,
          minSiblingCount: dto.minSiblingCount,
          valueType: dto.valueType,
          value: dto.value,
        },
      }),
    );
  }

  async updateSiblingRule(
    tenantId: string,
    id: string,
    dto: { name?: string; relationType?: string; minSiblingCount?: number; valueType?: DeductionValueType; value?: number; isActive?: boolean },
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.siblingDiscountRule.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Sibling discount rule not found');
      await tx.siblingDiscountRule.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.relationType !== undefined ? { relationType: dto.relationType as any } : {}),
          ...(dto.minSiblingCount !== undefined ? { minSiblingCount: dto.minSiblingCount } : {}),
          ...(dto.valueType !== undefined ? { valueType: dto.valueType } : {}),
          ...(dto.value !== undefined ? { value: dto.value } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      return { id };
    });
  }

  async deleteSiblingRule(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.siblingDiscountRule.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Sibling discount rule not found');
      await tx.siblingDiscountRule.update({ where: { id }, data: { isActive: false } });
      return { id, deactivated: true };
    });
  }

  // Materialises sibling-group eligibility into PENDING StudentDiscounts that
  // then flow through the normal discount approval queue. Manual membership is
  // the source of truth; this never auto-approves.
  async syncSiblingDiscounts(tenantId: string, userId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const groups = await tx.siblingGroup.findMany({
        where: { tenantId },
        include: { members: { select: { studentId: true } } },
      });
      const rules = await tx.siblingDiscountRule.findMany({ where: { tenantId, isActive: true } });
      const ruleInputs: SiblingRuleLike[] = rules.map((r: any) => ({
        id: r.id,
        name: r.name,
        relationType: r.relationType,
        minSiblingCount: r.minSiblingCount,
        valueType: r.valueType,
        value: num(r.value),
        isActive: r.isActive,
      }));

      let created = 0;
      let skipped = 0;
      for (const group of groups) {
        const composed = composeSiblingDiscount(group.relation, group.members.length, ruleInputs);
        if (!composed) continue;

        const isPercentage = composed.valueType === 'PERCENTAGE';
        const typeName = isPercentage ? 'Sibling Discount (Percentage)' : 'Sibling Discount (Fixed)';
        const kind = isPercentage ? 'percentage' : 'fixed';
        let type = await tx.discountType.findFirst({ where: { tenantId, name: typeName } });
        if (!type) {
          type = await tx.discountType.create({ data: { tenantId, name: typeName, kind } });
        }

        for (const member of group.members) {
          const existing = await tx.studentDiscount.findFirst({
            where: {
              tenantId,
              studentId: member.studentId,
              discountTypeId: type.id,
              status: { in: ['PENDING', 'APPROVED'] },
            },
          });
          if (existing) {
            skipped += 1;
            continue;
          }
          const discount = await tx.studentDiscount.create({
            data: {
              tenantId,
              studentId: member.studentId,
              discountTypeId: type.id,
              value: composed.value,
              snapshotValue: composed.value,
              relationApplied: composed.relationType,
              status: 'PENDING',
            },
          });
          await this.audit(tx, tenantId, 'SIBLING_DISCOUNT_SYNCED', 'StudentDiscount', discount.id, userId);
          created += 1;
        }
      }
      return { created, skipped, groupsScanned: groups.length };
    });
  }

  // -------------------------------------------------------------------------
  // Family-condition discounts (sensitive)
  // -------------------------------------------------------------------------

  private mapFamily(d: any, canViewReason: boolean) {
    return {
      id: d.id,
      studentId: d.studentId,
      studentName: d.student ? this.fullName(d.student) : '',
      valueType: d.valueType,
      value: num(d.value),
      reason: canViewReason ? d.reason : null,
      status: lower(d.status),
      approvedBy: d.approvedBy,
      recordedBy: d.recordedBy,
      createdAt: iso(d.createdAt),
    };
  }

  async listFamilyConditions(tenantId: string, canViewReason: boolean) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const rows = await tx.familyConditionDiscount.findMany({
        where: { tenantId },
        include: { student: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 300,
      });
      return rows.map((d: any) => this.mapFamily(d, canViewReason));
    });
  }

  async createFamilyCondition(
    tenantId: string,
    userId: string,
    dto: { studentId: string; valueType: DeductionValueType; value: number; reason: string },
  ) {
    const amount = Number(dto.value);
    if (!(amount >= 0) || (dto.valueType === 'PERCENTAGE' && !(amount <= 100))) {
      throw new BadRequestException('Value must be >= 0 (percentage <= 100)');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: dto.studentId, tenantId } });
      if (!student) throw new NotFoundException('Student not found');
      const d = await tx.familyConditionDiscount.create({
        data: {
          tenantId,
          studentId: dto.studentId,
          valueType: dto.valueType,
          value: dto.value,
          reason: dto.reason,
          recordedBy: userId,
        },
        include: { student: { select: { firstName: true, lastName: true } } },
      });
      await this.audit(tx, tenantId, 'FAMILY_CONDITION_RECORDED', 'FamilyConditionDiscount', d.id, userId);
      return this.mapFamily(d, true);
    });
  }

  async approveFamilyCondition(tenantId: string, userId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const d = await tx.familyConditionDiscount.findFirst({ where: { id, tenantId } });
      if (!d) throw new NotFoundException('Record not found');
      if (d.status !== 'PENDING') throw new BadRequestException('Only pending records can be approved');
      await tx.familyConditionDiscount.update({ where: { id }, data: { status: 'APPROVED', approvedBy: userId } });
      await this.audit(tx, tenantId, 'FAMILY_CONDITION_APPROVED', 'FamilyConditionDiscount', id, userId);
      // Bridge: an approval materialises the payment-time eligibility row
      // (generic label only — the hardship reason is never copied).
      await bridgeFamilyConditionApproval(tx, tenantId, {
        id: d.id,
        studentId: d.studentId,
        valueType: d.valueType as 'PERCENTAGE' | 'FIXED_AMOUNT',
        value: d.value,
        reason: d.reason,
      });
      return { id, status: 'approved' };
    });
  }

  async rejectFamilyCondition(tenantId: string, userId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const d = await tx.familyConditionDiscount.findFirst({ where: { id, tenantId } });
      if (!d) throw new NotFoundException('Record not found');
      if (d.status !== 'PENDING') throw new BadRequestException('Only pending records can be rejected');
      await tx.familyConditionDiscount.update({ where: { id }, data: { status: 'REJECTED' } });
      await this.audit(tx, tenantId, 'FAMILY_CONDITION_REJECTED', 'FamilyConditionDiscount', id, userId);
      return { id, status: 'rejected' };
    });
  }

  async recordFamilyConditionView(tenantId: string, userId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      this.audit(tx, tenantId, 'FAMILY_CONDITION_VIEWED', 'FamilyConditionDiscount', tenantId, userId),
    );
  }
}
