import { Module } from '@nestjs/common';
import { LocalStorageService } from './providers/local-storage.service';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';

@Module({
  controllers: [StorageController],
  providers: [LocalStorageService, { provide: StorageService, useExisting: LocalStorageService }],
  exports: [StorageService],
})
export class StorageModule {}
