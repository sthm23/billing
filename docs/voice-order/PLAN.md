# Voice order assistant — implementation plan

> Created 2026-11-17. Design and decisions: [DESIGN.md](DESIGN.md). Status: **not started**.
> Priority (user, 2026-11-17): launch the app and onboard ~10 stores first; stages 1–2 (text input) need no
> infrastructure and can ship any time; voice (stage 3+) after that.

Each stage ends with: `tsc` clean, tests run, device QA by the user, docs updated (`docs-updater`).

---

## Stage 0 — STT bake-off (parallel, no product code)

Goal: pick the STT model with real data before writing the service.

1. User records **30–50 real dictations** of sellers on a phone, in the shop (noise included), with what was
   meant (product + variant) written next to each file.
2. Script (Python, `faster-whisper`, run locally — kept outside the repo or in `billing/tools/stt-bench/`):
   transcribe every file with 2–3 models (whisper-small-uz ct2, whisper-medium-uz ct2,
   large-v3-turbo-uz ct2), each **with and without** warehouse hotwords.
3. Optional baseline: the same files through one paid Uzbek API (trial quota).
4. Metrics per model: **share of phrases whose intended variant is the top candidate** (using the stage 1
   matcher once it exists, or manual check before that), latency on 2 vCPU, peak RAM.

Output: chosen model + settings, numbers recorded in DESIGN.md §6.

## Stage 1 — Backend: text matching (`billing`)

1. Module `src/order-assistant/` (controller, service, DTOs), registered in `app.module.ts`.
2. `normalize.ts` — pure functions: translit (uz-Cyrl/ru → Latin), apostrophes, suffix stripping, number
   words (uz/ru) → digits, dimension and length patterns. **Unit tests with the real catalogue examples**
   (`shiferlar`/`Кувасой`, `metrovka 4x2 6`, `fonerlar 0.4`, `strapela`).
3. `segment.ts` — phrase splitting (newlines, punctuation, separators, product-name boundary).
4. Warehouse catalogue cache: normalized variants (`canSell`, not archived) with name, attributes, price,
   stock; invalidated on product/variant/inventory writes (or short TTL).
5. Matcher: alias → SKU/barcode → fuzzy name + strict numbers → `MATCHED | AMBIGUOUS | NOT_FOUND`.
6. Prisma: `VoiceAlias { id, storeId, phrase (normalized), variantId, hits, lastUsedAt, createdById }`,
   `@@unique([storeId, phrase, variantId])` + migration. Read `billing/docs/DATABASE.md` first.
7. Endpoints `POST /order-assistant/match`, `POST /order-assistant/feedback` (DESIGN §5): JWT, store from
   token, `StaffOnWarehouse` check, variant ownership check in feedback, throttling, input limits.
8. Logging of match stats per request (counts by status, no texts in prod logs) to measure quality.
9. Tests: normalization, matcher (fixtures), controller access (foreign warehouse → 403, foreign variant in
   feedback → rejected).

## Stage 2 — Mobile: text assistant (`billing-mobile`)

1. Service + React Query hooks: `services/order-assistant/` (`match`, `feedback`).
2. Cart entry points: «Голос» button in the search row, third action in the empty state
   (design `VoiceCartFull`, `VoiceCartEmpty`). In this stage the sheet opens on the **text** tab; the voice
   tab is hidden until stage 3.
3. Sheet: text tab (`VoiceText`).
4. Review screen (`VoiceReview`, `VoiceReviewResolved`, `VoiceNoneFound`, loading, offline) with the design
   fixes from DESIGN §10 (#2–#7).
5. Add to cart through `cart-store` (`addVariant`, qty 1) respecting `outOfStock` / `maxReached`; toast
   «Добавлено N товаров» (`OrderVoiceAdded`); `feedback` fire-and-forget.
6. Product search **picker mode** for «Найти вручную» (query prefilled, returns the variant).
7. i18n keys (ru, uz if present), light/dark, Expo web check.

→ **Releasable**: text order assistant.

## Stage 3 — Voice

Backend / server:
1. STT service (DESIGN §6): FastAPI + faster-whisper, systemd unit with memory/CPU limits, `127.0.0.1`,
   health endpoint; install doc in `billing/docs/voice-order/STT_SERVICE.md`.
2. `SttProvider` adapter in NestJS (URL from env), `POST /order-assistant/transcribe` (multipart, size/duration
   limits, timeout 30 s, queue → `429`, down → `503`), hotwords from the warehouse catalogue cache.
3. Audio is not stored in this stage (deleted right after transcription).

Mobile:
4. `expo-audio` recording (m4a, mono, 16 kHz), microphone permission, development build.
5. Voice tab: idle, recording (waveform + timer, 60 s), denied, not heard (`VoiceRecord*`, `VoiceDenied`,
   `VoiceNotHeard`) with design fix #1, #5.
6. Flow: transcribe → show transcript → match; keep the file until transcribe succeeds («Повторить»).

## Stage 4 — Voice data collection (with consent)

1. `Store.voiceDataConsent` (default false) — set by OWNER in store settings (mobile) / ADMIN.
2. `VoiceSample` model + migration; audio upload to object storage (private bucket, store-prefixed key).
3. `transcribe` saves the sample when consent is on; `feedback` writes `transcriptFinal` + choices to it.
4. Retention job: delete audio older than 12 months.
5. Export script for a fine-tuning dataset (audio + `transcriptFinal`).

## Stage 5 — Model improvement (when ~5–10 h of samples exist)

1. Fine-tune the chosen Whisper on collected samples (rented GPU), convert to CTranslate2 int8.
2. Re-run the stage 0 benchmark on held-out samples; switch the model only if better.
3. If the match rate is still low: evaluate the LLM re-ranker (DESIGN §9) — separate decision.

---

## Resolved questions (user, 2026-11-17)

- Entry point is named **«Голос»** also in stage 2 (text only).
- **No synonym dictionary**: catalogue names / attribute values are fixed in the DB to the words sellers say
  (data cleanup before stage 2 QA); learned aliases cover the rest.
- Legal: follow the personal-data law (local storage, consent); no formal legal review for the first stores,
  revisit when expanding.
