import { Module } from '@nestjs/common';
import { OrderAssistantController } from './order-assistant.controller';
import { OrderAssistantService } from './order-assistant.service';
import { SttClient } from './stt.client';
import { VoiceSampleService } from './voice-sample.service';

@Module({
  controllers: [OrderAssistantController],
  providers: [OrderAssistantService, SttClient, VoiceSampleService],
  // Store settings / admin store card: consent off → the store's samples are deleted
  exports: [VoiceSampleService],
})
export class OrderAssistantModule {}
