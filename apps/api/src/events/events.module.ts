import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsGateway } from './events.gateway';
import { EventsService } from './events.service';

@Global()
@Module({
  imports: [AuthModule],
  providers: [EventsGateway, EventsService],
  exports: [EventsService],
})
export class EventsModule {}
