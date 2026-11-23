import {
  HttpStatus,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { SPEECH_NOT_RECOGNIZED } from './order-assistant.constants';
import { SttClient } from './stt.client';

describe('SttClient', () => {
  const config = {
    get: () => 'http://127.0.0.1:8090/',
  } as unknown as ConfigService;
  const logger = { warn: jest.fn() } as unknown as PinoLogger;
  const client = new SttClient(config, logger);
  const audio = {
    buffer: Buffer.from('x'),
    mimeType: 'audio/mp4',
    fileName: 'a.m4a',
  };
  const fetchMock = jest.spyOn(global, 'fetch');

  afterAll(() => fetchMock.mockRestore());

  const reply = (status: number, body: unknown = {}) =>
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status }),
    );

  it('posts the audio to /transcribe and returns the text', async () => {
    reply(200, { text: ' shifer ', durationMs: 900 });

    await expect(client.transcribe(audio)).resolves.toEqual({
      text: 'shifer',
      durationMs: 900,
    });
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8090/transcribe');
  });

  it('maps empty text and 422 to SPEECH_NOT_RECOGNIZED', async () => {
    reply(200, { text: '  ', durationMs: 900 });
    await expect(client.transcribe(audio)).rejects.toMatchObject({
      response: { code: SPEECH_NOT_RECOGNIZED },
    });

    reply(422);
    await expect(client.transcribe(audio)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('maps a busy queue to 429 and a down service to 503', async () => {
    reply(429);
    await expect(client.transcribe(audio)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(client.transcribe(audio)).rejects.toThrow(
      ServiceUnavailableException,
    );

    reply(500);
    await expect(client.transcribe(audio)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
