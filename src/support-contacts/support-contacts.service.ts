import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, type ContactType, type InquiryRegion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateSupportContactDto, UpdateSupportContactDto } from './dto/support-contact.dto';

const LIST_SELECT = {
  id: true,
  contact: true,
  contactType: true,
  region: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupportContactSelect;

export type ListSupportContactsResult = {
  items: Prisma.SupportContactGetPayload<{ select: typeof LIST_SELECT }>[];
};

/** Console-only CRUD for the per-region support contacts directory. */
@Injectable()
export class SupportContactsService {
  constructor(private prisma: PrismaService) {}

  async list(query: { region?: string; contactType?: string; isActive?: string }) {
    const where: Prisma.SupportContactWhereInput = {
      region: ((query.region && /\S/.test(query.region))
        ? (query.region as InquiryRegion)
        : undefined),
      contactType: ((query.contactType && /\S/.test(query.contactType))
        ? (query.contactType as ContactType)
        : undefined),
      ...(query.isActive === undefined || query.isActive === '' ? {} : { isActive: query.isActive === 'true' }),
    };

    const items = await this.prisma.supportContact.findMany({
      where,
      select: LIST_SELECT,
      orderBy: [{ region: 'asc' }, { createdAt: 'desc' }],
    });
    return { items };
  }

  async one(id: string) {
    const supportContact = await this.prisma.supportContact.findUnique({
      where: { id },
      select: LIST_SELECT,
    });
    if (!supportContact) throw new NotFoundException('Support contact not found');
    return supportContact;
  }

  async create(input: CreateSupportContactDto) {
    return this.prisma.supportContact
      .create({ data: input, select: LIST_SELECT })
      .catch(this.translateConflicts);
  }

  async update(id: string, input: UpdateSupportContactDto) {
    await this.one(id);
    return this.prisma.supportContact
      .update({ where: { id }, data: input, select: LIST_SELECT })
      .catch(this.translateConflicts);
  }

  async remove(id: string) {
    await this.one(id);
    await this.prisma.supportContact.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** The (region, contact) pair is the only hard uniqueness rule here. */
  private translateConflicts(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'A contact with this address already exists in this region.',
      );
    }
    throw error as Error;
  }
}
