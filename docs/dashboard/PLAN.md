# Owner dashboard on mobile — plan

> Created 2026-11-24. Affected: `billing` (backend, new `dashboard` module), `billing-mobile`. Web (`billing_ui`)
> is untouched: its dashboard is a mock-up and mobile replaces web.
> Design: canvas «STHM» → page «Дашборд» (`Dashboard.dc.html`, `DashboardAll.dc.html`, `DashboardDark.dc.html`),
> https://claude.ai/artifact/LBqDuZU3wDgKNJXJBfrAYb. The plan changes the design where the decisions below say so.

## Problem

The owner has no place to see how the store is doing: revenue, profit, payment methods, cash flow, best products,
debts, staff and warehouses. The backend has no report endpoints (the web dashboard shows fake numbers).

## Decisions (user, 2026-11-24)

1. **Who**: OWNER only. Everyone else gets **403** from the backend, and the menu item is hidden.
2. **Where**: Profile → «Дашборд» (a row in the profile menu, a screen in the profile stack). No new tab.
3. **Filters**:
   - **Period**: Сегодня · Вчера · 7 дней · Этот месяц · Прошлый месяц · Свой период (from / to dates).
     **At most 31 days**, checked by the backend (400) and by the date picker.
   - **Warehouse**: «Весь магазин» (default) or one warehouse. A filter on the screen, independent of the working
     warehouse in the profile.
4. **Accounting: every operation counts in its own period (event-dated)** — the same result as a monthly «bill
   run», without snapshot tables:
   - a sale counts on its sale date (`Order.soldAt`);
   - a return counts on the **return date**, as a minus, in the period of the return, not of the sale;
   - a debt repayment, cash income and expense count on their own dates.

   So a closed period never changes by itself. This is safe because a sold order cannot be cancelled (only
   returned), a return has its own date, and price / cost are stored on the order line at the sale moment
   (`retailPrice`, `costAtSale`). Snapshot tables (daily totals) come only later, if speed or backdated edits
   require them; the API stays the same.
5. **Revenue** = sales of the period (debt orders included) − returns of the period. **Rental is separate**: never
   in sales or revenue, only in its own card. Collateral is never income.
6. **No comparison with the previous period** (the «▲ +12% к сен» badge is removed). Back to it if customers ask.
7. **Removed from the design**: the whole «Остатки на складе» card (running low, not selling 30+ days, money in
   stock, stock forecast).
8. **Store purchases** (`PURCHASE`) are a separate line «Закупка товара» in «Доходы и расходы», not part of
   «Расходы магазина».
9. **A one-day period** (Сегодня, Вчера, or a custom single day) shows the sales chart **by hours**; longer
   periods show it **by days**.
10. **Charts**: plain React Native `View`s (bars as views with a % height, `Pressable` to pick a bar). **No new
    packages.** Works on iOS, Android and Expo web.
11. **Loading**: the main block is one request; «Показать ещё отчёты» loads two more blocks, each on its own
    request, only when opened.
12. **Calculation**: live aggregation on every request (Prisma `aggregate` / `groupBy` + `$queryRaw` where grouping
    by local day / hour is needed). No new tables, no migration.

## What exists

- `Order`: `soldAt` (set once, at the sale payment; a later debt payment keeps it), `status`, `totalAmount` (after
  discounts, with additional services), `paidAmount`, `returnedAmount`, `returnedAt`, `warehouseId`, `cashierId`;
  indexes `[storeId, soldAt]`, `[warehouseId, createdAt]`.
- `SOLD_ORDER_FILTER` (`order/entities/sold-order.filter.ts`) and `OrderService.getSummary` — today's «Продажи»
  summary. **It nets returns against the sale period** (the old way); the dashboard uses its own event-dated
  queries and does not change `getSummary`.
- `OrderItem`: `quantity`, `retailPrice`, `sale`, `costAtSale` → profit.
- `Payment` (`type`: CASH / CARD / ONLINE = «Click» / TRANSFER, `createdAt`) — sale payments and repayments of
  order debts.
