import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicInquiriesController } from './public-inquiries.controller';
import { PublicInquiriesService } from './public-inquiries.service';
import { InquiriesController } from './inquiries.controller';
import { InquiriesService } from './inquiries.service';

@Module({
  imports: [PrismaModule],
  controllers: [PublicInquiriesController, InquiriesController],
  providers: [PublicInquiriesService, InquiriesService],
})
export class PublicInquiriesModule {}
