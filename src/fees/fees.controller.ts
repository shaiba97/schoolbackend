import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { FeesService } from './fees.service';
import {
  CreateFeeTypeDto, UpdateFeeTypeDto,
} from './dto/fee.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination.dto';

@ApiTags('Fees & Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('ADMIN', 'ACADEMIC_ADMIN')
@ApiSecurity('X-Tenant-Id')
@Controller('fees')
export class FeesController {
  constructor(private service: FeesService) {}

  @Post('types')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  createFeeType(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateFeeTypeDto,
  ) {
    return this.service.createFeeType(tenantId, dto);
  }

  @Get('types')
  findAllFeeTypes(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.service.findAllFeeTypes(tenantId, query.page, query.limit);
  }

  @Put('types/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  updateFeeType(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFeeTypeDto,
  ) {
    return this.service.updateFeeType(tenantId, id, dto);
  }

  @Delete('types/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  deleteFeeType(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.deleteFeeType(tenantId, id);
  }
}