- `ReturnedOrder` (`createdAt`, `totalAmount`, `reason`: DEFECT / NOT_FIT / EXTRA / OTHER) + `ReturnItem`
  (`quantity`, link to `OrderItem` → `costAtSale`). Rental orders never go through returns.
- `CashTransaction` (`type` INCOME / EXPENSE, `category`, `paymentType`, `cashboxId` → `Cashbox.warehouseId`).
  Sale refunds and rental prepayment refunds are EXPENSE `RETURN`.
- `CustomerDebt` (manual, historical, pre-system debts; **no warehouse**; `createdAt` can be backdated) +
  `DebtPayment` (repayments, also written as `CashTransaction` `DEBT_PAYMENT` into a cashbox).
- `Rental` (`status`, `startDate`, `endDate`, `issuedAt`, `warehouseId`), rental income = `CashTransaction`
  `RENTAL`.
- Time zone: `RENTAL_TIME_ZONE = 'Asia/Tashkent'` (`rental/rental-days.ts`). Tashkent has no daylight saving time.
- Access helpers: `@Roles(...)`, `assertWarehouseAccess`; `shared/dto/date-range.dto.ts` (`from`, `to`).
- Mobile: profile stack `app/(tabs)/(profile)/`, `MobileProfilePage` / `SettingItems`, `DatePickerSheet`, the
  period chips of `OrderFilterSheet` (`screens/order/filter/`), services in `src/services/<module>/` with React
  Query hooks, i18n ru / uz / en.

## Definitions (backend is the source of truth)

All amounts are in UZS. Period = `[from, to)`. Scope = the owner's store; with `warehouseId`, only that warehouse.

**Sold orders of the period** = `SOLD_ORDER_FILTER`, `soldAt` in the period, **no `Rental`**, store / warehouse
scope.

| Figure | Rule |
|---|---|
| Продажи (sales) | Σ `totalAmount` of the sold orders of the period |
| Возвраты | Σ `ReturnedOrder.totalAmount` with `createdAt` in the period (order in scope, not rental) |
| **Выручка** | Продажи − Возвраты |
| Себестоимость | Σ `costAtSale × quantity` of the sold orders − Σ `costAtSale × ReturnItem.quantity` of the returns of the period |
| **Прибыль** | Выручка − Себестоимость; **маржа** = Прибыль / Выручка (hidden when Выручка ≤ 0) |
| Заказов | count of the sold orders of the period |
| Продано, шт | Σ `OrderItem.quantity` of the sold orders |
| Средний чек | Продажи / Заказов |
| Sales chart | Продажи per local day (or per hour for a one-day period) + the order count per bar |
| Платежи по способу | sale payments of the sold orders of the period, by payment type: `CashTransaction` INCOME `SALE` of those orders (written at the sale); later repayments (`DEBT_PAYMENT`) are «Погашено», not here |
| Отдано в долг | Продажи − those sale payments |
| Топ товаров | top 5 products by sales of the period: Σ (`(retailPrice − sale) × quantity`) and Σ quantity, grouped by product (all variants) |
| Доходы и расходы | `CashTransaction` of the period, by the cashbox's warehouse: «Приход в кассы» = Σ INCOME; expenses by category: Зарплата (SALARY), Аренда помещения (RENT), Доставка (DELIVERY), Возвраты покупателям (RETURN), Химчистка (DRY_CLEANING), Компенсация брака (DEFECT_COMPENSATION), Прочее (OTHER), only categories with a sum > 0; «Закупка товара» (PURCHASE) on its own line; «Чистый поток денег» = приход − all expenses − закупка |
| Долги · Выдано | = Отдано в долг (debts from **sales** of the period; manual debts are history, not issued in the period) |
| Долги · Погашено | `CashTransaction` INCOME `DEBT_PAYMENT` in the period (order debts and manual debts), by the cashbox's warehouse — same as «Должники» |
| Долги · Должны сейчас | the store's open debt **now** (same total as «Должники»; not a period figure), only in «Весь магазин» |
| Продажи по сотрудникам | Продажи and order count by `cashierId` (staff name), all staff with sales |
| Продажи по складам | Продажи by `warehouseId`, share in %; only in «Весь магазин» with 2+ warehouses |
| Продажи по часам | sales of the period by local hour, **average per day** (Σ / number of days in the period); peak and quietest hour |
| Возвраты (card) | sum, count, % of sales of the period, counts by `reason` |
| Аренда (card) | income in the period = Σ INCOME `RENTAL` − Σ EXPENSE `RETURN` of rental orders; **now**: «На руках» (items of ISSUED / PARTIALLY_RETURNED rentals), «Вернуть сегодня» (`endDate` today, not returned), «Просрочено» (`endDate` passed, not returned). Hidden when the store has no rental items. |

