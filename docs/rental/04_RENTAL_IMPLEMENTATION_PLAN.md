# Аренда — план реализации

Каждая фаза — отдельный, проверяемый шаг. После фаз, меняющих API/правила, — запуск `docs-updater` (обновить `docs/features/`, `docs/api-map.md`, `billing/docs/DATABASE.md`).

---

**Прогресс (2026-11-05)**: фазы 1–4 выполнены (миграция `20261105120000_rental_schema`); документация обновлена после фазы 4, не дожидаясь фазы 7 (новые решения — в `01`/`03`, сводка — `docs/features/rental.md`). Фаза 5 (web) выполнена 2026-11-05: `billing_ui/src/app/pages/rental/`, настройки магазина `pages/store-settings/`, поля аренды в товарах. Следующая — фаза 6 (mobile).

## Фаза 1. Схема (billing)

- `Store.salesEnabled`, `Store.rentalEnabled`.
- `ProductVariant.canSell`, `canRent`, `rentPricePerDay`.
- `AdditionalService.sale`.
- `Rental`, `RentalCollateral`, `RentalReturn`, `RentalReturnItem`; enums `RentalStatus`, `CollateralType`.
- `CashTransactionCategory.RENTAL`.
- Миграция: существующие магазины `salesEnabled = true, rentalEnabled = false`; варианты `canSell = true, canRent = false` — поведение не меняется.

## Фаза 2. Флаги в существующих потоках (billing)

Чтобы ничего не сломать до появления аренды:

- `order.service.ts`
  - `createOrderItems` / проверка цены (`order.service.ts` ~L551): отклонять `canSell = false` и магазины с `salesEnabled = false`; отклонять заказ с `Rental`.
  - `createPayment` (~L740): отклонять заказ с `Rental` — **иначе спишет склад** (StockMovement SALE + `inventory.decrement`).
  - `createReturn`, `remove`: отклонять заказ с `Rental`.
- `AdditionalService.sale` учитывать в расчёте `totalAmount`.
- Store/Product DTO и сервисы — новые поля; права на флаги магазина — OWNER.
- Тесты на эти отказы.

## Фаза 3. RentalModule — ядро (billing)

`src/rental/`: `rental.module.ts`, `rental.controller.ts`, `rental.service.ts`, `rental-availability.service.ts`, `rental-days.ts` (чистые функции R2), `dto/`.

1. `rental-days.ts` — подсчёт дней (12:00, `Asia/Tashkent`) + unit-тесты на граничные случаи.
2. Доступность (R1): пиковое занятие по дням; блокировка `Inventory` в транзакции; unit-тесты (последовательные брони, просрочка, химчистка, частичный возврат, отменённые).
3. `POST /rental`, `PATCH /rental/:id`, `GET /rental`, `GET /rental/:id`, `GET /rental/availability`, `GET /rental/calendar`.
4. `POST /rental/:id/payments` — Payment + CashTransaction INCOME/RENTAL + баланс кассы.

## Фаза 4. RentalModule — жизненный цикл (billing)

1. `issue` + `RentalCollateral`.
2. `cleaning-conflicts`.
3. `returns/preview` и `returns` — частичный возврат, план/факт дней (подсказка), штраф, ранний возврат с выдачей денег (R4), пересчёт `totalAmount` и статуса заказа (R6).
   Сводка продаж `GET /orders/summary`: учитывать выданные арендные заказы по `soldAt` (R6).
4. Возврат залога-вещи (R5).
5. `cancel` с `refundAmount` (EXPENSE/RETURN).
6. Тесты сервисов по сценариям из [02_RENTAL_WORKFLOWS.md](./02_RENTAL_WORKFLOWS.md).

## Фаза 5. Web (billing_ui)

- Настройки магазина: флаги; меню/роуты по флагам.
- Форма товара/варианта: `canRent`, цена за день.
- Список аренд (фильтры: статус, даты, просроченные), карточка аренды.
- Создание брони: даты, выбор вариантов с доступностью, услуги, авто-распределение скидки от итоговой суммы + ручная правка.
- Выдача, возврат (химчистка, конфликты, штраф, preview), отмена.
- Календарь занятости.
- i18n (Transloco) для всех новых строк.

## Фаза 6. Mobile (billing-mobile)

Те же экраны в приоритете POS-сценария: бронь, выдача, возврат, оплата. Распределение скидки — та же логика, что в web (вынести в общий алгоритм, описанный в docs, чтобы результат совпадал).

## Фаза 7. Документация

`docs-updater`: `docs/features/rental.md` (новый), `orders.md`, `payments.md`, `cashbox.md`, `stores-warehouses.md`, `products.md`, `api-map.md`, `billing/docs/DATABASE.md`; обновить критические правила инвентаря в корневом `AGENTS.md` (для аренды склад не списывается).

---

## Риски

| Риск | Мера |
|------|------|
| Арендный заказ попадёт в `createPayment` продаж и спишет склад | Фаза 2 — явный отказ + тест |
| Гонка при бронировании последней единицы | Блокировка `Inventory` в транзакции |
| Путаница `RENT` (расход) и `RENTAL` (доход) | Разные категории, подписи в UI |
| Расхождение распределения скидки web vs mobile | Бэкенд всё равно валидирует; алгоритм описан в docs |
| Часовой пояс в правиле 12:00 | Константа `Asia/Tashkent`; все расчёты дат на бэкенде |
