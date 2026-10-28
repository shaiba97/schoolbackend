import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePublicInquiryDto } from './dto/create-public-inquiry.dto';

/**
 * The one write surfaces the unauthenticated marketing site performs:
 * persisting a prospective school's contact request. Nothing here reads
 * anything and nothing is returned beyond the id and a fixed receipt line,
 * so the endpoint cannot become an oracle for the catalogue or the
 * tenants behind it.
 */
@Injectable()
export class PublicInquiriesService {
  constructor(private prisma: PrismaService) {}

  async create(
    input: CreatePublicInquiryDto,
    context?: { ipAddress?: string; userAgent?: string },
  ) {
    const inquiry = await this.prisma.inquiry.create({
      data: {
        fullName: input.fullName,
        schoolName: input.schoolName,
        email: input.email,
        phone: input.phone,
        region: input.region,
        message: input.message,
        status: 'PENDING',
        ipAddress: context?.ipAddress?.slice(0, 64) || null,
      },
    });

    return {
      id: inquiry.id,
      received: true,
      message:
        'Thank you — our team will contact you within one working day.',
    };
  }
}
