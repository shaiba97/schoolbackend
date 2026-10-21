import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationTargetingService } from './notification-targeting.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, RealtimeModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationTargetingService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
