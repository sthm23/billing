# Product archive + restore on mobile — plan

> Created 2026-11-23. Affected: `billing` (backend), `billing-mobile`. Web (`billing_ui`) keeps working:
> the new query param is optional and the new endpoint is additive. No designer mock-up: built from existing
> components (`Chip`, `Badge`/banner, `Button`, `Alert`).

## Problem

A product can be archived (`DELETE /product/:id` → `isArchived = true`), but mobile has no way to see archived
products or bring one back. The UI also calls archiving «Удалить товар», so users think the product is gone.

## Decisions (user, 2026-11-23)

1. **Where**: a chip **«Архив · N»** in the product list, next to «Все» / «Мало». Search and category chips work
   inside it.
2. **Who**: OWNER / MANAGER (same as archiving). A manager sees and restores only products of their own warehouses;
   the owner sees all of the store. Sellers, cashiers and warehouse staff never see the chip, and the backend
   returns 403 to them.
3. **Wording**: «Удалить товар» becomes **«В архив»** (button, dialog, toasts) in ru / uz / en.
4. **An archived card is read-only**: a «В архиве» banner, a **«Вернуть из архива»** button, and stock history.
   Sale / «В заказ», stock receipt / write-off, edit, add variants and change price are hidden on mobile **and
   rejected by the backend** (400).

## What exists

- `ProductService.remove()` sets `isArchived = true` (no un-archive anywhere).
- `GET /product` (`findAll`) always adds `{ isArchived: false }`; `counts: { all, lowStock }`.
- `GET /product/:id` returns archived products, with `isArchived`. Mobile `Product.isArchived` already exists.
- `PATCH /product/:id` rejects an archived product (400). **No archive check** in `createProductVariant`
  (`POST /product/variants`), the variant price update (`PUT /product/variants/:id`) or
  `WarehouseService.inventoryMovement` (`POST /warehouse/:id/inventory`). Today these can change an archived
  product if called directly.
- Orders (`POST /orders/items`), rentals and the voice assistant already reject archived products.
- SKU and barcode are unique per store **including archived variants** (`@@unique([storeId, sku])`,
  `@@unique([storeId, barCode])`), so a restore can never clash with another product.
- Stock is untouched by archiving, so a restored product comes back with the same quantities. Restore creates
  no `StockMovement` (it is not a stock change).

## Stages

### Stage 1 — backend: list + restore — DONE 2026-11-23
> `ProductListParams.archived`; `findAll` builds the scope once, then active / archived; `counts.archived` via
> `product.count` (managers only, else 0); `ProductService.restore()` + `PATCH /product/:id/restore`
> (404 / 403 / 400 not archived, returns `findOne`). Specs: product service 59 passing (7 new).
> `product.controller.spec.ts` fails on DI (no PrismaService mock) — pre-existing scaffold, untouched.
- `ProductListParams.archived?: boolean`.
  - `archived=true` → only `isArchived: true`; allowed only for `canManageProducts(user)` (OWNER / MANAGER /
    ADMIN), otherwise **403**. Same store / warehouse scope as now. Drafts (no variants) included: a deleted
    draft is restorable too.
  - `lowStock` is ignored when `archived=true`.
- `counts.archived` in the `GET /product` response: same search + category + `warehouseId`, archived only.
  Computed only for owner / manager / admin; `0` for others (the chip is hidden anyway).
- New `PATCH /product/:id/restore` — `@Roles(OWNER, StaffRole.OWNER, MANAGER)`, `assertWarehouseAccess`,
  404 if missing, 400 if not archived, sets `isArchived = false`, logs `Product restored`, returns the card
  (`findOne`), so the client can update the cache directly.
- Specs: list with `archived=true` (owner / manager scope / seller 403), `counts.archived`, restore
  (ok / not archived 400 / other warehouse 403 / other store 403).

### Stage 2 — backend: read-only archived card
- Reject with **400** `An archived product cannot be changed` (or reuse the existing PATCH message) in:
  - `createProductVariant` (`POST /product/variants`);
  - variant price update (`PUT /product/variants/:id`);
  - `WarehouseService.inventoryMovement` (`POST /warehouse/:id/inventory`): check every variant's product in the
    same transaction.
- Specs for each.

### Stage 3 — mobile: archive list
- `product.service.ts`: `archived` param in the list call, `restoreProduct(id)` (`PATCH /product/:id/restore`).
- `product.queries.ts`: `useRestoreProduct()`: invalidates the product list (both active and archived) and sets
  the card cache from the response. `useArchiveProduct()` also invalidates the archived list.
- `ProductListScreen`: chip «Архив · N» (`counts.archived`) only for `canManageProducts()`; selecting it turns off
  «Мало» (and the reverse). Empty state «В архиве нет товаров». `ProductCard` shows a muted «В архиве» badge.
- i18n ru / uz / en: `product.filters.archive`, empty state, restore texts; rename `product.archive.*`
  («Удалить» → «В архив», «Товар удалён» → «Товар перемещён в архив») and `product.deleteProduct`.

### Stage 4 — mobile: archived card
- `ProductDetailScreen` when `product.isArchived`:
  - «В архиве» banner at the top;
  - hide the sale block («В заказ», stepper), «+ вариант», the archive button, edit, receipt / write-off and
    rental actions on `ProductVariantCard`; keep «История»;
  - **«Вернуть из архива»** button (owner / manager) → confirm `Alert` → `useRestoreProduct` → toast «Товар
    возвращён» and the card switches to the normal mode in place.
- The archive icon changes from `Trash2` to an archive icon (`Archive` from lucide).
- `npm run type-check` + device QA: archive → see it in «Архив» → open → restore → it is back in «Все», in
  order search and the scanner.

### Stage 5 — docs
- `docs-updater`: `docs/features/products.md` (Archiving: restore, read-only, who), `docs/api-map.md`
  (`GET /product?archived`, `counts.archived`, `PATCH /product/:id/restore`, new 400s), `docs/security.md`
  (endpoint table), `billing-mobile/AGENTS.md` (`useRestoreProduct`, archive chip).

## Out of scope
- Web (`billing_ui`) archive screen: mobile replaces web.
- Permanently deleting a product and its S3 photos.
- Auto-archiving (for example, of zero-stock products).
