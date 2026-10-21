import { Module, forwardRef } from '@nestjs/common';
import { ReceptionistController } from './receptionist.controller';
import { ReceptionistService } from './receptionist.service';
import { StaffAttendanceModule } from '../staff-attendance/staff-attendance.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    forwardRef(() => StaffAttendanceModule),
    forwardRef(() => AttendanceModule),
    RealtimeModule,
    PrismaModule,
    AuthModule,
  ],
  controllers: [ReceptionistController],
  providers: [ReceptionistService],
  exports: [ReceptionistService],
})
export class ReceptionistModule {}
