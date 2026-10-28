import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { PlatformRoleGuard, PlatformRoles } from '../platform/platform-role.guard';
import { InquiriesService } from './inquiries.service';
import { ListInquiriesDto, UpdateInquiryDto } from './dto/inquiries.dto';

/**
 * Console CRUD for the landing intake. Read/update/delete are guarded by
 * the platform gates — the public half of this table is served by
 * PublicInquiriesController under public/inquiries and stays @Public().
 */
@ApiTags('Inquiries')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('inquiries')
export class InquiriesController {
  constructor(private inquiriesService: InquiriesService) {}

  @Get()
  @ApiOperation({ summary: 'List landing inquiries (filterable)' })
  list(@Query() query: ListInquiriesDto) {
    return this.inquiriesService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one landing inquiry' })
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.inquiriesService.one(id);
  }

  @Patch(':id')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN', 'SUPPORT')
  @ApiOperation({ summary: 'Update inquiry status/subject' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateInquiryDto) {
    return this.inquiriesService.update(id, input);
  }

  @Delete(':id')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN', 'SUPPORT')
  @ApiOperation({ summary: 'Delete a landing inquiry' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.inquiriesService.remove(id);
  }
}