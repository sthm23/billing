import { createHmac, timingSafeEqual } from 'node:crypto';

/** The Telegram user who opened the Mini App. */
export interface TelegramWebAppUser {
  id: number;
  isBot: boolean;
  languageCode: string | null;
}

const HASH_FIELD = 'hash';

/**
 * Checks `Telegram.WebApp.initData` (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * the string is signed with a key made of the bot token, so only Telegram — acting for
 * this very bot — could have produced it. Returns the user, or null when the signature
 * is wrong, the data is too old or there is no user. Never throws on junk input.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number,
  nowMs: number = Date.now(),
): TelegramWebAppUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get(HASH_FIELD);
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete(HASH_FIELD);

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  const ageSec = nowMs / 1000 - authDate;
  // A date from the future (clock skew) is tolerated for a minute
  if (ageSec > maxAgeSec || ageSec < -60) return null;

  return parseUser(params.get('user'));
}

function parseUser(raw: string | null): TelegramWebAppUser | null {
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as {
      id?: unknown;
      is_bot?: unknown;
      language_code?: unknown;
    };
    if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id)) return null;

    return {
      id: user.id,
      isBot: user.is_bot === true,
      languageCode: typeof user.language_code === 'string' ? user.language_code : null,
    };
  } catch {
    return null;
  }
}
