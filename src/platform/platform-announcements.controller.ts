import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformRoleGuard, PlatformRoles } from './platform-role.guard';
import { platformActor } from './platform-actor';
import { PlatformOpsService } from './platform-ops.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@ApiTags('Platform')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('platform/announcements')
export class PlatformAnnouncementsController {
  constructor(private platformOpsService: PlatformOpsService) {}

  @Get()
  list() {
    return this.platformOpsService.listAnnouncements();
  }

  @Post()
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  create(@Body() dto: CreateAnnouncementDto, @Req() request: Request) {
    return this.platformOpsService.createAnnouncement(dto, platformActor(request));
  }

  @Patch(':id')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnnouncementDto,
    @Req() request: Request,
  ) {
    return this.platformOpsService.updateAnnouncement(id, dto, platformActor(request));
  }
}
