import { Module } from '@nestjs/common';
import { ExamsController } from './exams.controller';
import { GradingController } from './grading.controller';
import { ExamTypesController } from './exam-types.controller';
import { HallsController } from './halls.controller';
import { SlotsController } from './slots.controller';
import { DutiesController } from './duties.controller';
import { ExamsService } from './exams.service';
import { GradingService } from './grading.service';
import { ExamTypesService } from './exam-types.service';
import { HallsService } from './halls.service';
import { ExamSchedulingService } from './exam-scheduling.service';
import { ExamRoomsService } from './exam-rooms.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [PrismaModule, StorageModule, RealtimeModule],
  controllers: [ExamsController, GradingController, ExamTypesController, HallsController, SlotsController, DutiesController],
  providers: [ExamsService, GradingService, ExamTypesService, HallsService, ExamSchedulingService, ExamRoomsService],
  exports: [ExamsService],
})
export class ExamsModule {}
