import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { TelegramConfig } from './telegram.config';
import {
  NOTIFY_CODE_TTL_MS,
  TELEGRAM_NOT_CONFIGURED,
} from './telegram.constants';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';
const SIGNATURE_HEX_CHARS = 24;
const MS_PER_MINUTE = 60_000;
const NOTIFY_CODE_PATTERN = /^n([0-9a-z]{1,10})_([0-9a-f]{24})$/;

export interface NotifyCode {
  code: string;
  expiresAt: Date;
}

/**
 * Bot tokens are stored only encrypted (AES-256-GCM, key `TELEGRAM_TOKEN_KEY`):
 * a leaked database dump does not hand out the stores' bots. Also signs the
 * short-lived code of the «receive requests here» link, so it needs no table.
 */
@Injectable()
export class TokenCryptoService {
  constructor(private readonly config: TelegramConfig) {}

  /** `v1:<iv>:<auth tag>:<ciphertext>`, base64 parts. */
  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key(), iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

    return [
      VERSION,
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      data.toString('base64'),
    ].join(':');
  }

  /** Throws when the value was changed or encrypted with another key. */
  decrypt(stored: string): string {
    const [version, iv, tag, data] = stored.split(':');
    if (version !== VERSION || !iv || !tag || !data) {
      throw new Error('Unsupported token format');
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key(),
      Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** `n<expiry in minutes, base36>_<signature>`: fits the 64 chars of a `/start` parameter. */
  signNotifyCode(slug: string, now: number = Date.now()): NotifyCode {
    const expiryMinutes = Math.floor(
      (now + NOTIFY_CODE_TTL_MS) / MS_PER_MINUTE,
    );
    const expiry = expiryMinutes.toString(36);

    return {
      code: `n${expiry}_${this.signature(slug, expiry)}`,
      expiresAt: new Date(expiryMinutes * MS_PER_MINUTE),
    };
  }

  verifyNotifyCode(
    slug: string,
    code: string,
    now: number = Date.now(),
  ): boolean {
    const match = NOTIFY_CODE_PATTERN.exec(code);
    if (!match) return false;
    const [, expiry, signature] = match;
    if (now > parseInt(expiry, 36) * MS_PER_MINUTE) return false;
    const expected = Buffer.from(this.signature(slug, expiry));
    const given = Buffer.from(signature);

    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private signature(slug: string, expiry: string): string {
    return createHmac('sha256', this.key())
      .update(`notify|${slug}|${expiry}`)
      .digest('hex')
      .slice(0, SIGNATURE_HEX_CHARS);
  }

  private key(): Buffer {
    const key = this.config.tokenKey();
    if (!key) {
      throw new ServiceUnavailableException({
        code: TELEGRAM_NOT_CONFIGURED,
        message: 'Telegram shop is not configured on the server',
      });
    }

    return key;
  }
}
