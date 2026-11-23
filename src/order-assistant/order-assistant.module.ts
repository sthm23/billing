import { Module } from '@nestjs/common';
import { OrderAssistantController } from './order-assistant.controller';
import { OrderAssistantService } from './order-assistant.service';
import { SttClient } from './stt.client';

@Module({
  controllers: [OrderAssistantController],
  providers: [OrderAssistantService, SttClient],
})
export class OrderAssistantModule {}
