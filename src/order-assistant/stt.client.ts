import {
  HttpException,
  HttpStatus,
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  SPEECH_NOT_RECOGNIZED,
  TRANSCRIBE_LIMITS,
} from './order-assistant.constants';

export interface Transcript {
  text: string;
  durationMs: number;
  /** Model that recognized it (kept with a voice sample), null if the service did not say */
  model: string | null;
}

export interface SttAudio {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

const DEFAULT_STT_URL = 'http://127.0.0.1:8090';

/**
 * Client of the local speech-to-text service (`billing/stt-service`, DESIGN §6).
 * The only place that knows where STT runs: moving it to another server or to a
 * paid Uzbek API is a change here + `STT_URL`. Audio is sent as is and kept nowhere.
 */
@Injectable()
export class SttClient {
  private readonly url: string;

  constructor(
    config: ConfigService,
    @InjectPinoLogger(SttClient.name)
    private readonly logger: PinoLogger,
  ) {
    this.url = (config.get<string>('STT_URL') ?? DEFAULT_STT_URL).replace(
      /\/+$/,
      '',
    );
  }

  async transcribe(audio: SttAudio): Promise<Transcript> {
    const form = new FormData();
    form.append(
      'audio',
      new Blob([new Uint8Array(audio.buffer)], { type: audio.mimeType }),
      audio.fileName,
    );

    let response: Response;
    try {
      response = await fetch(`${this.url}/transcribe`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(TRANSCRIBE_LIMITS.TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'STT service unavailable');
      throw new ServiceUnavailableException(
        'Speech recognition is unavailable, try again or type the order',
      );
    }

    if (response.ok) {
      const body = (await response.json()) as Partial<Transcript>;
      const text = body.text?.trim() ?? '';
      if (!text) throw this.notRecognized();

      return {
        text,
        durationMs: Number(body.durationMs) || 0,
        model: typeof body.model === 'string' ? body.model : null,
      };
    }

    const status = String(response.status);
    if (status === String(HttpStatus.UNPROCESSABLE_ENTITY)) {
      throw this.notRecognized();
    }
    if (status === String(HttpStatus.PAYLOAD_TOO_LARGE)) {
      throw new PayloadTooLargeException('Recording is too long');
    }
    if (status === String(HttpStatus.TOO_MANY_REQUESTS)) {
      throw new HttpException(
        'Speech recognition is busy, try again in a moment',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.logger.warn({ status: response.status }, 'STT service error');
    throw new ServiceUnavailableException(
      'Speech recognition is unavailable, try again or type the order',
    );
  }

  private notRecognized() {
    return new UnprocessableEntityException({
      code: SPEECH_NOT_RECOGNIZED,
      message: 'Speech not recognized',
    });
  }
}
