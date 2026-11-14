# Product create / edit on mobile — plan

> Created 2026-11-14, all decisions final. Design: claude.ai artifact LBqDuZU3wDgKNJXJBfrAYb, page «Товары» —
> artboards `ProductNew` (step 1, card), `ProductVariants` (step 2, variants), `ProductScan` (scanner).
> Affected: `billing` (backend), `billing-mobile`. Web (`billing_ui`) keeps working (except manager create).

## Decisions (user, 2026-11-14)

1. **Two requests, like the web.** «Далее: варианты» on step 1 sends `POST /product` (card is created);
   step 2 sends `POST /product/variants`.
2. **Draft = product card without variants.** List shows a «Черновик» badge; tapping opens step 2.
   Drafts are visible to OWNER/MANAGER/ADMIN only (hidden from sellers) and excluded from the «Мало» filter.
   Delete a draft = existing archive. Unsaved step-2 input is not stored locally.
3. **Brand is required** (design's «Без бренда» is a mistake).
4. **Manual barcode.** A variant may get its own (factory) barcode, typed or scanned, if free in the store;
   empty → auto-generated as today. Uniqueness becomes **per store** (`@@unique([storeId, barCode])`).
5. **Attribute values** («+ значение») are created by the **store OWNER and ADMIN** (find-or-create in the
   shared dictionary). Attributes themselves stay ADMIN-only.
6. **Tags**: until the tags rework (separate discussion, «like categories») step 1 shows existing tag values
   as flat chips, optional, «+ Новый тег» hidden. No tag model/API changes.
7. **No colour swatches** — values are plain words.
8. **Photos follow the backend**: max 5, 5 MB per file after compression.
9. **Variant rules on save:**
   - qty, cost, sale price all empty → variant not in stock → **dropped** from the request;
   - partially filled (e.g. price without cost) → inline error on the variant, save blocked;
   - cost + sale price, qty 0 → **created** (future goods): Inventory 0, **no StockMovement**, the entered
     cost is not stored — it is recorded at the first «Приход» (receipt requires cost);
   - cost + sale price + qty > 0 → created with stock (Inventory + StockMovement PURCHASE, as today).
10. **Rental** not on this form: defaults `canSell = true`, `canRent = false`; rent is set in the existing
    rental product card.
11. **Roles:**
    - create product — store OWNER + ADMIN (MANAGER removed);
    - edit product card, add variants — OWNER + MANAGER (own warehouses) + ADMIN;
    - decrease stock — existing «Списание» (manager already allowed). No variant deletion.
12. **Attributes are locked once the product has variants.**
13. **«Изменить» on step 2** opens step 1 in edit mode — available after the edit stage (stage 4).
14. Edit of the product card is part of this task, as a separate stage.

## Stages

### Stage 1 — backend: create — DONE 2026-11-14
> Migration `20261114120000_barcode_per_store` (not applied to dev DB yet). Response of `POST /category/attribute/value` gains `value` and `created`; list items gain `isDraft`. Admin creating variants with qty > 0 → 400 (receipt needs a staff account). SKU now uses attribute values from the DB.
- Migration: `ProductVariant` `@@unique([barCode])` → `@@unique([storeId, barCode])`.
- `ProductVariantDto.barCode?`: trimmed, digits only, length 8–14; taken in the store → 409 (message names
  the code); duplicate within the request → 400; empty → `BarcodeService` (generated code also checked
  against the store).
- `POST /product/variants`: every `attributeValueId` belongs to one of the product's attributes; no two
  variants (incl. existing ones) with the same value set; `quantity` integer ≥ 0; qty 0 → Inventory 0,
  no StockMovement.
- `POST /product`: roles OWNER (+ ADMIN via RolesGuard), MANAGER removed. `brandId` stays required.
- `POST /category/attribute/value`: AdminGuard → ADMIN or store OWNER; find-or-create (existing → 200);
  value trimmed; for an OWNER the attribute must be on their store (`AttributeOnStore`).
- `GET /product` list: `variantCount` (or `isDraft`) per item; drafts hidden from sellers and from «Мало».
- Specs for all of the above.

### Stage 2 — mobile, step 1 «Карточка»
- Form store (zustand) shared by both steps.
- Warehouse banner = current working warehouse.
- Photos: gallery/camera, compression, `POST /image/upload` → presigned PUT with progress, first =
  «Главное», remove; max 5.
- Name, description, `CategorySheet` (exists), new `BrandSheet` (store brands), attribute chips (store
  attributes), tag chips (decision 6).
- Validation: name, category, brand. «Далее» → `POST /product` → step 2.
- «+ Новый товар» in the product list — OWNER/ADMIN only.

### Stage 3 — mobile, step 2 «Варианты»
- Values per selected attribute: chips; NUMBER attribute → number input; «+» sheet (OWNER/ADMIN) →
  find-or-create value.
- Variants = all combinations of chosen values minus removed; no attributes → one variant.
- «Одинаково для всех» → apply qty/cost/price to all; per-variant card: qty, cost, price, margin badge
  (display only), remove, barcode input + scanner (reuse expo-camera scanner).
- Save per decision 9; 409 → highlight the variant with that barcode. Success → product detail, toast,
  invalidate product queries.
- Drafts: «Черновик» badge in the list, tap → step 2 (OWNER/MANAGER/ADMIN).

### Stage 4 — edit
- Backend: `PATCH /product/:id` — name, description, category, brand, tags, images (add/remove/order/main);
  attributes only while there are no variants. OWNER + MANAGER (own warehouses) + ADMIN.
- Mobile: step 1 in edit mode (from product detail and «Изменить» on step 2); add variants to an existing
  product = step 2 with existing variants shown read-only.

### Stage 5 — finish
- i18n ru/uz/en, dark theme, loading/error/empty states, `tsc`, backend tests, device QA.
- `docs-updater`: `docs/features/products.md` (barcode per store + manual, drafts, variant rules, roles),
  `docs/api-map.md`, `billing/docs/DATABASE.md`, legacy `billing/docs/CLAUDE.md` barcode line.
