/** Address of a shop in the Mini App URL (docs/telegram-shop/PLAN.md). */
export const BOT_SLUG_PATTERN = /^[a-z0-9_-]{3,32}$/;

/** Token issued by @BotFather: `<bot id>:<secret>`. */
export const BOT_TOKEN_PATTERN = /^\d{5,15}:[A-Za-z0-9_-]{30,50}$/;

/** How long the link «receive requests here» stays valid. */
export const NOTIFY_CODE_TTL_MS = 15 * 60 * 1000;

export const TELEGRAM_API_TIMEOUT_MS = 10_000;

export const DEFAULT_TELEGRAM_API_URL = 'https://api.telegram.org';

/** Header Telegram sends with every webhook call (value = `secret_token` of setWebhook). */
export const WEBHOOK_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/** Text of the menu button next to the message field in the store's bot. */
export const MENU_BUTTON_TEXT = 'Магазин';

/** 403: the paid service is not switched on for the store (a platform admin does it). */
export const TELEGRAM_SHOP_DISABLED = 'TELEGRAM_SHOP_DISABLED';
/** 503: TELEGRAM_* variables are missing on the server. */
export const TELEGRAM_NOT_CONFIGURED = 'TELEGRAM_NOT_CONFIGURED';
/** 400: nobody pressed the «receive requests here» link yet. */
export const NOTIFY_CHAT_NOT_CONNECTED = 'NOTIFY_CHAT_NOT_CONNECTED';

export type BotLanguage = 'ru' | 'uz';

/** Texts the bot writes on its own (customers and the owner), by Telegram `language_code`. */
export const BOT_TEXTS: Record<
  BotLanguage,
  {
    greeting: (storeName: string) => string;
    openShop: string;
    notifyConnected: string;
    notifyExpired: string;
    test: (storeName: string) => string;
  }
> = {
  ru: {
    greeting: (storeName) =>
      `Добро пожаловать в «${storeName}»! Нажмите кнопку ниже, чтобы открыть каталог.`,
    openShop: 'Открыть магазин',
    notifyConnected: '✅ Готово: заявки клиентов будут приходить в этот чат.',
    notifyExpired:
      'Ссылка устарела. Создайте новую в приложении sthm: Профиль → Telegram-магазин.',
    test: (storeName) =>
      `✅ Тест sthm: бот подключён к магазину «${storeName}». Сюда будут приходить заявки.`,
  },
  uz: {
    greeting: (storeName) =>
      `«${storeName}» do‘koniga xush kelibsiz! Katalogni ochish uchun quyidagi tugmani bosing.`,
    openShop: 'Do‘konni ochish',
    notifyConnected: '✅ Tayyor: mijozlar buyurtmalari shu chatga keladi.',
    notifyExpired:
      'Havola eskirgan. sthm ilovasida yangisini yarating: Profil → Telegram-do‘kon.',
    test: (storeName) =>
      `✅ sthm testi: bot «${storeName}» do‘koniga ulandi. Buyurtmalar shu yerga keladi.`,
  },
};
