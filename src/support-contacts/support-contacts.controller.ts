import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { PlatformRoleGuard, PlatformRoles } from '../platform/platform-role.guard';
import { SupportContactsService } from './support-contacts.service';
import { CreateSupportContactDto, UpdateSupportContactDto } from './dto/support-contact.dto';

/**
 * Regional support contacts directory (email/phone per market). Console
 * only: reads are open to platform admins, writes are SUPER_ADMIN gated.
 */
@ApiTags('Support Contacts')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('support-contacts')
export class SupportContactsController {
  constructor(private supportContactsService: SupportContactsService) {}

  @Get()
  @ApiOperation({ summary: 'List support contacts (filterable)' })
  list(
    @Query('region') region?: string,
    @Query('contactType') contactType?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.supportContactsService.list({ region, contactType, isActive });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one support contact' })
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.supportContactsService.one(id);
  }

  @Post()
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Create a support contact' })
  create(@Body() input: CreateSupportContactDto) {
    return this.supportContactsService.create(input);
  }

  @Patch(':id')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Update a support contact' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateSupportContactDto) {
    return this.supportContactsService.update(id, input);
  }

  @Delete(':id')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete a support contact' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.supportContactsService.remove(id);
  }
}
