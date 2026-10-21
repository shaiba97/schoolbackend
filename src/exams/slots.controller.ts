import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ExamSchedulingService } from './exam-scheduling.service';
import { AssignDutyDto, SetSeatsDto, UpdateSlotDto } from './dto/scheduling.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';

@ApiTags('Exam Scheduling')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('slots')
export class SlotsController {
  constructor(private service: ExamSchedulingService) {}

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  updateSlot(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSlotDto,
  ) {
    return this.service.updateSlot(tenantId, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  deleteSlot(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.deleteSlot(tenantId, id);
  }

  @Get(':id/seats')
  listSeats(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.listSeats(tenantId, id);
  }

  @Put(':id/seats')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setSeats(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: SetSeatsDto,
  ) {
    return this.service.setSeats(tenantId, id, dto);
  }

  @Post(':id/duties')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  assignDuty(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: AssignDutyDto,
  ) {
    return this.service.assignDuty(tenantId, id, dto);
  }
}
