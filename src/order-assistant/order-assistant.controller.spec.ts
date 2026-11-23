import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { OrderAssistantController } from './order-assistant.controller';
import { OrderAssistantService } from './order-assistant.service';
import { TRANSCRIBE_LIMITS } from './order-assistant.constants';

const WAREHOUSE = '33333333-3333-4333-8333-333333333333';

/** Multipart parsing of `POST /order-assistant/transcribe` (guards are covered elsewhere). */
describe('OrderAssistantController transcribe', () => {
  let app: INestApplication;
  const service = { transcribe: jest.fn() };
  const allow = { canActivate: () => true };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OrderAssistantController],
      providers: [{ provide: OrderAssistantService, useValue: service }],
    })
      .overrideGuard(AuthJWTGuard)
      .useValue(allow)
      .overrideGuard(ThrottlerGuard)
      .useValue(allow)
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe()); // as in main.ts
    await app.init();
  });

  afterAll(() => app.close());

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  it('passes the audio file and warehouseId to the service', async () => {
    service.transcribe.mockResolvedValue({
      text: 'shifer',
      durationMs: 1,
      sampleId: null,
    });

    await request(server())
      .post('/order-assistant/transcribe')
      .field('warehouseId', WAREHOUSE)
      .attach('audio', Buffer.from('fake'), {
        filename: 'a.m4a',
        contentType: 'audio/mp4',
      })
      .expect(200, { text: 'shifer', durationMs: 1, sampleId: null });

    const [dto, file] = service.transcribe.mock.calls[0] as [unknown, unknown];
    expect(dto).toEqual({ warehouseId: WAREHOUSE });
    expect(file).toMatchObject({
      mimetype: 'audio/mp4',
      originalname: 'a.m4a',
      size: 4,
    });
  });

  it('rejects a bad warehouseId and a file over the limit before the service', async () => {
    service.transcribe.mockClear();
    await request(server())
      .post('/order-assistant/transcribe')
      .field('warehouseId', 'nope')
      .attach('audio', Buffer.from('fake'), {
        filename: 'a.m4a',
        contentType: 'audio/mp4',
      })
      .expect(400);
    await request(server())
      .post('/order-assistant/transcribe')
      .field('warehouseId', WAREHOUSE)
      .attach('audio', Buffer.alloc(TRANSCRIBE_LIMITS.FILE_BYTES + 1), {
        filename: 'a.m4a',
        contentType: 'audio/mp4',
      })
      .expect(413);
    expect(service.transcribe).not.toHaveBeenCalled();
  });
});
