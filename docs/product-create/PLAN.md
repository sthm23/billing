# Product create / edit on mobile — plan

> Created 2026-11-14. Design: claude.ai artifact LBqDuZU3wDgKNJXJBfrAYb, page «Товары» — artboards
> `ProductNew` (step 1, card), `ProductVariants` (step 2, variants), `ProductScan` (barcode scanner).
> Affected: `billing` (backend), `billing-mobile`. Web (`billing_ui`) keeps working unchanged.

## Decisions (user, 2026-11-14)

1. **Two requests, like the web.** «Далее: варианты» on step 1 sends `POST /product` (card is created);
   step 2 sends `POST /product/variants`.
2. **Draft = a product card without variants.** Opening such a product goes straight to step 2.
3. **Brand is required** (the design's «Без бренда» is a mistake).
4. **Manual barcode.** A variant may get the product's own (factory) barcode, typed or scanned, if it is
   free; empty → auto-generated as today. Uniqueness becomes **per store** (`@@unique([storeId, barCode])`)
   so two stores can sell the same EAN product. Docs rule "barcode is global and never set manually" changes.
5. **Attribute values** («+ размер», «+ значение») can be created by the **store OWNER and ADMIN**
   (find-or-create in the shared dictionary). Attributes themselves stay ADMIN-only. MANAGER creates
   products but does not see the «+» for values.
6. **Tags** will be reworked like categories — separate discussion, not in this task.
7. **No colour swatches** — values are shown as plain words («Белый»).
8. **Photos follow the backend**: max 5 photos, 5 MB per file after compression (design's «6 / 4 МБ» is wrong).
9. **Variant rules on save:**
   - qty, cost and sale price all empty → the variant is not in stock → **dropped** from the request;
   - cost + sale price filled, qty 0 → **created** (future goods; stock comes later via «Приход»);
   - cost + sale price + qty > 0 → created with stock (Inventory + StockMovement PURCHASE, as today).
10. **Rental**: not on this form. Variants are created with defaults (`canSell = true`, `canRent = false`);
    rent settings are made in the existing rental product card (`RentalProductForm`).
11. **Edit** of the product card is done in this task as a **separate stage**.
12. **Who** (2026-11-14): **create a product** (`POST /product`) — store OWNER and ADMIN only (MANAGER
    removed). MANAGER may **edit** an existing product card and **add variants** to it. Variant count
    decrease — see open question Q1.
13. P1, P3, P5, P6 confirmed. P4 changed: a qty-0 variant **does** get a StockMovement (see P4).

## Open questions

- **Q1.** «Менеджер может добавить/уменьшить кол-во вариантов» — means removing variants, or changing stock
  of variants (already done via «Приход / Списание»)? Variant removal does not exist today; a variant with
  sales/returns/rentals cannot be hard-deleted (FK + history) → would need an archive flag on ProductVariant.

## Proposed (P1, P3, P5, P6 confirmed; P2 pending)

- **P1. Draft in the UI.** Product list shows a «Черновик» badge on products with 0 variants; tapping opens
  step 2. Drafts are visible to OWNER/MANAGER only (sellers can't do anything with them) and are excluded
  from the «Мало» filter. Deleting a draft = the existing archive. Step-2 input that was not saved is not
  kept (no local storage) — the card is already on the server, that is enough.
- **P2. Tags until the rework.** Step 1 shows existing tag values as a flat chip list (`tagIds` may be empty);
  «+ Новый тег» is hidden. No tag model/API changes now.
- **P3. Partially filled variant** (e.g. sale price without cost, or qty without prices) → inline error on
  that variant, save disabled. Not dropped silently.
- **P4. qty 0 variant** (decided): Inventory row with 0 **and** a StockMovement IN/PURCHASE with
  `quantity = 0` and the entered `unitCost` — the cost is kept. Consequences: sums of qty / qty×cost are
  unaffected; reports that count receipt operations or average `unitCost` without weighting must filter
  `quantity > 0`; stock history shows this row as «Создан без остатка · приход X» (not «+0 шт»);
  `costAtSale` (latest IN with cost) is unaffected because a sale needs stock, i.e. a later real receipt.
  Manual receipts (`POST /warehouse/stock-in`, `@Min(1)`) stay ≥ 1.
- **P5. «Изменить» on step 2 / back from step 2** opens step 1 in edit mode (`PATCH /product/:id`) —
  available once stage 4 is done; until then the step-2 header card has no «Изменить».
- **P6. Attributes after variants exist** cannot be changed (they define the variants); in edit mode the
  attribute chips are read-only when the product has variants.

## Stages

### Stage 1 — backend
- `ProductVariant`: migration `@@unique([barCode])` → `@@unique([storeId, barCode])`.
- `ProductVariantDto.barCode?` (optional): trimmed, digits only, length 8–14 (EAN-8/UPC/EAN-13/ITF-14);
  taken in the store → 409 with the barcode in the message; duplicate inside one request → 400;
  empty → `BarcodeService` as today. Generated codes (2000…) cannot clash with a stored manual code
  in the same store → check generated code against the store too.
- `POST /product/variants` validation: every `attributeValueId` belongs to one of the product's attributes;
  no two variants (incl. already existing ones) with the same value set; `quantity` integer ≥ 0;
  qty 0 → StockMovement with quantity 0 and unitCost (P4).
- `POST /product`: `@Roles(OWNER)` (ADMIN passes RolesGuard) — MANAGER removed. `POST /product/variants`
  stays OWNER + MANAGER (manager adds variants to existing products). Web «create product» for managers
  stops working — acceptable (web is being replaced).
- `POST /category/attribute/value`: AdminGuard → ADMIN or store OWNER, **find-or-create**
  (same value returns the existing row, 200), value trimmed, attribute must be on the owner's store
  (`AttributeOnStore`).
- `GET /product` list: `variantCount` (or `isDraft`) in the item for the badge; drafts hidden from sellers
  and from the «Мало» filter (P1).
- Specs for the above; `brandId` stays required.

### Stage 2 — mobile, step 1 «Карточка» (`ProductCreateScreen`)
- Form store (zustand) shared by both steps.
- Warehouse banner = current working warehouse.
- Photos: gallery/camera, compression (≤ 5 MB), `POST /image/upload` → presigned PUT with progress,
  first = «Главное», remove; max 5.
- Name, description, `CategorySheet` (exists), new `BrandSheet` (store brands), attribute chips
  (store attributes), tag chips (P2).
- Validation: name, category, brand. «Далее» → `POST /product` → step 2 with the product id.

### Stage 3 — mobile, step 2 «Варианты» (`ProductVariantsScreen`)
- Values per selected attribute (`GET /category/attributes/items`): chips; NUMBER attribute → number input;
  «+» sheet for OWNER → find-or-create value.
- Variants = all combinations of chosen values minus removed ones; no attributes → one variant.
- «Одинаково для всех» → apply qty/cost/price to all; per-variant card: qty, cost, price, margin badge
  (display only), remove, barcode input + scanner (reuse the expo-camera scanner).
- Save: drop empty variants, block on partial ones (P3), `POST /product/variants`; 409 → highlight the
  variant with that barcode. Success → product detail, toast, invalidate product queries.
- Entry points: «+» in the product list (OWNER/ADMIN only); draft products open step 2 for OWNER and
  MANAGER (P1).
- Stock history: qty-0 creation row rendered as «Создан без остатка» (P4).

### Stage 4 — edit the product card
- Backend: `PATCH /product/:id` (name, description, category, brand, tags, images add/remove/order/main;
  attributes only while there are no variants — P6), OWNER + MANAGER (manager: own warehouses) + ADMIN.
- Mobile: step 1 in edit mode (from product detail and from step 2 «Изменить»); adding variants to an
  existing product = step 2 with existing variants shown read-only.

### Stage 5 — finish
- i18n ru/uz/en, dark theme, loading/error/empty states, `tsc`, backend tests, device QA.
- `docs-updater`: `docs/features/products.md` (barcode rules, drafts, variant rules), `docs/api-map.md`,
  `billing/docs/DATABASE.md`.
