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
import { ClassesService } from './classes.service';
import { CreateSchoolClassDto, UpdateSchoolClassDto } from './dto/school-class.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination.dto';

@ApiTags('Classes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('classes')
export class ClassesController {
  constructor(private service: ClassesService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  createClass(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateSchoolClassDto,
  ) {
    return this.service.createClass(tenantId, dto);
  }

  @Get()
  findAllClasses(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.service.findAllClasses(tenantId, query.page, query.limit);
  }

  @Get(':id')
  findOneClass(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOneClass(tenantId, id);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  updateClass(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSchoolClassDto,
  ) {
    return this.service.updateClass(tenantId, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  deleteClass(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.deleteClass(tenantId, id);
  }
}
