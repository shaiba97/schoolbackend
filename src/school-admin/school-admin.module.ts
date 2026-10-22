import { Module } from '@nestjs/common';
import { SchoolAdminController } from './school-admin.controller';
import { SchoolAdminService } from './school-admin.service';

@Module({
  controllers: [SchoolAdminController],
  providers: [SchoolAdminService],
  exports: [SchoolAdminService],
})
export class SchoolAdminModule {}
