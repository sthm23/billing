import { createHmac } from 'node:crypto';
import { verifyInitData } from './init-data';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const OTHER_TOKEN = '987654321:ZZZdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const MAX_AGE = 24 * 60 * 60;
const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);
const AUTH_DATE = String(NOW / 1000 - 60);
const USER = JSON.stringify({
  id: 4242,
  first_name: 'Ali',
  language_code: 'uz',
});

/** Builds initData the way Telegram does (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). */
function sign(fields: Record<string, string>, token = TOKEN): string {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');

  return new URLSearchParams({ ...fields, hash }).toString();
}

const fields = (extra: Record<string, string> = {}) => ({
  auth_date: AUTH_DATE,
  query_id: 'AAH-abc',
  user: USER,
  ...extra,
});

describe('verifyInitData', () => {
  it('returns the user of correctly signed data', () => {
    expect(verifyInitData(sign(fields()), TOKEN, MAX_AGE, NOW)).toEqual({
      id: 4242,
      isBot: false,
      languageCode: 'uz',
    });
  });

  it('accepts the newer `signature` field: it is part of the signed text', () => {
    const data = sign(fields({ signature: 'abc_DEF-123' }));

    expect(verifyInitData(data, TOKEN, MAX_AGE, NOW)?.id).toBe(4242);
  });

  it('refuses data signed with another bot token (another shop)', () => {
    expect(
      verifyInitData(sign(fields(), OTHER_TOKEN), TOKEN, MAX_AGE, NOW),
    ).toBeNull();
  });

  it('refuses data with a changed field, e.g. someone else’s user id', () => {
    const params = new URLSearchParams(sign(fields()));
    params.set('user', JSON.stringify({ id: 1, first_name: 'Admin' }));

    expect(verifyInitData(params.toString(), TOKEN, MAX_AGE, NOW)).toBeNull();
  });

  it('refuses data with an added field', () => {
    const params = new URLSearchParams(sign(fields()));
    params.set('start_param', 'x');

    expect(verifyInitData(params.toString(), TOKEN, MAX_AGE, NOW)).toBeNull();
  });

  it('refuses old data and data from the far future, tolerates a little clock skew', () => {
    const old = sign(fields({ auth_date: String(NOW / 1000 - MAX_AGE - 10) }));
    const future = sign(fields({ auth_date: String(NOW / 1000 + 3600) }));
    const skewed = sign(fields({ auth_date: String(NOW / 1000 + 20) }));

    expect(verifyInitData(old, TOKEN, MAX_AGE, NOW)).toBeNull();
    expect(verifyInitData(future, TOKEN, MAX_AGE, NOW)).toBeNull();
    expect(verifyInitData(skewed, TOKEN, MAX_AGE, NOW)?.id).toBe(4242);
  });

  it('refuses a missing, short or non-hex hash and an empty string', () => {
    expect(verifyInitData('', TOKEN, MAX_AGE, NOW)).toBeNull();
    expect(
      verifyInitData(
        `auth_date=${AUTH_DATE}&user=${USER}`,
        TOKEN,
        MAX_AGE,
        NOW,
      ),
    ).toBeNull();
    expect(
      verifyInitData(`auth_date=${AUTH_DATE}&hash=abc`, TOKEN, MAX_AGE, NOW),
    ).toBeNull();
    expect(
      verifyInitData(`hash=${'z'.repeat(64)}`, TOKEN, MAX_AGE, NOW),
    ).toBeNull();
  });

  it('refuses signed data without auth_date or without a usable user', () => {
    const noDate = sign({ user: USER });
    const noUser = sign({ auth_date: AUTH_DATE });
    const badJson = sign({ auth_date: AUTH_DATE, user: '{not json' });
    const stringId = sign({
      auth_date: AUTH_DATE,
      user: JSON.stringify({ id: '4242' }),
    });

    expect(verifyInitData(noDate, TOKEN, MAX_AGE, NOW)).toBeNull();
    expect(verifyInitData(noUser, TOKEN, MAX_AGE, NOW)).toBeNull();
    expect(verifyInitData(badJson, TOKEN, MAX_AGE, NOW)).toBeNull();
    expect(verifyInitData(stringId, TOKEN, MAX_AGE, NOW)).toBeNull();
  });

  it('marks a bot account so the guard can refuse it', () => {
    const data = sign(
      fields({ user: JSON.stringify({ id: 7, is_bot: true }) }),
    );

    expect(verifyInitData(data, TOKEN, MAX_AGE, NOW)).toMatchObject({
      id: 7,
      isBot: true,
    });
  });
});
