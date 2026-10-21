import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { TransportService } from './transport.service';
import {
  AssignStudentDto,
  AssignStudentsBatchDto,
  ArriveStopDto,
  CreateRouteDto,
  CreateVehicleDto,
  ReplaceStopsDto,
  TransportListQueryDto,
  UpdateRouteDto,
  UpdateVehicleDto,
} from './dto/transport.dto';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Transport')
@ApiHeader({
  name: 'X-Tenant-Id',
  required: true,
  description: 'Tenant UUID for the current school',
})
@ApiBearerAuth()
@ApiSecurity('X-Tenant-Id')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('ADMIN', 'ACADEMIC_ADMIN', 'CUSTOM_ACADEMIC_ADMIN', 'TRANSPORT_COORDINATOR')
@Controller('transport')
export class TransportController {
  constructor(private service: TransportService) {}

  @Get('dashboard')
  getDashboard(@CurrentTenant('tenantId') tenantId: string) {
    return this.service.getDashboard(tenantId);
  }

  @Get('vehicles')
  listVehicles(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: TransportListQueryDto,
  ) {
    return this.service.listVehicles(tenantId, query);
  }

  @Get('vehicles/:id')
  getVehicle(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getVehicle(tenantId, id);
  }

  @Post('vehicles')
  createVehicle(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateVehicleDto,
  ) {
    return this.service.createVehicle(tenantId, dto);
  }

  @Patch('vehicles/:id')
  updateVehicle(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.service.updateVehicle(tenantId, id, dto);
  }

  @Delete('vehicles/:id')
  deleteVehicle(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.deleteVehicle(tenantId, id);
  }

  @Get('routes')
  listRoutes(@CurrentTenant('tenantId') tenantId: string) {
    return this.service.listRoutes(tenantId);
  }

  @Post('routes')
  createRoute(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateRouteDto,
  ) {
    return this.service.createRoute(tenantId, dto);
  }

  @Patch('routes/:id')
  updateRoute(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRouteDto,
  ) {
    return this.service.updateRoute(tenantId, id, dto);
  }

  @Delete('routes/:id')
  deleteRoute(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.deleteRoute(tenantId, id);
  }

  @Get('routes/:id/stops')
  getStops(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getStops(tenantId, id);
  }

  @Put('routes/:id/stops')
  replaceStops(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceStopsDto,
  ) {
    return this.service.replaceStops(tenantId, id, dto);
  }

  @Get('students')
  listTransportStudents(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: TransportListQueryDto,
  ) {
    return this.service.listTransportStudents(tenantId, query);
  }

  @Get('students/candidates')
  listAssignableStudents(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: TransportListQueryDto,
  ) {
    return this.service.listAssignableStudents(tenantId, query);
  }

  @Post('assignments')
  assignStudent(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: AssignStudentDto,
  ) {
    return this.service.assignStudent(tenantId, dto);
  }

  @Post('assignments/batch')
  assignStudentsBatch(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: AssignStudentsBatchDto,
  ) {
    return this.service.assignStudentsBatch(tenantId, dto);
  }

  @Delete('assignments/:studentId')
  unassignStudent(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.service.unassignStudent(tenantId, studentId);
  }

  @Post('routes/:id/trips')
  startTrip(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.startTrip(tenantId, id);
  }

  @Get('trips/:id')
  getTrip(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getTrip(tenantId, id);
  }

  @Post('trips/:id/arrive')
  recordArrival(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArriveStopDto,
  ) {
    return this.service.recordArrival(tenantId, id, dto.stopId);
  }

  @Post('trips/:id/complete')
  completeTrip(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.completeTrip(tenantId, id);
  }

  @Get('routes/:id/trips')
  listTrips(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.listTrips(tenantId, id);
  }
}
