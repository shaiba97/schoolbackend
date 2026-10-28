import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SupportContactsController } from './support-contacts.controller';
import { SupportContactsService } from './support-contacts.service';

@Module({
  imports: [PrismaModule],
  controllers: [SupportContactsController],
  providers: [SupportContactsService],
})
export class SupportContactsModule {}
