import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { TenantsModule } from './tenants/tenants.module';
import { TenantModule } from './common/tenant/tenant.module';
import { AcademicYearsModule } from './academic-years/academic-years.module';
import { MembershipsModule } from './memberships/memberships.module';
import { ClassesModule } from './classes/classes.module';
import { SubjectsModule } from './subjects/subjects.module';
import { TeachersModule } from './teachers/teachers.module';
import { StaffAttendanceModule } from './staff-attendance/staff-attendance.module';
import { StudentsModule } from './students/students.module';
import { ParentsModule } from './parents/parents.module';
import { AttendanceModule } from './attendance/attendance.module';
import { TimetableModule } from './timetable/timetable.module';
import { ExamsModule } from './exams/exams.module';
import { FeesModule } from './fees/fees.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { StorageModule } from './storage/storage.module';
import { DepartmentsModule } from './departments/departments.module';
import { RealtimeModule } from './realtime/realtime.module';
import { StaffModule } from './staff/staff.module';
import { ReceptionistModule } from './receptionist/receptionist.module';
import { FinanceModule } from './finance/finance.module';
import { TransportModule } from './transport/transport.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    PrismaModule,
    AuthModule,
    TenantsModule,
    TenantModule,
    AcademicYearsModule,
    MembershipsModule,
    ClassesModule,
    SubjectsModule,
    TeachersModule,
    StudentsModule,
    ParentsModule,
    StaffAttendanceModule,
    AttendanceModule,
    TimetableModule,
    ExamsModule,
    FeesModule,
    NotificationsModule,
    DashboardModule,
    StorageModule,
    DepartmentsModule,
    RealtimeModule,
    ReceptionistModule,
    StaffModule,
    FinanceModule,
    TransportModule,
    PlatformModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Deny by default: every route requires a bearer token unless it opts out
    // with @Public(). This is defence in depth against a future controller
    // shipping without @UseGuards — the defect that left StudentsController's
    // 24 staff routes reachable with no token at all.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
