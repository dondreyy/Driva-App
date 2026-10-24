import { Module } from '@nestjs/common';
import { VettingController } from './vetting.controller';
import { VettingService } from './vetting.service';

@Module({
  controllers: [VettingController],
  providers: [VettingService],
})
export class VettingModule {}
