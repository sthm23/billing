# Order set discount (общая скидка на заказ) — plan

> Created 2026-11-24. Affected: `billing-mobile` (main), `billing_ui` (fix of the naive split).
> Backend: **no changes** — it already validates every `sale`.

## Decisions (user, 2026-11-24)

1. **One-shot**: the entered total is applied once into the line `sale` values and not kept.
2. **Rounding step 1 000 sum**, same algorithm as the rental.
3. **Web too**: replace the naive split in `order-id.ts` with the shared algorithm (no new web UI).
4. **OWNER/MANAGER only** (`canLowerPrice`), same as lowering a line price; the backend enforces it.

## Goal

On the sale cart the employee sees «Итого 4 200 000», types the agreed total «4 000 000», and the
200 000 difference is spread over the order lines automatically as per-unit `sale` — exactly like the
set discount of a rental booking.

## What exists

- **Algorithm** — `distributeSetDiscount(lines, target)`: `docs/features/rental.md#set-discount-distribution`,
  copies in `billing-mobile/src/libs/set-discount.ts` and `billing_ui/src/app/shared/utils/set-discount.ts`
  (+ spec). By units → by positions with carry → remainder placed from the first line; shares rounded down
  to 1 000 sum, the total always equals the entered one.
- **Rental UI** (`RentalFormScreen`): field «Итоговая сумма» under the total, OWNER/MANAGER only
  (`canLowerPrice`), seller sees a lock; hints «скидка N распределена» / «сумма больше итога»;
  «Убрать скидку». The target is not stored — after save only the line `sale` values remain.
- **Sale backend** (`OrderService` `POST /orders/items`): `sale ≤ retailPrice`; lowering below the variant
  price → OWNER/MANAGER only, a saved unchanged price is accepted from anyone; services `sale ≤ price`, any
  role; `totalAmount = Σ (retailPrice − sale) × qty + Σ (service.price − service.sale)`. Returns already
  refund `retailPrice − sale` per unit, so distributed discounts work with returns as is.
- **Mobile cart** (`screens/order/cart/cart-store.ts`, `OrderCartScreen.tsx`): line = `retailPrice` + `sale`
  per unit; per-line `PriceSheet` (lower/raise); bottom block «Сумма / Скидка / Итого».
- **Web** (`order-id.ts` → `handleSaleDialogChange`): a naive split `sale / lines / quantity` — gives
  fractional sums and can exceed a cheap line's price (backend then rejects with 400).
- **Found bug**: the mobile cart sends additional services back **without `sale`** (`OrderAdditionalServicePayload`
  has no `sale`), so opening a web order with a discounted service on mobile and saving drops that discount.

## Proposed behaviour

1. Bottom block of the cart: the «Итого» row gets a «Скидка на заказ» action (OWNER/MANAGER; others see a lock
   and «Скидку даёт менеджер»).
2. It opens `OrderDiscountSheet` (same style as `PriceSheet`): current total, field «Итоговая сумма», live hint
   «Скидка 200 000 распределится по N позициям» / error «Сумма больше итога — поднять цену нельзя»,
   buttons «Применить» and «Убрать скидку».
3. **Apply** = `distributeSetDiscount` over the lines in cart order (items, then services) with
   `unitPrice = retailPrice` (the line price before its discount, raised prices included) — the result
   **replaces** the line `sale` values; services get their share as `service.sale`.
4. After that the manager may correct a single line in `PriceSheet` as today.
5. **One-shot** (recommended, see Q1): the target is not kept. Adding an item or changing a quantity later
   keeps the per-unit discounts already set, and «Итого» changes visibly; to re-fit the total the manager
   opens the sheet again. This also matches what happens after save/reopen (only line `sale` survives).
6. «Убрать скидку» sets every line and service `sale` to 0 (raised prices stay).
7. The backend recalculates and validates on save — nothing new there.

## Status (2026-11-24)

Stages 1–4 done, `tsc` clean in mobile and web; algorithm sanity-checked on sample orders. Device/web QA pending.
Mobile: `cartStore.applySetDiscount` / `clearDiscount` (`screens/order/cart/cart-store.ts`), `OrderDiscountSheet`
(`components/order/`), pill «Скидка на заказ» next to «Скидка» in the cart totals; service `sale` now kept.
Web: `order-id.ts` `handleSaleDialogChange` — the dialog still takes the discount amount; it is converted to a
target and spread over the items (web has no service discounts); cancelling the dialog no longer wipes discounts.

## Stages

1. **Lib** — make `libs/set-discount.ts` generic (comment: used by rental and sale orders; algorithm unchanged).
   Check the web spec still matches (same algorithm).
2. **Cart store** — keep `sale` of services in `CartState` (load from the order, send back — fixes the bug
   above); add `cartStore.applySetDiscount(target)` and `cartStore.clearDiscount()`; `cartTotals` subtracts
   service `sale`.
3. **UI** — `OrderDiscountSheet` (`components/order/`), entry point in `OrderCartScreen` totals block,
   role gate via `canLowerPrice`, i18n ru/uz/en (`sale.discount.*`).
4. **Web** (if Q3 = yes) — replace the naive split in `order-id.ts` with the existing
   `shared/utils/set-discount.ts` (sale dialog «UZS» mode becomes «new total»).
5. **Verify** — `tsc` in mobile (and `ng build` for web), manual check: 4 200 000 → 4 000 000 on 1/2/3 lines,
   cheap line (positions mode), qty > 1 with remainder, target > total (error), seller (lock), save HOLD →
   reopen → pay → partial return amount.
6. **Docs** — `docs/features/orders.md` (new § «Set discount on a sale», link to the rental algorithm),
   `rental.md` note that the algorithm is shared; `docs-updater`.

## Questions for the user

- **Q1. Fixed total or one-shot?** Recommended: one-shot (above). Alternative — like the rental form, the
  target stays while the cart is edited and every add/remove/qty change re-spreads the discount so «Итого»
  stays 4 000 000 (risk: adding an item silently gives it a discount).
- **Q2. Rounding step** — keep 1 000 sum like the rental (4 200 000 → 4 000 000 spreads in 1 000s; a total
  like 4 200 → 4 000 puts all 200 on the first line)? Or a smaller step for cheap goods?
- **Q3. Web too?** Product direction: mobile replaces web. Recommended: also swap the web naive split for the
  shared algorithm (small change, removes fractional sales), no new web UI.
- **Q4. Who may use it** — OWNER/MANAGER only (same as lowering a line price and the rental discount)?
  The backend enforces this anyway; a seller could only get a discount on a line whose price they raised.
