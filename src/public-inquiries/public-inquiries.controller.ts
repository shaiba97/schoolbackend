import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { CreatePublicInquiryDto } from './dto/create-public-inquiry.dto';
import { PublicInquiriesService } from './public-inquiries.service';

/**
 * Public intake for the marketing landing page's contact form. Deny-by-
 * default means this controller opts the route out of the JwtAuthGuard
 * with @Public(), like the rest of the auth-free surface. The global
 * ThrottlerGuard still rate-limits it.
 */
@ApiTags('Public Inquiries')
@Controller('public/inquiries')
export class PublicInquiriesController {
  constructor(private publicInquiriesService: PublicInquiriesService) {}

  @Public()
  @HttpCode(201)
  @ApiOperation({ summary: 'Submit a contact inquiry from the landing page' })
  @Post()
  async create(
    @Req() request: Request & { ip?: string },
    @Body() input: CreatePublicInquiryDto,
  ) {
    return this.publicInquiriesService.create(input, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
