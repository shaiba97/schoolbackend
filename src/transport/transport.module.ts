import { Module } from '@nestjs/common';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';
import { PrismaModule } from '../prisma/prisma.module';
import { FinanceModule } from '../finance/finance.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [PrismaModule, FinanceModule, RealtimeModule],
  controllers: [TransportController],
  providers: [TransportService],
})
export class TransportModule {}