Both open checks were settled in stage 1 (see its notes): sale payments come from `CashTransaction` `SALE`, and
`ReturnedOrder.totalAmount` is the value of the returned goods.

## API

New module `billing/src/dashboard/` (controller, service, DTO, specs). Every endpoint:
`@Roles(OWNER, StaffRole.OWNER)`; `storeId` from the token; `warehouseId` optional UUID, checked with
`assertWarehouseAccess` (a warehouse of another store → 403).

Query DTO `DashboardParams`: `from`, `to` (ISO instants, required; the client sends local Tashkent day bounds),
`warehouseId?`. **400** when `to ≤ from` or `to − from` > 31 days. Grouping by day / hour uses
`AT TIME ZONE 'Asia/Tashkent'`; the response says which (`granularity: 'hour' | 'day'`).

| Endpoint | Returns |
|---|---|
| `GET /dashboard/summary` | `period`, `kpi` (sales, returns, revenue, cost, profit, margin, orders, items, avgCheck), `chart` (`granularity`, points `{ at, sales, orders }`, including empty days / hours), `payments` (by type + `debtGiven`), `cashflow` (income, expenses by category, purchase, net), `topProducts` (5), `debts` (given, repaid, outstandingNow) |
| `GET /dashboard/team` | `staff` (name, sales, orders), `warehouses` (name, sales, share) |
| `GET /dashboard/activity` | `hours` (`days`, 24 points `{ hour, avgSales, orders }`, `peakHour`, `quietHour`), `returns` (amount, count, `share` of sales, `byReason` — all 4 reasons), `rental` (income, out, dueToday, overdue; `null` when the store has rental off) |

Amounts go out as numbers (UZS has no fractions), like other summary endpoints.

## Stages

### Stage 1 — backend: module + `GET /dashboard/summary` — DONE 2026-11-24
> `src/dashboard/` (module, controller `@Roles(OWNER, StaffRole.OWNER)` + service owner check, `DashboardParams`,
> `dashboard.constants.ts`). Raw SQL marked `/* dashboard:<name> */`; dates passed as
> `(iso::timestamptz AT TIME ZONE 'UTC')`, local buckets via `AT TIME ZONE 'Asia/Tashkent'`; the chart is filled
> in JS with a fixed +5h offset (every hour / day, empty ones included).
> Decisions while building:
> - **sale payments = `CashTransaction` INCOME `SALE` of the sold orders** (written in the pay transaction);
>   repayments are `DEBT_PAYMENT`. Not `Payment.createdAt` vs `soldAt`: `createdAt` is a DB default, `soldAt` a
>   JS time. Repayments made before the `DEBT_PAYMENT` category existed are still `SALE` (old data only).
> - «Погашено» = `CashTransaction` INCOME `DEBT_PAYMENT` of the period by cashbox (same as «Должники»), so
>   manual-debt repayments follow the warehouse filter too.
> - `ReturnedOrder.totalAmount` = value of the returned goods (`(retailPrice − sale) × qty`), confirmed in
>   `OrderService.returnOrder`. `OrderItem.sale` is per unit: line sales = `(retailPrice − sale) × quantity`.
> - `outstandingNow` = `null` with a warehouse filter.
>
> Specs: `dashboard.service.spec.ts` 19 passing; full suite 515 passing (the same 12 scaffold suites fail as
> before). `tsc` clean. Smoke on the local DB (store with warehouse yogoch): October — sales 1 398 000 = top
> products total, paid at sale 849 000 + debt 549 000, cash income 1 008 000 = 849 000 + repaid 159 000;
> November — 0 sales, returns 575 000 (October sales returned on 15 Nov, counted in November).
- `dashboard.module.ts`, controller, service, `DashboardParams` DTO (31-day limit), registered in `app.module.ts`.
- Queries for the summary rules above, with store / warehouse scope. Run independent queries in parallel; no
  transaction needed (read-only).
