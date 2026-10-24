import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config';
import { FieldEncryption } from '../crypto/field-encryption';
import { createFileStorage, FILE_STORAGE } from './file-storage';
import { FilesController } from './files.controller';

@Global()
@Module({
  controllers: [FilesController],
  providers: [
    { provide: FILE_STORAGE, inject: [APP_CONFIG], useFactory: createFileStorage },
    FieldEncryption,
  ],
  exports: [FILE_STORAGE, FieldEncryption],
})
export class StorageModule {}
