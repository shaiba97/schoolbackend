import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { GradingService } from './grading.service';
import { CreateGradingScaleDto, UpdateGradingScaleDto } from './dto/grading.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';

@ApiTags('Grading')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('grading')
export class GradingController {
  constructor(private service: GradingService) {}

  @Post('scales')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  createScale(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateGradingScaleDto,
  ) {
    return this.service.createScale(tenantId, dto);
  }

  @Get('scales')
  findAllScales(@CurrentTenant('tenantId') tenantId: string) {
    return this.service.findAllScales(tenantId);
  }

  @Get('scales/:id')
  findOneScale(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOneScale(tenantId, id);
  }

  @Put('scales/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  updateScale(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateGradingScaleDto,
  ) {
    return this.service.updateScale(tenantId, id, dto);
  }

  @Delete('scales/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  deleteScale(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.deleteScale(tenantId, id);
  }
}