- Specs (`dashboard.service.spec.ts`, Prisma mocked like other services):
  - a seller / manager / cashier → 403; another store's warehouse → 403; 32 days → 400;
  - a return made in the next period: the sale period stays the same, the return period has the minus;
  - a debt order: in sales and «Выдано»; its later repayment is in «Погашено» of the repayment period, not in
    «Платежи по способу»;
  - a rental order is not in sales;
  - the warehouse filter narrows sales, cash flow and repayments;
  - a one-day period → hourly chart with 24 points; a 7-day period → 7 day points.
- Smoke on the local DB: `npm run build` + a node script on `dist/` (Prisma 7 does not run under jest / ts-node).

### Stage 2 — backend: `GET /dashboard/team` + `GET /dashboard/activity` — DONE 2026-11-24
> `getTeam`: staff by `cashierId` (name from `users.fullName`), warehouses only for the whole store with 2+
> warehouses (an inactive one only if it sold), `share` 0..1. `getActivity`: hours via
> `EXTRACT(HOUR FROM local soldAt)`, average over `ceil(period / 1 day)` days; quietest = lowest hour that sold, null
> with fewer than 2 such hours; returns reuse the summary's `returnsTotals` / `salesTotals`; rental only when
> `Store.rentalEnabled` (else `null`), units = items of ISSUED / PARTIALLY_RETURNED rentals − returned items,
> «Вернуть сегодня» / «Просрочено» with the rental lists' rules (`rentalBoundary` noon, `endDate < now`; a unit due
> today after noon is in both). Collateral is never cash, so rental income = INCOME `RENTAL` − EXPENSE `RETURN` of
> rental orders.
> Specs: 31 passing (12 new). `tsc` clean. Smoke on the local DB: hours of October add up to the October sales
> (1 398 000); the rental store shows rental income 3 030 000 in November and 0 sales (rental is not a sale).
- Rules from the table; the rental figures reuse what `rental/` already has for overdue / due today where
  possible.
- Specs: staff and warehouse split, warehouse card absent with one warehouse or a warehouse filter, hours average
  per day, return reasons, rental «now» figures.

### Stage 3 — mobile: screen + main block — DONE 2026-11-24 (device QA pending)
> `services/dashboard/` (`dashboard.types.ts`, `getSummary`, `useDashboardSummary` — key with from / to /
> warehouse, `placeholderData` keeps the old period while loading, 10 min `staleTime` for a period that ended).
> `screens/dashboard/`: `DashboardScreen` (header «Дашборд · store · scope», warehouse pill → `DashboardWarehouseSheet`
> when the owner has 2+ warehouses; period chips Сегодня / Вчера / 7 дней / Этот месяц (whole month, future days
> empty) / Прошлый месяц / Свой период — two `DatePickerSheet`s, «По» limited to 31 days from «С» and today),
> `dashboard-period.ts` (period → local day bounds, `shortAmount`, `barWidth`, store-local hour / day of chart
> points by the fixed +5h), `BarChart` (views, tap selects; default = best bar), `DashboardParts` (`SectionCard`,
> `StatTile`, `ShareBar`, `TotalRow`). Hero: revenue of the period, «Продажи − возвраты» line when there were
> returns, tiles profit + margin / orders + units / average check. Empty period → one «операций нет» card.
> New colour tokens `chart` / `chart-muted` (`global.css` + `tokens.ts`): light `#5E7A45` — the sage `accent` is too
> pale for bars on a white card. Route `(profile)/dashboard`; Profile row «Дашборд» for `canSeeDashboard(user)`
> (`libs/roles.ts`, owner only, UX). i18n `dashboard.*` ru / uz / en replaced the unused web leftover; labels reuse
> `order.paymentMethod.*`, `payment.category.*`. `tsc --noEmit` clean; `expo export --platform web` builds.
- `src/services/dashboard/`: `dashboard.service.ts` (3 calls), `dashboard.queries.ts`
  (`useDashboardSummary`, `useDashboardTeam`, `useDashboardActivity`; the key includes from / to / warehouse;
  `staleTime` long for periods that ended before today, short for a period that includes today), types in
  `models/`.
