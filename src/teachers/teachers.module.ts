import { Module } from '@nestjs/common';
import { TeachersController } from './teachers.controller';
import { TeachersMeController } from './teachers-me.controller';
import { TeachersMeService } from './teachers-me.service';
import { TeachersService } from './teachers.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { StaffAttendanceModule } from '../staff-attendance/staff-attendance.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ExamsModule } from '../exams/exams.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    StaffAttendanceModule,
    RealtimeModule,
    ExamsModule,
    NotificationsModule,
    AuthModule,
  ],
  // TeachersMeController must come first: Nest matches routes in registration
  // order, and `teachers/me/*` would otherwise fall into the generic
  // `teachers/:id` route (whose UUID pipe rejects `me` with a confusing 400).
  controllers: [TeachersMeController, TeachersController],
  providers: [TeachersMeService, TeachersService],
})
export class TeachersModule {}
