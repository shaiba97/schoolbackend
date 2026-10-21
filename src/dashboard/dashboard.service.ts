import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getOverview(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const [students, teachers, attendanceSessions] = await Promise.all([
        tx.student.count({ where: { tenantId, status: 'ACTIVE' } }),
        tx.teacher.count({ where: { tenantId, status: 'ACTIVE' } }),
        tx.attendanceSession.findMany({
          where: {
            tenantId,
            attendanceDate: { gte: today, lt: tomorrow },
          },
          include: { records: true },
        }),
      ]);

      let present = 0;
      let total = 0;
      for (const session of attendanceSessions) {
        for (const r of session.records) {
          total++;
          if (r.status === 'PRESENT' || r.status === 'LATE') present++;
        }
      }

      const totalAttendance = await tx.attendanceRecord.count({ where: { tenantId } });
      const presentCount = await tx.attendanceRecord.count({
        where: { tenantId, status: { in: ['PRESENT', 'LATE'] } },
      });

      return {
        students,
        teachers,
        todayClasses: attendanceSessions.length,
        attendancePercentage: totalAttendance > 0
          ? Math.round((presentCount / totalAttendance) * 100)
          : 0,
      };
    });
  }
}