- Route `app/(tabs)/(profile)/dashboard.tsx` + `Stack.Screen`; menu row «Дашборд» in the profile only for the
  owner (UX only; the backend enforces it).
- `screens/dashboard/DashboardScreen.tsx` following the design, **minus** the comparison badge and the stock card:
  header (back, «Дашборд», store · warehouse), period bar (chips + «Свой период» with two `DatePickerSheet`s,
  max 31 days), warehouse filter sheet, hero card, sales chart (tap a bar → value + orders of that day / hour),
  payment methods, income / expenses (purchase line separate), top products, debts («Все должники» → debtors
  screen).
- Small components in `screens/dashboard/`: `BarChart` (vertical bars, selectable), `ShareBar` (horizontal bar
  row), `StatTile`. Light and dark themes from the existing tokens.
- States: loading skeleton, error with «Повторить», empty period («За этот период продаж нет»), pull to refresh.
- i18n ru / uz / en (`dashboard.*`); money with the existing formatter, short form «млн / тыс».
- `tsc --noEmit`.

### Stage 4 — mobile: «Показать ещё отчёты» — DONE 2026-11-24 (device QA pending)
> `services/dashboard`: `getTeam` / `getActivity`, `useDashboardTeam` / `useDashboardActivity` (enabled only once
> the block is open; activity has no long cache — its rental figures are «now»). `screens/dashboard/DashboardMore.tsx`:
> button «Показать ещё отчёты · 1 из 2» → block «Сотрудники и склады» (staff bars, «N заказов»; warehouses with the
> backend share) → «2 из 2» → block «Время, возвраты, аренда»: hours chart (selling hours, at least 8:00–20:00,
> tap a bar; peak / quietest line), returns (sum, count, share of sales, reasons with `orderReturn.reasons.*`),
> rental (income of the period; out / due today / overdue «now», shown only when `rental` is not null) →
> «Свернуть». Open blocks stay open on a period / warehouse change (state in `DashboardScreen`). Loading / error
> with «Повторить» per block. i18n `dashboard.more.*` ru / uz / en. `tsc --noEmit` clean; web export builds.
- Button «Показать ещё отчёты · 1 из 2» → block 1 «Сотрудники и склады» (`useDashboardTeam`, enabled only after
  the tap) → «2 из 2» → block 2 «Время, возвраты, аренда» (`useDashboardActivity`) → «Свернуть».
- The opened blocks stay open when the period / warehouse changes (they refetch).
- Rental card hidden when `rental.enabled` is false.
- `tsc --noEmit`; device QA on iOS / Android and Expo web (light + dark).

### Stage 5 — docs
- `docs-updater`: new `docs/features/dashboard.md` (rules from «Definitions», event-dated accounting, owner only,
  31-day limit), `docs/api-map.md` (Dashboard module), `docs/security.md` (endpoint rows), `docs/INDEX.md`,
  `billing-mobile/AGENTS.md` (dashboard screen, hooks).

## Out of scope

- Comparison with the previous period; stock reports (running low, not selling, money in stock, forecast).
- Periods over 31 days (later: weekly bars, and daily-totals tables if queries get slow).
- Snapshot / closed-period tables and locking backdated edits.
- Web (`billing_ui`) dashboard; export to Excel / PDF; manager access.
