import { PublicInquiriesService } from './public-inquiries.service';
import type { CreatePublicInquiryDto } from './dto/create-public-inquiry.dto';

const prismaMock = {
  inquiry: { create: jest.fn() },
};

const service = new PublicInquiriesService(prismaMock as never);

const INPUT: CreatePublicInquiryDto = {
  fullName: 'Amina Saeed',
  schoolName: 'Al-Manar Academy',
  email: 'amina@almanar.sd',
  phone: '+249912345678',
  region: 'SUDAN',
  message: 'We would like a quote for a school of about 800 students.',
};

describe('PublicInquiriesService', () => {
  it('persists the intake and returns its id with a fixed receipt line', async () => {
    prismaMock.inquiry.create.mockResolvedValue({
      id: 'inq-1',
      fullName: INPUT.fullName,
    });

    const result = await service.create(INPUT, { ipAddress: '1.2.3.4' });

    expect(result).toEqual({
      id: 'inq-1',
      received: true,
      message: 'Thank you — our team will contact you within one working day.',
    });
    expect(prismaMock.inquiry.create).toHaveBeenCalledWith({
      data: {
        fullName: 'Amina Saeed',
        schoolName: 'Al-Manar Academy',
        email: 'amina@almanar.sd',
        phone: '+249912345678',
        region: 'SUDAN',
        message: 'We would like a quote for a school of about 800 students.',
        status: 'PENDING',
        ipAddress: '1.2.3.4',
      },
    });
  });

  it('still answers when no request context is available', async () => {
    prismaMock.inquiry.create.mockResolvedValue({ id: 'inq-2' });

    await service.create(INPUT);

    expect(prismaMock.inquiry.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ status: 'PENDING', ipAddress: null }),
    });
  });
});
