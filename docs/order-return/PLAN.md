# Order view + product return on mobile — plan

> Created 2026-11-15, all decisions final. Design: claude.ai artifact LBqDuZU3wDgKNJXJBfrAYb, page «Заказы» —
> artboards `OrderDone` (paid), `OrderDoneDebt` (debt), `OrderDoneReturned` (after return + toast),
> `OrderReturn` (money to customer), `OrderReturnDebt` (reduce debt), `OrderReturnEmpty` (nothing picked).
> Affected: `billing` (backend), `billing-mobile`. Web (`billing_ui`) keeps working (its return screen sends
> no reason → defaults apply; it cannot return as a seller any more).

## Decisions (user, 2026-11-15)

1. **One order = one return**, as originally designed (`ReturnedOrder.orderId @unique`, `Order.isReturned`).
   Mobile hides «Возврат товара» when `isReturned`; the backend already rejects a second return.
2. **Return reason + comment** are extra info: reason `DEFECT | NOT_FIT | EXTRA | OTHER` (Брак / Не подошёл /
   Лишнее / Другое), comment optional. Neither changes amounts, stock or statuses.
3. **No «Списать (брак)» destination.** Returned goods always go back to the order's warehouse (as today).
   The design's «Куда товар» block is dropped. Defective goods the shop does not take back: staff give part
   of the money as a manual cashbox expense with the new category **«Компенсация за брак»**
   (`CashTransactionCategory.DEFECT_COMPENSATION`), no StockMovement. Order screen gets a
   «Компенсация за брак» button that opens the expense form pre-linked to the order (`CashTransaction.orderId`).
4. **Order number** = first 6 characters of the uuid, upper-case (`№A1B2C3`). No numbering scheme. The return
   is shown the same way from its own id.
5. **Debt due date** (`Order.debtDueAt`, optional) — set only on the pay screen when part of the order is left
   on debt (same quick picks as «Новый долг»). Shown on the order screen and in the debtors list (overdue
   highlighted). Not editable afterwards. Does not affect payment logic.
6. **No «Поделиться чеком»** (receipts) — out of scope.
7. **`GET /orders/:id` is extended** (same single query): order `cashier`, `payments.cashier`, `returns`
   (items, payments with cashier, reason, comment, status), per-line `returnedQuantity`.
8. **DEBT order whose return exceeds the debt**: the debt is cleared and the rest is paid out — not drawn in
   the design, the screen combines both hero blocks («Долг уменьшится на» + «Вернуть клиенту»).
9. **Pay out later (CREDIT).** For a return that owes the customer money the screen offers
   «Выдать сейчас» / «Выдать позже». «Позже» = the whole amount later (no partial payout now) → return status
   CREDIT. The order screen then shows «Магазин должен клиенту X» + «Выдать деньги» (method + cashbox) →
   existing `POST /payment/return/:id`. Orders list shows a «Должны клиенту» badge for such orders.
10. **Cashbox only when money moves.** No payout (debt reduced / pay later) → no cashbox needed. Payout →
    `resolvePaymentCashbox` (own open cashbox, else pick any open store cashbox via `CashboxPickerSheet`),
    the same as debt repayment. Replaces today's strict «seller's own cashbox on the order's warehouse».
11. **Status stays REFUNDED** after a return (or DEBT when the customer still owes). Mobile shows badges:
    REFUNDED → «Возврат · частичный» / «Возврат · полный»; DEBT + `isReturned` → «Долг» + «Частичный возврат».
12. **Returns: OWNER and MANAGER only** (backend-enforced; manager — own warehouses). Sellers see no button.
13. **Sales reports count net sales**: `SOLD_ORDER_FILTER` includes REFUNDED and sums use
    `totalAmount − returnedAmount` (a partial return no longer removes the whole order from «Продажи»;
    a full return gives 0). Attributed to the sale date (`soldAt`).

## Stages

### Stage 1 — backend — DONE 2026-11-15
> Migration `20261115120000_order_return_details` (not applied to dev DB yet). Access rule in
> `assertReturnAccess` (`src/shared/helper/role.helper.ts`). `POST /orders/return` now answers
> `{ message, returnId, status, totalAmount, paidOut, cashboxId }`. `GET /orders/:id` adds `settlement`
> `{ debt, owedToCustomer, refundedOut }` (computed on the backend for display), `cashier`,
> `payments[].cashier`, `returns`, `items[].returnedQuantity`. `GET /orders` adds `isReturned`,
> `returnedAmount`, `returnStatus`. Summary `paid` = net total − debt still owed (DEBT orders + active rentals).
> Specs: 146 passing in order/payment/cashbox/debt/store/shared.
- Migration:
  - `ReturnedOrder.reason ReturnReason @default(OTHER)`, `ReturnedOrder.comment String?`;
    new enum `ReturnReason { DEFECT NOT_FIT EXTRA OTHER }`;
  - `CashTransactionCategory.DEFECT_COMPENSATION`;
  - `Order.debtDueAt DateTime?`.
- `POST /orders/return`:
  - staff roles OWNER/MANAGER only (SELLER/CASHIER → 403); MANAGER only for orders of own warehouses;
  - DTO `reason` (default OTHER), `comment?` (trim, max 500);
  - cashbox via `resolvePaymentCashbox` (+ optional `cashboxId`) only when `returnPayments` total > 0;
    no cashbox lookup otherwise;
  - response: the created return (`id`, `status`, `totalAmount`, paid out) for the toast.
