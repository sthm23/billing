import { Module } from '@nestjs/common';
import { OrderAssistantController } from './order-assistant.controller';
import { OrderAssistantService } from './order-assistant.service';

@Module({
  controllers: [OrderAssistantController],
  providers: [OrderAssistantService],
})
export class OrderAssistantModule {}
