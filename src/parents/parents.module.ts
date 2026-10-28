import { Module } from '@nestjs/common';
import { ParentsMeController } from './parents-me.controller';
import { ParentsMeService } from './parents-me.service';
import { WardGuard } from './ward.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { StudentsModule } from '../students/students.module';
import { AuthModule } from '../auth/auth.module';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [PrismaModule, StudentsModule, FinanceModule, AuthModule],
  controllers: [ParentsMeController],
  providers: [ParentsMeService, WardGuard],
})
export class ParentsModule {}
