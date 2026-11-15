# Orders list filter on mobile — plan

> Created 2026-11-15. Affected: `billing` (backend), `billing-mobile`. Web (`billing_ui`) keeps working —
> all new query params are optional. No designer mock-up: the sheet follows the existing STHM sheets.

## Decisions (user, 2026-11-15)

1. **Filters**: period, customer (search by name **or phone**), status.
2. **Date by tab**: «Активные» — by creation date (`createdAt`), «Завершённые» — by sale date (`soldAt`, same as
   «Продажи сегодня» and reports).
3. **Status inside the tab**: tabs stay. «Активные» → Создан / Бронь; «Завершённые» → Завершён / Долг /
   Возврат / «Должны клиенту» (return paid out later, CREDIT). Nothing picked = every status of the tab.
4. **A seller sees and opens every order of their warehouses** (read-only for someone else's order). Today the
   list shows them but `GET /orders/:id` lets a seller open only their own orders. Editing, paying and
   cancelling someone else's order stay owner/manager-only (`assertOrderAccess`, unchanged).
5. No design mock-up — built from existing components.

## What exists

- Backend `GET /orders` (`OrderService.findAll`, `OrderQueryParams`): `status` (comma list, not validated),
  `fromDate` / `toDate` (`createdAt`, inclusive), `warehouseId`, pages. `search` is accepted and **ignored**.
  No customer filter.
- Customer search exists: `GET /users/customers?search=` (name or phone) + `CustomerPickerSheet` (also creates
  customers — needs a pick-only mode).
- Mobile `OrderPage`: tabs + a **disabled** filter button; loads **only the first 10 orders** (no paging) —
  with filters the list must page.
- `DatePickerSheet` (one day, min/max) — reused for a custom period.

## Stages

### Stage 1 — backend
- `OrderQueryParams`:
  - `customerId?` (UUID) — combined with the store scope, so another store's customer finds nothing;
  - `dateBy?: 'created' | 'sold'` (default `created`) — which date `fromDate`/`toDate` apply to;
  - `owedToCustomer?: boolean` — orders whose return is CREDIT (store owes the customer);
  - `status` validated against `OrderStatus` (today an unknown value gives a Prisma error).
- `findOne`: SELLER / CASHIER / WAREHOUSE — orders of their warehouses (was: only orders they created).
- Specs: customer, dateBy sold/created, owedToCustomer, bad status → 400, seller opens a colleague's order of
  their warehouse but not of another warehouse.

### Stage 2 — mobile
- `useOrdersInfinite` (like rentals) + «load more» on scroll; query key includes the filters.
- `OrderFilterSheet` (`screens/order/filter/`): period chips Сегодня / Вчера / 7 дней / 30 дней / Свой период
  (two `DatePickerSheet` fields «С» / «По», local day bounds); customer row → `CustomerPickerSheet` in pick-only
  mode (search by name or phone); status chips of the current tab; «Сбросить» / «Показать».
- `OrderPage`: the filter button enabled, with a count of active filters; a row of active filter chips with ✕
  under the tabs; switching the tab drops the status filter (period and customer stay); empty state
  «Нет заказов по фильтру» + «Сбросить».
- Someone else's CREATED/HOLD order opened by a seller → read-only `OrderViewScreen` instead of the cart (the
  backend would reject the edit anyway).
- i18n ru/uz/en.

### Stage 3 — finish
- `tsc`, android export, backend specs.
- Docs: `docs/features/orders.md`, `docs/api-map.md`, `billing-mobile/AGENTS.md`, `docs/security.md` (seller
  order access).
- Device QA.
