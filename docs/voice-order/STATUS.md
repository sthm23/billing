# Voice order assistant — status and how to resume

> Last updated 2026-11-23. Read this first when coming back to the feature, then [DESIGN.md](DESIGN.md)
> (decisions) and [PLAN.md](PLAN.md) (stages). Server install: [STT_SERVICE.md](STT_SERVICE.md).

## Where we stopped

Stages 0–4 are **built**. The next work is **stage 5 (model improvement)**. It waits until stores with consent
have collected **~5–10 hours of recordings**. Check the amount with the export script (it prints the hours):

```bash
cd /var/www/billing && npx tsx tools/voice-export/export.ts /opt/sthm-stt/dataset          # labeled only
npx tsx tools/voice-export/export.ts /opt/sthm-stt/dataset --all                            # + unlabeled
```

Plan agreed with the user (2026-11-23): launch for **one store** first, collect real seller voices there,
then improve. The target is **≥ 70 %** of products found from speech; the seller adds the rest by hand.
Sellers are taught to name products one after another.

## Stage status

| Stage | What | State |
|---|---|---|
| 0 | STT bake-off on 3 real dictations | ✅ done: **medium-uz** (`AlexAnoshka/fast-whisper-uz-rubaistt-v2-medium-ct2`), **no hotwords** (they returned empty text). Score 10/11 products |
| 1 | Backend text matching + aliases + admin flag `orderAssistantEnabled` | ✅ done |
| 2 | Mobile text assistant (cart «Голос» → review screen → cart) | ✅ built, **device QA pending** |
| 3 | Voice: STT service + `POST /order-assistant/transcribe` + voice tab | ✅ built, **web QA passed**, **installed on the VPS 2026-11-24** (`install.sh`; model load 15.5 s), device QA pending |
| 4 | Voice data with consent (`voiceDataConsent`, `VoiceSample`, private bucket, 12-month retention, export) | ✅ built, **not tested against a real bucket**, device QA pending |
| 5 | Fine-tune on collected samples | ⏳ waiting for data |

Git: stages 0–3 were committed by the user (`2e38dfd`, `a86ab48`). The stage 4 changes were **not committed**
when this was written (check `git status` in `billing/` and `billing-mobile/`).

## Before the first real store (user's to-do)

1. Deploy the backend with all order-assistant migrations:
   - `20261122191124_voice_alias`
   - `20261122191509_store_order_assistant_flag`
   - `20261123172700_voice_samples`
2. Install the STT service on the VPS once: `sudo bash /var/www/billing/stt-service/install.sh`
   ([STT_SERVICE.md](STT_SERVICE.md) §2). It runs as a systemd service; the user decided against Docker. It needs
   about 1.5 GB `available` in `free -h`. Later updates come with `deploy.sh` (GitHub Actions).
   Voice 503 = the service is not installed, still loading, or slower than 90 s.
3. Create the **private** bucket `sthm-voice` and set `VOICE_S3_BUCKET_NAME` ([STT_SERVICE.md](STT_SERVICE.md) §6).
   Then check that consent on → a sample is saved, and consent off → it is deleted.
4. Admin store card: turn on «Голосовой помощник». The owner (or the admin) turns on «Сохранять записи голоса».
5. Device QA of stages 2–4. The app runs in Expo Go; the web build needs https for the microphone.

## Stage 5 — how to resume

1. Export the dataset on the server with `tools/voice-export/export.ts`.
   - `metadata.jsonl` has `text`, which is the seller-corrected `transcriptFinal` when `labeled: true`.
   - Unlabeled samples (raw transcript) need a manual check before training.
   - Labels are set only for single-recording sessions (DESIGN §7).
2. Keep the data in Uzbekistan. It is personal data: **never send it to foreign APIs or cloud training
   services**. Rent a GPU locally or check with the user first.
3. Fine-tune medium-uz (or compare with small) and convert it to CTranslate2 int8.
4. Re-run the stage 0 bench on held-out samples: `billing/tools/stt-bench/`, venv `voice-samples/.venv-bench`.
   Run Python with `-I`. PyAV must be `av<16`.
5. Switch only if the new model is better: `Environment=STT_MODEL=…` in the systemd unit.

## Open ideas (not planned, user asked only for advice)

- **Similar sounds in matching** (cheapest, recommended first). Example: «palavoy» did not match «polovoy»;
  word similarity was 0.714 against the `NAME_MIN` threshold of 0.72 in `engine/matcher.ts`.
  - Idea: compare a phonetic skeleton that folds the vowel and consonant pairs STT confuses — o/a, u/o', x/h,
    q/k, i/y.
  - Learned aliases already fix repeated cases after one «Найти вручную».
- **Alternative product names** entered by the owner (similar to aliases, filled in beforehand).
- **`initial_prompt`** with product names. Hotwords broke the output, but the prompt is softer — re-test it.
- **LLM re-ranker** — only if the above give < 70 %. It costs money per request, sends text abroad and adds
  latency; it needs a separate decision (DESIGN §9).

## Small gaps left from stage 2

- No «голос» badge on cart lines (design `OrderVoiceAdded`).
- «Искать заново» drops the seller's earlier picks.
- The «Голос» button appears only after the profile reloads (`/auth/me`).

## Things learned the hard way

- **axios multipart:** the shared instance sends `Content-Type: application/json`, so axios turned the
  `FormData` into JSON and the audio was lost (400). `transcribe` now sets `multipart/form-data` itself.
- **Whisper temperature fallback:** a 2.7 s clip took 135–158 s and hit the 90 s backend timeout (503). The fix
  is `temperature=0`, `condition_on_previous_text=False` and a token cap in `stt-service/app.py`. Do not remove
  them without timing short clips again.
- **expo-image-picker:** `microphonePermission: false` blocks RECORD_AUDIO on Android. It must be the text.
- **Recognition speed:** with 2 threads a recording takes about 11 s at minimum (Whisper always processes a
  30 s window); 24 s of speech takes about 20 s.

## Local development

```bash
# STT service (uses the bench venv)
cd billing/stt-service
../../voice-samples/.venv-bench/Scripts/python -m uvicorn app:app --host 127.0.0.1 --port 8090 --app-dir .
# backend: STT_URL=http://127.0.0.1:8090 (default); VOICE_S3_BUCKET_NAME unset → samples are not kept
```

Voice recordings for tests live in `c:\myFiles\sthm23\voice-samples\` (outside every git repo; never commit them).

## Key files

- **Backend** (`billing/src/order-assistant/`):
  - `engine/` — normalize, segment, matcher
  - `order-assistant.service.ts`
  - `stt.client.ts`
  - `voice-sample.service.ts`
  - `order-assistant.constants.ts`
- **STT service:** `billing/stt-service/app.py`
- **Tools:**
  - `billing/tools/stt-bench/` — bake-off
  - `billing/tools/voice-export/` — dataset export
- **Mobile** (`billing-mobile/src/screens/order/voice/`):
  - `VoiceInputSheet`, `use-voice-recorder`, `VoiceReviewScreen`, `voice-store`
  - API layer: `src/services/order-assistant/`
- **Consent UI** (mobile):
  - `screens/profile/StoreSettingsScreen.tsx` (owner)
  - `screens/admin/shops/AdminShopScreen.tsx` (admin)
- **Docs:**
  - `docs/api-map.md` → «Order Assistant Module»
  - `billing/docs/DATABASE.md` → «Order Assistant»
  - `docs/security.md`
