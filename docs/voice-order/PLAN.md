# Voice order assistant — implementation plan

> Created 2026-11-17. Design and decisions: [DESIGN.md](DESIGN.md). Status: **stage 1 done 2026-11-23**
> (backend, + admin flag `Store.orderAssistantEnabled`); **stage 2 built 2026-11-23** (mobile text assistant,
> device QA pending); stage 0 done (medium-uz, no hotwords); **stage 3 built 2026-11-23** (voice: STT service,
> `transcribe`, voice tab — web QA passed, device QA and server install pending); **stage 4 built 2026-11-23**
> (consent + stored samples — bucket setup on the server pending).
> Priority (user, 2026-11-17): launch the app and onboard ~10 stores first; stages 1–2 (text input) need no
> infrastructure and can ship any time; voice (stage 3+) after that.

Each stage ends with: `tsc` clean, tests run, device QA by the user, docs updated (`docs-updater`).

---

## Stage 0 — STT bake-off (parallel, no product code) — ✅ done 2026-11-23 (3 dictations): medium-uz, no hotwords

Tooling ready: `billing/tools/stt-bench/bench.py` (faster-whisper, venv in `voice-samples/.venv-bench`) and
`catalogue.ts` (hotwords + scoring through the stage 1 matcher on the local DB catalogue, optional in-memory
`catalogue-extra.json` for variants missing locally). Results and the decision in DESIGN §6 (the 30–50 recordings
were replaced by real shop recordings after the first store — re-run then). The dictations also fixed the
matcher: glued number words, STT commas mid-product, `va super`, `yo'q` correction (DESIGN §4.1).

    cd voice-samples
    .venv-bench/Scripts/python -I ../billing/tools/stt-bench/bench.py . results/hotwords-latin.json results/runN.json
    cd ../billing && npx tsx tools/stt-bench/catalogue.ts match yogoch ../voice-samples/results/runN.json ../voice-samples/catalogue-extra.json

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

## Stage 1 — Backend: text matching (`billing`) — ✅ done 2026-11-23

Done as planned, with these changes: catalogue loaded per request instead of a cache (item 4); added the
per-store flag `Store.orderAssistantEnabled` set by a platform admin in `POST` / `PATCH /admin/stores`
(DESIGN decision 12; migrations `20261122191124_voice_alias`, `20261122191509_store_order_assistant_flag`);
throttler 30 / min per user. Tests: `src/order-assistant/**/*.spec.ts` (engine on the real `yogoch`
catalogue + synthetic strapela sizes, service access / flag / feedback rules). Smoke-tested on the local DB.

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

## Stage 2 — Mobile: text assistant (`billing-mobile`) — ✅ built 2026-11-23, device QA pending

Done as planned (items 0–7). Code: `src/services/order-assistant/`, `src/screens/order/voice/`
(`voice-store.ts`, `VoiceInputSheet.tsx`, `VoiceReviewScreen.tsx`, `VoiceRowCard.tsx`), route
`(orders)/voice`, picker mode of `OrderSearchScreen` (`search?pick=<row>&q=<phrase>`), admin switch in
`AdminShopScreen` («Дополнительные функции» → «Голосовой помощник»). Notes:
- The sheet has no «Голос / Написать текстом» tabs yet — text only until stage 3.
- «Искать заново» replaces all rows (earlier picks are dropped); «Ещё» appends the new text to the transcript
  and matches only the new text.
- Out-of-stock candidates can't be picked; a picked variant that the cart would reject (stock 0, or all units
  already in the cart / in rows above) is marked «не попадёт в корзину» and not counted.
- The cart line has no «голос» badge (design `OrderVoiceAdded`) — not built.
- The seller sees «Голос» after the profile reloads (`GET /auth/me` on app start) once the admin switched the
  flag on; a stale button gets 403 → «Помощник выключен».
- `tsc` clean, `expo export --platform android` bundles; no test runner in the mobile app.

0. Admin: «Голосовой помощник» switch in the admin store card (`AdminShopScreen`, `useUpdateAdminStore`
   with `orderAssistantEnabled`); show «Голос» in the cart only when `user.staff.store.orderAssistantEnabled`.
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

## Stage 3 — Voice — ✅ built 2026-11-23, server install + device QA pending

Built: `billing/stt-service/app.py` (FastAPI, faster-whisper medium-uz int8, 127.0.0.1:8090, one job + queue 3 →
429, max 65 s / 3 MB, nothing stored; install `STT_SERVICE.md`), `src/order-assistant/stt.client.ts` +
`POST /order-assistant/transcribe` (timeout 90 s instead of 30 s — medium is slower), mobile voice tab in
`VoiceInputSheet` + `use-voice-recorder.ts`. Changes vs the plan: recognition runs inside the sheet (not on the
review screen) so «Не расслышали» / «Повторить» stay where the recording is; works on web too (MediaRecorder);
Expo Go is enough (`expo-audio` is in it) — no development build. Smoke-tested locally: backend → STT on the
real dictation 3 (23.5 s → 28 s, 5/6 products).

Backend / server:
1. STT service (DESIGN §6): FastAPI + faster-whisper, systemd unit with memory/CPU limits, `127.0.0.1`,
   health endpoint; install doc in `billing/docs/voice-order/STT_SERVICE.md`.
2. `SttProvider` adapter in NestJS (URL from env), `POST /order-assistant/transcribe` (multipart, size/duration
   limits, timeout 30 s, queue → `429`, down → `503`); no hotwords (stage 0).
3. Audio is not stored in this stage (deleted right after transcription).

Mobile:
4. `expo-audio` recording (m4a, mono, 16 kHz), microphone permission, development build.
5. Voice tab: idle, recording (waveform + timer, 60 s), denied, not heard (`VoiceRecord*`, `VoiceDenied`,
   `VoiceNotHeard`) with design fix #1, #5.
6. Flow: transcribe → show transcript → match; keep the file until transcribe succeeds («Повторить»).

## Stage 4 — Voice data collection (with consent) — ✅ built 2026-11-23, bucket + QA pending

Built: migration `20261123172700_voice_samples` (`Store.voiceDataConsent` + `…At` / `…ById`, `VoiceSample`),
`src/order-assistant/voice-sample.service.ts` (save to the private bucket `VOICE_S3_BUCKET_NAME`, label,
delete on withdrawal, daily sweep), `transcribe` → `sampleId`, `feedback` → `samples[]`, consent in
`PUT /store/:id` and `PATCH /admin/stores/:id`; the STT service also returns `model`. Mobile: owner switch in
`StoreSettingsScreen`, admin switch in `AdminShopScreen` (inline confirmation before deleting), seller notice
in the voice tab, `voice-store` keeps `sampleIds` and sends them in `feedback`. Export:
`billing/tools/voice-export/export.ts`. Changes vs the plan: retention is an in-process daily timer (no
scheduler package); `feedback` takes several samples (`«Ещё»`); the corrected text is a label only for a
one-recording session. Decisions: DESIGN §7. Not tested against the real bucket (no local S3) — check on the
server (STT_SERVICE.md §6).

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