- `POST /payment/return/:id`: same role rule.
- `GET /orders/:id`: decision 7 includes; cost still hidden by `canSeeCost`.
- `GET /orders` list: `isReturned`, return status (for the «Должны клиенту» badge).
- Pay flow (`POST /orders/payment/:id`, `POST /payment` if it can leave debt): optional `debtDueAt`
  (≥ today, only kept when debt > 0). Debtors endpoints return `debtDueAt` for order debts.
- `POST /cashbox/:id/transaction` with `orderId`: verify the order belongs to the user's store
  (check if missing); `DEFECT_COMPENSATION` allowed for EXPENSE only.
- Reports: decision 13 in `SOLD_ORDER_FILTER` users (`getSummary`, dashboard) — check every consumer.
- Specs: roles, reason/comment, no-cashbox return, payout with picked cashbox, CREDIT then pay later,
  net sales summary, debtDueAt, transaction order check.

### Stage 2 — mobile: order screen — DONE 2026-11-15
> `OrderDetailScreen` → cart (CREATED/HOLD) or `screens/order/view/OrderViewScreen.tsx` (sold / cancelled).
> Payout: `view/RefundPayoutSheet.tsx` (`usePayoutReturn`). Compensation: `AddTransactionSheet` /
> `TransactionForm` got `defaultCategory`, `lockCategory`, `orderId`, `title`, `note`; cashbox = own open one,
> else `CashboxPickerSheet` (a non-owner can only write to their own cashbox — backend rule). Routes
> `(orders)/debt-pay` (reuses `DebtPayScreen`, kind ORDER) and `(orders)/return/[id]` (ComingSoon until
> stage 3). Badges / `№` in `order-status.ts` (`orderBadges`, `orderNo`); the «Завершённые» tab now includes
> REFUNDED (returned orders used to vanish). Pay screen «Вернуть до» (`libs/due-date.ts`, shared with
> «Новый долг»). Debtors screens needed no change (they already show `dueAt`). Hooks `useReturnOrder` /
> `usePayoutReturn`; `useCreateOrderPayment` now also refreshes debtors. Toast after a return → stage 3.
> i18n `orderView.*`, `sale.pay.due*`, `payment.category.DEFECT_COMPENSATION`. `tsc` 0 errors, android export OK.
- Rework `OrderDetailScreen` (COMPLETED / DEBT / REFUNDED) per `OrderDone*`: header `№A1B2C3` + badges,
  hero (total, struck old total after return, «Оплачено» / «Долг» / «Возвращено» pills), info card
  (customer, phone, warehouse, seller), items with «вернули N шт» / «8 из 10», «Оплата и возвраты» history
  (payments with method/time/cashier, «В долг · вернуть до …», return row with reason and method).
- Bottom actions: «Принять оплату долга» (existing DebtPay), «Возврат товара» (OWNER/MANAGER, not returned),
  «Выдать деньги» (CREDIT), «Компенсация за брак» (opens `TransactionForm` with category + orderId).
- Toast after a return («Возврат оформлен. Клиенту выдано … » / «Долг уменьшен на …» / «Выдадим позже …»).
- Orders list: `№` + «Должны клиенту» badge.
- Pay screen: optional «Вернуть до» when debt remains.
- Debtors list / debtor screen: due date for order debts, overdue tone.

### Stage 3 — mobile: return screen — DONE 2026-11-15
> `screens/order/return/OrderReturnScreen.tsx`, route `(orders)/return/[id]`. Backend addition:
> `POST /orders/return` takes optional `payoutMethod` — the backend pays out the whole amount owed (refund, or
> the part above the debt of a DEBT order) by that method; not combined with `returnPayments` (400). Mobile
> sends `returnPayments: []` + `payoutMethod` («Выдать сейчас») or nothing («Выдать позже» / debt only), so the
> client never computes money it sends. Hero sums are a preview. Uzbek dates are built by hand in
> `rental-format.ts` (Hermes has no `uz` locale data); `DateRangeSheet` uses the shared formatters.
> Specs: 4 new `payoutMethod` tests, order.service 65 passing.
- Route `(orders)/return/[id]`, `screens/order/return/OrderReturnScreen.tsx`.
- Per-line stepper (0…quantity), «выбрано N шт», reason chips, comment input.
- Hero: «Вернуть клиенту» / «Долг уменьшится на (было → станет)» / both (decision 8). Display-only sums from
  the order lines; the backend decides amounts and status.
- When money is owed: «Выдать сейчас» (method tiles via `PaymentMethodsInput`, single method, full amount;
  cashbox note / `CashboxPickerSheet`) or «Выдать позже».
- Disabled button + hint when nothing picked; backend errors shown; success → back to the order with the
  toast; invalidate order, orders list, cashboxes, inventory, debtors, summaries.

### Stage 4 — finish
- i18n (ru/uz/en), `tsc`, backend + mobile tests.
- `docs-updater`: `docs/features/returns.md`, `docs/workflows/returns.md`, `docs/features/orders.md`,
  `docs/features/debt.md`, `docs/features/cashbox.md`, `docs/api-map.md`, `billing/docs/DATABASE.md`.
- Device QA (light/dark).
