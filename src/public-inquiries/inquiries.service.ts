import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type InquiryStatus, type InquiryRegion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ListInquiriesDto, UpdateInquiryDto } from './dto/inquiries.dto';

const LIST_SELECT = {
  id: true,
  fullName: true,
  schoolName: true,
  email: true,
  phone: true,
  region: true,
  subject: true,
  message: true,
  status: true,
  ipAddress: true,
  createdAt: true,
} satisfies Prisma.InquirySelect;

export type ListInquiriesResult = {
  items: Prisma.InquiryGetPayload<{ select: typeof LIST_SELECT }>[];
  nextCursor: string | null;
};

/**
 * Platform-side read/update/delete over the landing page's intake table.
 * This is the operational half of PublicInquiriesService: the same table,
 * but every route sits behind PlatformAdminGuard and none of them are
 @Public(). */
@Injectable()
export class InquiriesService {
  constructor(private prisma: PrismaService) {}

  async list(query: ListInquiriesDto): Promise<ListInquiriesResult> {
    const limit = Math.min(Math.max(Number(query.limit ?? 25), 1), 100);

    const where: Prisma.InquiryWhereInput = {
      status: query.status as InquiryStatus | undefined,
      region: ((query.region && /\S/.test(query.region))
        ? (query.region as InquiryRegion)
        : undefined),
    };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { schoolName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { message: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
      ];
    }

    const items = await this.prisma.inquiry.findMany({
      where,
      select: LIST_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const nextCursor = items.length > limit ? (items.pop()?.id ?? null) : null;
    return { items, nextCursor };
  }

  async one(id: string) {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id },
      select: LIST_SELECT,
    });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    return inquiry;
  }

  async update(id: string, input: UpdateInquiryDto) {
    await this.one(id);
    return this.prisma.inquiry.update({
      where: { id },
      data: {
        status: input.status,
        subject: input.subject,
      },
      select: LIST_SELECT,
    });
  }

  async remove(id: string) {
    await this.one(id);
    await this.prisma.inquiry.delete({ where: { id } });
    return { id, deleted: true };
  }
}
