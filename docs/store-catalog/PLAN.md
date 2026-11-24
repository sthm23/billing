# Store catalog — admin edits a store's brands and attributes (mobile)

Created 2026-11-24. Design: https://claude.ai/artifact/LBqDuZU3wDgKNJXJBfrAYb, page «Админ · магазины»,
rows «Каталог · бренды магазина» / «Каталог · атрибуты магазина» / «Каталог — тёмная тема»
(artboards `AdminShopCatalog`, `AdminShopBrands*`, `AdminShopAttributes*`, `AdminShopAttributeNew*`;
all screens are states of one component `AdminShopDict` with `kind` = brand | attr).

## Goal

Today brands and attributes of a store are chosen once, when the admin creates the store
(`POST /admin/stores`); the store card shows them read-only. The admin must be able to connect and
disconnect them later. The owner picks a product's brand and attributes only from the connected ones.

## Decisions (user, 2026-11-24)

- **Only the platform ADMIN** changes a store's catalog. The owner no longer can (the old path was
  `PUT /store/:id` from the retired Angular web) — catalog fields are dropped from that endpoint.
- **«Used in products»** = all products of the store, **including archived** (an archived product can be
  restored). A brand / attribute used in such products **cannot be disconnected** (sheet «Нельзя отключить»).
  The DB does not protect this: disconnect deletes only the `BrandsOnStore` / `AttributeOnStore` link row,
  which products don't reference — the backend checks it.
- Changes are saved immediately, per action (design: «Изменения сохраняются сразу»), no «Сохранить».
- New attribute sheet keeps the optional uz/en name fields (attribute names are translated since
  `docs/attribute-i18n`), although the design shows only the name.
- Brands and attributes stay global dictionaries; connecting by name is find-or-create (case-insensitive,
  attributes also by uz/en names), as `POST /admin/stores` does.

## Current state (code)

- `GET /admin/stores/:id` → `brands [{id,name}]`, `attributes [{id,name,nameUz,nameEn,type,unit}]`.
- `AdminStoresService.upsertBrands` / `upsertAttributes` — find-or-create used on store create.
- `PUT /store/:id` (OWNER + ADMIN) requires `brandIds` + `attributeIds` and replaces the whole set,
  no «used in products» check. Mobile «Настройки магазина» (owner) resends the current lists on every
  save → race: an admin change made while the owner's screen is open is silently reverted.
- Mobile: `AdminShopScreen` «Каталог» shows chips; `AttributeEditSheet` edits attribute translations;
  `NewShopSheets` has `BrandSheet` / `AttributeSheet` for the create form.

## Stages

### Stage 1 — backend
- `GET /admin/catalog/brands?search=` → `{ data: [{ id, name, storeCount }], total }`, sorted by
  storeCount desc, then name; search case-insensitive. ADMIN only.
- `GET /admin/catalog/attributes?search=` → `[{ id, name, nameUz, nameEn, type, unit, storeCount }]`,
  search by ru/uz/en name.
- `GET /admin/stores/:id`: connected brands / attributes get `productCount` (store products incl. archived).
- `POST /admin/stores/:id/brands { brandId } | { name }` → connect; by name = find-or-create.
  Already connected → 200, no error.
- `POST /admin/stores/:id/attributes { attributeId } | { newAttribute: { name, nameUz?, nameEn?, type, unit? } }`.
  A new name that already exists in the dictionary → 409 `ATTRIBUTE_EXISTS` with the existing attribute
  (`id, name, type, unit`) → client shows «уже есть в справочнике — Текст» + «Подключить его».
- `DELETE /admin/stores/:id/brands/:brandId`, `DELETE /admin/stores/:id/attributes/:attributeId` →
  409 `IN_USE` `{ count }` when used in the store's products (incl. archived).
- `PUT /store/:id`: remove `brandIds` / `attributeIds` (catalog is admin-only now); mobile store settings
  stops sending them.
- Specs.
> DONE 2026-11-24: `src/admin/admin-catalog.{service,controller}.ts` (+ spec), `dto/admin-catalog.dto.ts`;
> connect / disconnect routes in `AdminStoresController`; `findOrCreateBrand` / `findAttributeByName` shared with
> store create; `GET /admin/stores/:id` brands / attributes carry `productCount`. «Used» = store products
> (archived included) with the brand, or the attribute on the card (`ProductAttribute`) or in a variant value.
> `PUT /store/:id`: `brandIds` / `attributeIds` removed (an old client still sending them is ignored — the global
> ValidationPipe has no whitelist). tsc clean; admin + store specs green except the 2 old scaffold
> «should be defined» (`admin.service`, `admin.controller`).

### Stage 2 — mobile
- «Каталог» in `AdminShopScreen`: «Изменить» on «Бренды · N» and «Атрибуты товаров · N».
- Routes `(profile)/shops/[id]/brands`, `(profile)/shops/[id]/attributes` → one `StoreCatalogScreen`
  (`kind`).
- Connected list with «в N товарах» / «не используется», «Отключить» (lock when used → sheet
  «Нельзя отключить» with the count); dictionary «Справочник · N» with debounced search, «Часто подключают»,
  «Подключить» / «Подключаем» / «Подключён»; already-connected warning; «Ничего не найдено» +
  «Создать „…“» (brand: connect at once; attribute: new attribute sheet); «+ Новый бренд по названию» /
  «+ Новый атрибут»; toasts saved / error + «Повторить»; loading / error / empty states.
- New attribute sheet = the create-form `AttributeSheet` (+ uz/en) with the 409 «Подключить его» case.
- Tap on a connected attribute → existing `AttributeEditSheet` (translations).
- `StoreSettingsScreen` stops sending `brandIds` / `attributeIds`.
- i18n ru/uz/en, dark theme, `tsc`.

### Stage 3 — finish
- `docs-updater`: `docs/api-map.md`, `docs/security.md`, `docs/features/stores-warehouses.md`,
  `docs/features/products.md` (brand / attributes only from connected), `billing-mobile/AGENTS.md`.
- Device QA (user).
