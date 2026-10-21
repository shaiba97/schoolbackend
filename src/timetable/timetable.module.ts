import { Module } from '@nestjs/common';
import { TimetableController } from './timetable.controller';
import { SportTimetableController } from './sport-timetable.controller';
import { TimetableService } from './timetable.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TimetableController, SportTimetableController],
  providers: [TimetableService],
})
export class TimetableModule {}
