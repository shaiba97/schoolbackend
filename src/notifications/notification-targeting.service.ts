import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EducationLevel } from '@prisma/client';

/**
 * Resolves notification targets (STUDENT, CLASS, GRADE, EDUCATION_LEVEL, SCHOOL_WIDE)
 * to the set of userIds that should receive the notification.
 */
@Injectable()
export class NotificationTargetingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve targetType + targetId to a list of userIds that should receive the notification.
   * Returns unique userIds to avoid duplicate deliveries.
   */
  async resolveTargetUserIds(
    tenantId: string,
    targetType: string,
    targetId: string | null,
  ): Promise<string[]> {
    const userIds = new Set<string>();

    const addGuardiansOfStudents = async (studentIds: string[]) => {
      if (studentIds.length === 0) return;
      const links = await this.prisma.studentGuardian.findMany({
        where: { tenantId, studentId: { in: studentIds } },
        include: { guardian: { select: { userId: true } } },
      });
      for (const link of links) {
        if (link.guardian?.userId) userIds.add(link.guardian.userId);
      }
    };

    switch (targetType) {
      case 'STUDENT':
        if (targetId) {
          const user = await this.prisma.student.findUnique({
            where: { id: targetId, tenantId },
            select: { userId: true },
          });
          if (user?.userId) userIds.add(user.userId);
          // A notice for one student also reaches their guardians.
          await addGuardiansOfStudents([targetId]);
        }
        break;

      case 'CLASS':
        if (targetId) {
          const enrollments = await this.prisma.studentEnrollment.findMany({
            where: { tenantId, classId: targetId, status: 'ACTIVE' },
            select: { studentId: true },
          });
          const studentIds = enrollments.map((e) => e.studentId);
          const students = await this.prisma.student.findMany({
            where: { id: { in: studentIds }, tenantId },
            select: { userId: true },
          });
          students.forEach((s) => s.userId && userIds.add(s.userId));
          await addGuardiansOfStudents(studentIds);
        }
        break;

      case 'GRADE':
        if (targetId) {
          const [educationLevel, grade] = targetId.split(':');
          if (educationLevel && grade) {
            const students = await this.prisma.student.findMany({
              where: {
                tenantId,
                educationLevel: educationLevel as any,
                grade: parseInt(grade, 10),
                status: 'ACTIVE',
              },
              select: { id: true, userId: true },
            });
            students.forEach((s) => s.userId && userIds.add(s.userId));
            await addGuardiansOfStudents(students.map((s) => s.id));
          }
        }
        break;

      case 'EDUCATION_LEVEL':
        if (targetId) {
          const students = await this.prisma.student.findMany({
            where: {
              tenantId,
              educationLevel: targetId as EducationLevel,
              status: 'ACTIVE',
            },
            select: { id: true, userId: true },
          });
          students.forEach((s) => s.userId && userIds.add(s.userId));
          await addGuardiansOfStudents(students.map((s) => s.id));
        }
        break;

      case 'SCHOOL_WIDE': {
        const memberships = await this.prisma.tenantMembership.findMany({
          where: { tenantId, status: 'ACTIVE' },
          select: { userId: true },
        });
        memberships.forEach((m) => userIds.add(m.userId));
        break;
      }

      default:
        break;
    }

    return [...userIds];
  }

  /**
   * Given a targetType and targetId, also return the corresponding room names
   * that should receive the notification.
   */
  async resolveTargetRooms(
    tenantId: string,
    targetType: string,
    targetId: string | null,
  ): Promise<string[]> {
    const userIds = await this.resolveTargetUserIds(tenantId, targetType, targetId);
    const rooms: string[] = [];

    // Map userIds to user rooms
    userIds.forEach((uid) => {
      rooms.push(`user:${uid}`);
    });

    // Add target-specific rooms
    switch (targetType) {
      case 'STUDENT':
        if (targetId) rooms.push(`user:${targetId}`);
        break;
      case 'CLASS':
        if (targetId) rooms.push(`class:${targetId}`);
        break;
      case 'GRADE':
        if (targetId) rooms.push(`grade:${targetId}`);
        break;
      case 'EDUCATION_LEVEL':
        if (targetId) rooms.push(`level:${targetId}`);
        break;
      case 'SCHOOL_WIDE':
        rooms.push('school-wide');
        break;
    }

    return [...new Set(rooms)];
  }
}