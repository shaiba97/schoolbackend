import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SupportContactsController } from './support-contacts.controller';
import { SupportContactsPublicController } from './support-contacts-public.controller';
import { SupportContactsService } from './support-contacts.service';

@Module({
  imports: [PrismaModule],
  controllers: [SupportContactsController, SupportContactsPublicController],
  providers: [SupportContactsService],
})
export class SupportContactsModule {}
