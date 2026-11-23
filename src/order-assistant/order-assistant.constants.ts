/** Request limits of the order assistant (docs/voice-order/DESIGN.md §5). */
export const ORDER_ASSISTANT_LIMITS = {
  /** Characters of typed / transcribed text in one `match` */
  TEXT_LENGTH: 2000,
  /** Products (phrases) in one `match` */
  PHRASES: 30,
  /** Characters of one phrase sent back in `feedback` */
  PHRASE_LENGTH: 200,
} as const;

/** What the seller did with a review line; only corrections teach a new alias. */
export const FEEDBACK_SOURCE = {
  /** Picked one of the AMBIGUOUS candidates */
  PICKED: 'PICKED',
  /** Replaced the MATCHED variant with another candidate */
  CHANGED: 'CHANGED',
  /** Found the product with «Найти вручную» */
  MANUAL: 'MANUAL',
  /** Kept the MATCHED variant */
  ACCEPTED: 'ACCEPTED',
} as const;
export type FeedbackSource =
  (typeof FEEDBACK_SOURCE)[keyof typeof FEEDBACK_SOURCE];

/**
 * CHANGED / MANUAL create or reinforce an alias. PICKED / ACCEPTED only
 * reinforce an existing one: picking a size for a vague «strapela» is a
 * one-off choice, not a synonym.
 */
export const LEARNING_SOURCES: ReadonlySet<FeedbackSource> = new Set([
  FEEDBACK_SOURCE.CHANGED,
  FEEDBACK_SOURCE.MANUAL,
]);

const MINUTE_MS = 60_000;

/**
 * Per-user rate limit for both routes (throttler name `ip` from
 * `authThrottleOptions`, overridden here; `login` is skipped). Counted per
 * user id — sellers of one shop share an IP.
 */
export const ORDER_ASSISTANT_THROTTLE = {
  ip: {
    limit: 30,
    ttl: MINUTE_MS,
    getTracker: (req: Record<string, unknown>): string => {
      const user = req.user as { id?: string } | undefined;

      return user?.id ?? String(req.ip);
    },
  },
};

/** 403 error code: `Store.orderAssistantEnabled` is off (switched on by a platform admin). */
export const ORDER_ASSISTANT_DISABLED = 'ORDER_ASSISTANT_DISABLED';

/** `POST /order-assistant/transcribe` (docs/voice-order/DESIGN.md §5–6). */
export const TRANSCRIBE_LIMITS = {
  /** Upload size: 60 s of mono AAC / Opus is well under 1 MB */
  FILE_BYTES: 3 * 1024 * 1024,
  /**
   * Wait for the STT service (queue + recognition). Medium on 2 vCPU needs
   * ~15–25 s for 10–25 s of speech; 60 s of speech + a queue takes longer.
   */
  TIMEOUT_MS: 90_000,
} as const;

/** Mime types a phone or browser records (m4a/AAC, Opus in WebM/Ogg, WAV). */
export const TRANSCRIBE_MIME_TYPES: ReadonlySet<string> = new Set([
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/mpeg',
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'video/mp4',
  'video/webm',
]);

/** 422 error code: nothing was recognized in the audio (silence, noise). */
export const SPEECH_NOT_RECOGNIZED = 'SPEECH_NOT_RECOGNIZED';

/** Stored voice samples (stage 4, docs/voice-order/DESIGN.md §7). */
export const VOICE_SAMPLES = {
  /** Object key prefix in the voice bucket: voice/<storeId>/<yyyy-mm>/<id>.<ext> */
  KEY_PREFIX: 'voice',
  /** Audio and rows older than this are deleted */
  RETENTION_DAYS: 365,
  /** Retention sweep: first run after start, then daily (single PM2 instance) */
  SWEEP_DELAY_MS: 5 * MINUTE_MS,
  SWEEP_INTERVAL_MS: 24 * 60 * MINUTE_MS,
  /** Rows deleted per batch */
  BATCH: 200,
  /** Recordings of one review session reported in one `feedback` («Ещё» adds more) */
  PER_FEEDBACK: 10,
} as const;

/** File extension of a stored sample by mime type. */
export const VOICE_SAMPLE_EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'video/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};
