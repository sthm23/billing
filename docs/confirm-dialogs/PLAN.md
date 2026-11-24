# Confirmations and messages that work on web — plan

> Created 2026-11-24. Affected: `billing-mobile` (+ one backend role fix in `billing`). No design mock-up: the
> confirm sheet follows `DeactivateStaffSheet` (design «Деактивировать — шит»).

## Problem

On web (Expo web, sthm23.uz) the «В архив» button does nothing. Cause: `Alert.alert` from `react-native` is an
**empty function in react-native-web** (`static alert() {}`), so no dialog shows and its `onPress` never runs.
The app calls `Alert.alert` in 6 places, so all of them are broken on web:

| Place | Kind | What breaks on web |
|---|---|---|
| `ProductDetailScreen` — «В архив» | confirm | product can't be archived |
| `ProductDetailScreen` — «Вернуть из архива» | confirm | product can't be restored |
| `CashboxDetailsPage` — «Закрыть кассу» | confirm | **cashbox can't be closed** |
| `CreateStaffScreen` — staff created | message + OK → back | success not shown, screen stays on the filled form (risk of a duplicate submit) |
| `OrderPayScreen` — paid / change | message | the change amount is not shown to the cashier |
| `OrderCartScreen` — order held | message | silent (screen goes back anyway) |

Android / iOS work today; the fix must keep them working.

## Decisions (user, 2026-11-24)

1. Fix **all 6 places**, not only the product card.
2. Confirmations become a shared bottom sheet (same look as «Деактивировать сотрудника»): works the same on web,
   Android and iOS.
3. Messages without a choice become a `toast` (the rule in `billing-mobile/AGENTS.md`: feedback that needs no
   confirmation → `toast`, not `Alert`).

## Stages

### Stage 1 — shared `ConfirmSheet` — DONE 2026-11-24
> `src/components/common/ConfirmSheet.tsx`, exported from `@/components/common`. New i18n key `common.cancel`
> (ru «Отмена» / uz «Bekor qilish» / en «Cancel»). Cancel is disabled while `loading`. `tsc --noEmit` clean.
> Not used anywhere yet — first callers in stage 2.
- `src/components/common/ConfirmSheet.tsx` (+ export in `index.ts`) on `Sheet size="auto"`:
  `isOpen`, `onClose`, `title`, `message`, `confirmLabel`, `cancelLabel?` (default `common.cancel`),
  `tone?: 'danger' | 'primary'`, `loading?`, `error?` (red box like `DeactivateStaffSheet`), `onConfirm`.
- The caller runs the mutation and keeps the sheet open while it is pending; on error the sheet shows the API
  message instead of a toast behind it; on success the caller closes it.

### Stage 2 — product card: archive and restore — DONE 2026-11-24 (web QA pending)
> `ProductDetailScreen`: one `ConfirmSheet` for both (`confirmKind` + `confirmOpen` — the kind stays while the
> sheet slides out), errors shown in the sheet, no `Alert` import left. Backend `DELETE /product/:id` roles now
> `UserRole.OWNER, StaffRole.OWNER, StaffRole.MANAGER`. Backend tsc clean, product service specs 61 passing.
> Mobile tsc: only 2 errors in `AdminShopScreen.tsx` (routes `shops/[id]/brands|attributes` of the parallel
> store-catalog work — typed routes not regenerated), not from this change.
- `ProductDetailScreen`: `Alert.alert` → `ConfirmSheet` for «В архив» (`danger`) and «Вернуть из архива»
  (`primary`), same texts (`product.archive.*`, `product.restore.*`). Archive success: toast + `router.back()`
  as now; restore success: toast, the card switches in place.
- **Backend role fix**: `DELETE /product/:id` has `@Roles(UserRole.OWNER, StaffRole.MANAGER)` — without
  `StaffRole.OWNER`, unlike `PATCH /product/:id` and `PATCH /product/:id/restore`. A staff owner whose
  `User.role` is not OWNER sees the button (`canManageProducts()`) but gets 403. Add `StaffRole.OWNER`
  (the service check `assertWarehouseAccess` already allows owners). Controller-only change.

### Stage 3 — cashbox close — DONE 2026-11-24 (web QA pending)
> `CashboxDetailsPage`: `ConfirmSheet` (`danger`, existing «Да» / «Нет» texts), loading from the mutation, sheet
> can't be closed while pending, error in the sheet (new key `payment.closeCashboxConfirmation.failed` ru/uz/en);
> success → `router.back()` as before. No `Alert` import left. Mobile `tsc --noEmit` clean (the AdminShopScreen
> route errors are gone too).
- `CashboxDetailsPage`: «Закрыть кассу» → `ConfirmSheet` (`danger`, texts `payment.closeCashboxConfirmation.*`),
  loading from `closeCashboxMutation`, error shown in the sheet (today a failed close is silent).

### Stage 4 — messages → toast — DONE 2026-11-24 (web QA pending)
> Existing texts, no new keys: cart → `sale.cart.heldTitle`; pay → `sale.pay.successTitle · successChange`
> (with change) or `successText`; create staff → `staffCreate.successText` («{name} может войти с логином
> {login}») + `router.back()` at once. `sale.cart.heldText` and `staffCreate.successTitle` are now unused (kept).
> No `Alert` import / call left in `src/`. Mobile `tsc --noEmit` clean.
- `CreateStaffScreen`: toast «Сотрудник {name} создан · логин {login}» + `router.back()` right away (no OK
  button to wait for). Text from `staffCreate.successText`, shortened if it doesn't fit 2 lines.
- `OrderPayScreen`: toast «Оплачено» / «Оплачено · сдача {amount}» (`sale.pay.*`), then the same navigation.
- `OrderCartScreen`: toast «Заказ отложен» (`sale.cart.held*`), then `router.back()`.
- Add / adjust i18n keys in ru / uz / en where a one-line toast text is needed.

### Stage 5 — guard + docs — DONE 2026-11-24 (QA pending)
> Rule «Never use `Alert.alert`» + `ConfirmSheet` usage in `billing-mobile/AGENTS.md`. docs-updater: `docs/security.md`
> and `docs/api-map.md` (DELETE `/product/:id` roles incl. staff OWNER; archive / restore confirmed in
> `ConfirmSheet`), `billing-mobile/AGENTS.md` (components tree, product card lines). **Remaining: QA** below.
- `billing-mobile/AGENTS.md`: «Do not use `Alert.alert` — it is a no-op on web; confirmations → `ConfirmSheet`,
  messages → `toast`». (The project has no ESLint setup, so the rule is documented, not linted.)
- `docs-updater`: `billing-mobile/AGENTS.md` (component), `docs/security.md` (DELETE `/product/:id` roles).
- `npm run type-check`; QA on **web** and one native device: archive, restore, close cashbox, create staff,
  pay with change, hold an order.

## Out of scope
- Other web-only gaps not related to `Alert` (none found while planning).
