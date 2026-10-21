import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsMeController } from './students-me.controller';
import { StudentsService } from './students.service';
import { StudentsMeService } from './students-me.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, StorageModule, AuthModule],
  // Order is load-bearing. Nest matches routes in registration order, so
  // StudentsMeController must precede StudentsController; otherwise
  // `students/:id` captures `students/me` and its ParseUUIDPipe rejects
  // "me" with a 400.
  controllers: [StudentsMeController, StudentsController],
  providers: [StudentsService, StudentsMeService],
  exports: [StudentsMeService],
})
export class StudentsModule {}
