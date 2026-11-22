# Voice order assistant — design

> Created 2026-11-17. Status: **planned, not implemented**. Decisions below were agreed with the user
> in conversation (2026-11-09 … 2026-11-17); items marked **(proposed)** still need confirmation.
> Implementation stages: [PLAN.md](PLAN.md).
> UI design: claude.ai artifact `LBqDuZU3wDgKNJXJBfrAYb`, page «Голосовой заказ» (artboards `Voice*`,
> `OrderVoiceAdded`). Review of that design against this document: §10.
>
> Affected apps: `billing` (backend + a new local STT service), `billing-mobile`. **Not** `billing_ui`
> (web is being replaced by the Expo web build).

---

## 1. Goal

A seller collects an order faster: instead of searching products one by one, they **dictate or type the
list of products with their attributes** («shifer quvasoy, metrovka to'rtga ikki olti metrli, strapela»).
The backend finds the matching variants in the warehouse, the seller checks the list, and the lines go into
the **existing mobile cart**. From there everything is the existing sale flow.

```
Cart → 🎤 / ✍ → [transcribe] → text → [match] → review screen → «Добавить в корзину»
     → seller edits qty / price in the cart → «Сохранить» (CREATED → HOLD) → payment (DEBT / COMPLETED)
```

## 2. Decisions

| # | Decision |
|---|----------|
| 1 | **Mobile only** (`billing-mobile`), including its Expo web build. No `billing_ui` work. |
| 2 | Speech is **mostly Uzbek mixed with Russian**; Uzbek may come in Latin or Cyrillic. |
| 3 | The assistant collects **products + attributes only**. Every line is added with **quantity 1** and the catalogue price; the seller changes qty / price in the cart (existing rules: lowering a price = OWNER/MANAGER). |
| 4 | **No order is created by the assistant.** It only fills the client cart (`cart-store`). The order is created on cart save by the existing flow (`POST /orders` → `POST /orders/items`, CREATED → HOLD). **No new order status.** |
| 5 | Works for a new cart and for an open saved order (CREATED/HOLD) — lines are added to the same cart. |
| 6 | Ambiguous phrase (e.g. «strapela» without size, several variants) → show candidates, the seller picks one. |
| 7 | **No LLM in v1.** Text → candidates is deterministic: normalization + catalogue search + learned aliases. An LLM may be added later only as a re-ranker of our own candidates (§9). |
| 8 | Store, staff — from the JWT. `warehouseId` comes from the client (working warehouse) and is **validated via `StaffOnWarehouse`**. Nothing store-/staff-related is read from the request body. |
| 9 | Speech-to-text is a **self-hosted Uzbek fine-tuned Whisper** (faster-whisper, int8, CPU) on the same VPS, as a separate local service (§6). Final model chosen after the recording bake-off (PLAN stage 0). |
| 10 | Recordings may be stored **only with the store's consent** to improve the STT model later (§7). Seller corrections always train the aliases (no audio needed). |
| 11 | Text input ships first (PLAN stages 1–2) — it needs no new infrastructure; voice is added on top. |

## 3. Scale and catalogue facts

- ~500 variants per store, search is scoped to **one warehouse** of the staff's store → the whole normalized
  catalogue of a warehouse fits in memory; no external search engine.
- Catalogue text is **multi-lingual and inconsistent** (local DB, 2026-11-11):
  product names in Uzbek Latin, often plural (`shiferlar`, `fonerlar`, `metrovka`);
  attribute values in Cyrillic (`Кувасой`, `Охангарон`), English (`Pine`, `Red`) or Uzbek (`Oq salafanli`);
  numeric attributes stored as numbers (`Length (m)=6`, `plywood=0.4`, `Number Size=36`);
  sizes as strings with Latin `x` (`Lumber Size=4x2`).
- Only sellable variants are candidates: `canSell = true`, product not archived, variant in the warehouse.

## 4. Matching pipeline (backend, no LLM)

Input: free text (typed or transcribed) + `warehouseId`. Output: lines with candidates.

1. **Segmentation** into phrases (one phrase = one product):
   text mode — new lines and commas/semicolons; voice — punctuation from Whisper, separators
   `va`, `и`, `keyin`, `yana`, `ещё`, and a boundary heuristic: a token that starts a known product name
   (or alias) opens a new phrase.
2. **Normalization** (same function for catalogue and phrase):
   - lower case; Uzbek Cyrillic → Latin (`ў→o'`, `қ→q`, `ғ→g'`, `ҳ→h`, `ш→sh`, `ч→ch`, …);
     apostrophe variants (`'`, `ʻ`, `ʼ`, `‘`) unified; Russian Cyrillic transliterated to Latin;
   - Uzbek suffixes stripped from words: `-lar`, `-ni`, `-ga`, `-da`, `-dan`, `-li`, `-lik`, `-ta`;
   - **number words → digits**, Uzbek and Russian (`bir…to'qqiz`, `o'n`, `yigirma`, `yuz`, `yarim`=0.5,
     `nol to'rt`=0.4; `один…`, `полтора`=1.5, …), plus STT spellings (`turt`, `tort`, `тўрт`);
   - dimension patterns → canonical form: `4 ga 2`, `to'rtga ikki`, `4 на 2`, `4×2`, `4*2` → `4x2`;
     `6 metr(li)`, `6 m`, `6 м` → length `6`.
3. **Candidate search** in the warehouse catalogue (cached per warehouse, invalidated on product/variant
   change):
   - exact hits first: SKU, barcode, **learned alias** (normalized phrase → variant);
   - product name: fuzzy (trigram similarity on normalized names, threshold tuned on the bake-off data);
   - attributes: **numbers and sizes match strictly** — a phrase with `4x6` never matches `4x8`;
     words match normalized attribute values. **No synonym dictionary** (user, 2026-11-17): catalogue names
     and attribute values are corrected in the DB to the words sellers actually say (e.g. `Pine` → the Uzbek
     word); remaining misses are covered by learned aliases.
4. **Classification** of each phrase:
   - `MATCHED` — one variant clearly best (all numbers in the phrase matched, name score above threshold,
     margin to the next candidate);
   - `AMBIGUOUS` — 2–5 variants fit (typical: size not said) → candidates sorted by score;
   - `NOT_FOUND` — nothing above threshold. The raw phrase is kept.
   `MATCHED` also returns the next candidates so the seller can switch («Изменить вариант»).
5. **Aliases (learning without AI).** When the seller confirms the review, the client reports what was chosen
   for each phrase (picked candidate, switched variant, found manually). The backend upserts
   `phrase → variantId` for the store; confirmed aliases win over fuzzy search next time.
   Only explicit confirmations are learned; aliases pointing to archived/foreign variants are ignored.

## 5. API (proposed contract)

All endpoints: JWT, any staff role allowed to create orders, store from the token, warehouse checked via
`StaffOnWarehouse`, rate-limited per staff (throttler). Module: `billing/src/order-assistant/`.

### `POST /order-assistant/match` — text → lines (read-only)

```json
// request
{ "warehouseId": "uuid", "text": "shifer quvasoy, metrovka to'rtga ikki olti metrli, strapela" }
// response
{
  "lines": [
    { "phrase": "shifer quvasoy", "status": "MATCHED",
      "candidates": [{ "variantId": "…", "productName": "shiferlar", "attributes": ["Кувасой"],
                       "sku": "…", "price": "52000", "stock": 40, "score": 0.93 }] },
    { "phrase": "strapela", "status": "AMBIGUOUS", "candidates": [ … ] },
    { "phrase": "kafel oq", "status": "NOT_FOUND", "candidates": [] }
  ]
}
```
Limits: text ≤ 2 000 chars, ≤ 30 phrases, ≤ 5 candidates per line. `stock` and `price` are informational;
the cart and `POST /orders/items` re-check them as today.

### `POST /order-assistant/transcribe` — audio → text (voice, stage 3)

`multipart/form-data`: `audio` (m4a/AAC or wav, mono 16 kHz, ≤ 60 s, ≤ 2 MB), `warehouseId`.
Response `{ "text": "…", "durationMs": 14200, "sampleId": "uuid|null" }`.
The warehouse vocabulary (product names + attribute values, normalized) is passed to the STT service as
`hotwords` / `initial_prompt`. Errors: `422` empty / not recognized, `429` STT queue full, `503` STT down
or timeout (30 s).

Two calls instead of one: text mode needs only `match`; the seller can edit the transcript and re-run
`match` without re-uploading audio; the client can show real steps («Речь распознана» → «Ищем на складе»).

### `POST /order-assistant/feedback` — learn aliases

```json
{ "warehouseId": "uuid", "sampleId": "uuid|null", "transcriptFinal": "…",
  "choices": [{ "phrase": "strapela", "variantId": "…", "source": "PICKED|CHANGED|MANUAL|ACCEPTED" }] }
```
Sent once on «Добавить в корзину». Every `variantId` must belong to the store and warehouse.
Fire-and-forget on the client (a failure never blocks adding to the cart).

## 6. STT service

- Python venv + `faster-whisper` (CTranslate2, `compute_type=int8`) + small FastAPI app, run as a
  **systemd service** on the existing VPS (the backend itself is not in Docker), bound to `127.0.0.1` only.
- Limits in the unit: `MemoryMax=1.5G`, `CPUQuota=150%`, `Nice=10` — STT must never starve NestJS / PostgreSQL
  (same 4 GB / 2 vCPU VPS). One job at a time (queue length ~3, then `429`).
- Model: start with **whisper-small Uzbek** (int8, ~1 GB RAM). Medium needs the planned +2–4 GB RAM.
  Candidates verified on Hugging Face (Apache-2.0): `OvozifyLabs/whisper-small-uz-v1`,
  `navai-uz/whisper-small-uzbek`, `navai-uz/whisper-medium-uzbek`, CTranslate2 builds such as
  `yuldashev222/whisper-small-uz-v1-ct2`. Choice after stage 0.
- Options: `vad_filter=True` (no hallucinated text on silence), `language="uz"`, hotwords from the warehouse
  vocabulary. Expected latency on 2 vCPU: ~5–15 s for 20–40 s of speech.
- NestJS talks to it through an adapter (`SttProvider` interface): moving STT to its own server or to a paid
  Uzbek API later is a config change.
- Before installing: check real free memory on the VPS (`free -h`); the cloud panel's "RAM 100%" is quota
  allocation, not usage.

## 7. Voice data (training) and privacy

- Per-store flag **`voiceDataConsent`** (off by default). Off → audio is discarded after transcription,
  only aliases are learned.
- On → a `VoiceSample` row per dictation: store, staff, warehouse, audio object key, duration, model,
  raw transcript, **seller-corrected transcript** (the review textarea — this is the training label),
  final choices. Audio goes to **object storage** (same provider as product photos), never into PostgreSQL.
- Retention: 12 months (proposed), then audio deleted.
- Voice is personal data; Uzbekistan's personal-data law requires storing citizens' data on servers in
  Uzbekistan — keep audio on local servers, do **not** send it to foreign APIs (Gemini, OpenAI, …) for
  training. User decision (2026-11-17): follow the law; no formal legal review for the first stores
  (the owner's acquaintances) — revisit consent wording and retention when expanding.
- Fine-tuning whisper-small makes sense from ~5–10 h of labeled audio; a rented GPU for a few hours.

## 8. Mobile behaviour

- Entry points (design): «Голос» in the cart's search row and a third action in the empty cart
  («Найти · Голос · Скан»).
- Bottom sheet with tabs **«Голос» / «Написать текстом»**; voice: tap to start, tap/«Готово» to stop,
  60 s max with timer; text: one line = one product.
- Review screen: editable transcript + «Искать заново», summary chips, rows `MATCHED` / `AMBIGUOUS` /
  `NOT_FOUND`, «Ещё» (dictate more, appended), «Добавить в корзину (N)».
- **Adding follows the cart rules** (`cart-store.addVariant`): a variant with stock 0 cannot be added
  (`outOfStock`); a variant already in the cart gets +1 unless that exceeds stock (`maxReached`).
  Such rows are shown as «не попадёт в корзину» before the seller taps the button.
- «Найти вручную» opens product search in **picker mode** with the phrase as the query; the chosen variant
  returns to the review row (and is reported as `MANUAL` to `feedback`).
- Audio is kept on the device until `transcribe` succeeds, so «Повторить» after a network error does not
  require re-recording.
- Requires a development build (`expo-audio` recording + microphone permission).

## 9. Later / out of scope

- Quantities and prices from speech (v1: qty 1, price from catalogue).
- Customer / discount by voice.
- LLM re-ranker: only if the stage 0/2 match rate is too low — the LLM gets the phrase and **our** top
  candidates (never the whole catalogue) and its answer is accepted only if the id is one of them.
- Streaming (live) transcription while speaking.

### Rejected alternatives (2026-11-22)

| Alternative | Why not (now) |
|---|---|
| **Train / fine-tune a model on the catalogue** | Catalogue changes daily (new products, prices, stock) — a trained model is stale at once. The catalogue is given as *context* instead: STT hotwords (§6) and the in-memory warehouse catalogue in the matcher (§4). |
| **Elasticsearch / OpenSearch** | Fuzzy "find similar" is needed, but at ~500 variants per warehouse it is solved by trigram similarity in memory or `pg_trgm`. ES is a separate JVM service (1–2 GB RAM on a 4 GB VPS), needs data sync, and still does not know Uzbek translit, suffixes or `to'rtga olti` → `4x6` — that normalization is ours either way. Revisit (or Meilisearch as a lighter option) at tens of thousands of variants per store. |
| **Embeddings / semantic search (pgvector)** | Would match different words with the same meaning (`taxta` ↔ `doska`), but Uzbek embedding quality is uncertain and it adds a model to run. Same need is covered by catalogue cleanup + learned aliases. Possible later. |
| **LLM with the whole catalogue in the prompt** | Works technically (~500 variants), but adds latency, per-request cost and sends catalogue data abroad. Kept only as a later re-ranker over our own candidates (§9). |

## 10. Design review (2026-11-17)

The artifact design fits the agreed flow (cart-based, review with three row types, text tab, qty/price
edited later, Uzbek examples). **#1–#7 were applied to the design on 2026-11-17** (artifact version 103):
recording shows only waveform + timer, processing shows «Речь распознана» → «Ищем товары…» without fake
progress, out-of-stock rows/candidates are marked «Не попадёт в корзину» and not counted (toast now
«Добавлено 4 товара»), stock badge «Мало · n» for n ≤ 5, pause hint, «Найти вручную» copy says the product
returns to the list, offline copy fixed. A separate picker-mode search artboard was not drawn — implement
it as the existing search screen with a prefilled query and a «Выбрать» action.

Issues found:

| # | Artboard | Issue | Change |
|---|----------|-------|--------|
| 1 | `VoiceRecording` | Shows **live transcript** while recording. Our STT transcribes the whole file after stop — no streaming. | Recording state: waveform + timer only; text appears on the review screen. |
| 2 | `VoiceProcessing` | Fake progress «Ищем на складе — 3 из 5» + progress bar. | Two real steps: «Распознаём речь…» (transcribe) → «Ищем товары…» (match), indeterminate. Text mode shows only the second. |
| 3 | `VoiceReview` | Row with **«Нет в наличии»** (foner, stock 0) is counted in «Добавить в корзину (5)». The cart rejects out-of-stock. | Out-of-stock rows: badge «Нет в наличии — не попадёт в корзину», excluded from N, included in the bottom warning. |
| 4 | `VoiceReview` | Stock badge «Осталось n» for n ≤ 3; the app's «Мало» rule is ≤ 5. | Use the same threshold (≤ 5) as the product list. |
| 5 | `VoiceRecord` (idle hint) | «Называйте товар и размер **через запятую**» — commas can't be spoken. | «Делайте короткую паузу между товарами». |
| 6 | `VoiceReview` → `OrderSearch` | «Найти вручную» leads to the normal search, which adds straight to the cart. | Picker mode: selection returns to the review row (needed for alias learning). |
| 7 | `VoiceReview` (offline) | «Текст сохранён — повторять запись не нужно» is true only after transcription. | Offline before transcription: «Запись сохранена — нажмите «Повторить»». |
| 8 | Mock data | Product names shown in Russian («Шифер», «Фанера»); real catalogue names are as entered (`shiferlar`). | No change needed — the screen shows catalogue names as they are. |
