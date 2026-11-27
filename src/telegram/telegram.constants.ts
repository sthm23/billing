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

/** Public shop API (`/public/tg/:slug/*`, docs/telegram-shop/PLAN.md, stage 3). */
export const PUBLIC_SHOP = {
  /** `initData` older than this is refused (a Mini App session is short) */
  INIT_DATA_MAX_AGE_SEC: 24 * 60 * 60,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 30,
  MAX_ORDER_LINES: 50,
  MAX_ITEM_QUANTITY: 1000,
  /** Requests of one customer waiting for the store; more → 429 */
  MAX_PENDING_PER_USER: 5,
  /** Lines of the new-request message to the store (Telegram allows 4096 characters) */
  MAX_MESSAGE_LINES: 15,
  /** A request number is `max + 1`; a parallel request may take it first */
  NUMBER_RETRIES: 3,
} as const;

/** 403: the shop is switched off, suspended or its bot is paused. */
export const SHOP_UNAVAILABLE = 'SHOP_UNAVAILABLE';
/** 400: some lines are archived, not for sale or from another store. */
export const ITEMS_UNAVAILABLE = 'ITEMS_UNAVAILABLE';
/** 429: the customer already has too many requests waiting. */
export const TOO_MANY_PENDING_REQUESTS = 'TOO_MANY_PENDING_REQUESTS';

/** Staff side: requests from the Telegram shop (`/online-orders`, stage 4). */
export const ONLINE_ORDERS = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 50,
  MAX_REJECT_REASON: 300,
} as const;

/** 409: the request was already confirmed or rejected (by this or another employee). */
export const ONLINE_ORDER_ALREADY_HANDLED = 'ONLINE_ORDER_ALREADY_HANDLED';
/** 400: the chosen warehouse does not hold all the goods; `lines` says what is missing. */
export const INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK';

/**
 * What the shop's bot tells a customer after an employee handled the request. Both languages
 * in one message: the request does not keep the customer's language.
 */
export const CUSTOMER_TEXTS = {
  confirmed: (number: number, storeName: string): string =>
    `✅ Заявка №${number} принята. «${storeName}» свяжется с вами.\n\n` +
    `✅ №${number}-buyurtma qabul qilindi. «${storeName}» siz bilan bog‘lanadi.`,
  rejected: (number: number, reason: string | null): string =>
    `Заявка №${number} отклонена.${reason ? ` Причина: ${reason}` : ''}\n\n` +
    `№${number}-buyurtma rad etildi.${reason ? ` Sabab: ${reason}` : ''}`,
};
