# Аренда — API

Модуль: `billing/src/rental/` (`rental.controller.ts`, `rental.service.ts`, `rental-availability.service.ts`, `rental-return.ts`, `rental-days.ts`, `dto/`). Правила — [01_RENTAL_DESIGN.md](./01_RENTAL_DESIGN.md) (R1–R12).

Все эндпоинты — `AuthJWTGuard`, только сотрудник магазина с `rentalEnabled = true`. `storeId` берётся из токена; `warehouseId` из тела/запроса проверяется: склад этого магазина + доступ (OWNER — все склады магазина, остальные — свои через `StaffOnWarehouse`).

| Метод | Путь | Назначение | Роли |
|-------|------|-----------|------|
| GET | `/rental/availability` | Свободные единицы вариантов на интервал | все сотрудники |
| GET | `/rental/calendar` | Занятость вариантов по дням (для календаря) | все |
| POST | `/rental` | Создать бронь (Order + Rental) | все; скидка на позиции — OWNER/MANAGER |
| PATCH | `/rental/:id` | Изменить бронь (BOOKED) | все; новая скидка на позиции — OWNER/MANAGER |
| GET | `/rental` | Список с фильтрами, поиском и пагинацией | все |
| GET | `/rental/summary` | Счётчики быстрых фильтров списка | все |
| GET | `/rental/similar` | Замена занятой вещи: другие варианты товара и категории со свободными единицами | все |
| GET | `/rental/:id` | Детали: заказ, позиции, услуги, платежи, залоги, возвраты | все |
| POST | `/rental/:id/payments` | Предоплата/доплата и/или залог-вещь (BOOKED, ISSUED, PARTIALLY_RETURNED) | все |
| POST | `/rental/:id/issue` | Выдача + залоги + опц. платежи | все |
| GET | `/rental/:id/cleaning-conflicts` | Конфликты химчистки (предупреждение) | все |
| POST | `/rental/:id/returns/preview` | Расчёт возврата без записи | все; см. ограничения ниже |
| POST | `/rental/:id/returns` | Возврат (полный/частичный) | все; `earlyReturnRefund > 0` и `returnedAt` в прошлом — OWNER/MANAGER |
| POST | `/rental/:id/collaterals/:collateralId/return` | Вернуть паспорт/драгоценности | все, при полной оплате или отменённой брони |
| POST | `/rental/:id/cancel` | Отмена брони с возвратом части предоплаты | OWNER, MANAGER |

`:id`, `:collateralId` — UUID v4 (иначе `400`).

---

## Общие соглашения

- **Даты брони** — строки `YYYY-MM-DD` (местная дата, `Asia/Tashkent`). В ответах `startDate`/`endDate` — ISO-моменты 12:00 по Ташкенту (`2027-05-14T07:00:00.000Z`).
- **Деньги** в ответах — `Prisma.Decimal`, сериализуются в JSON как **строки** (`"1600000"`). В запросах — числа.
- **Ответ всех изменяющих эндпоинтов** (`POST /rental`, `PATCH`, `payments`, `issue`, `returns`, `collaterals/.../return`, `cancel`) — свежие детали аренды, как `GET /rental/:id`.
- **Касса** для денег: `cashboxId` (любая открытая касса магазина) или своя открытая касса сотрудника (предпочтительно на складе аренды). Нет открытой кассы → `400 "No open cashbox: open one or choose an open cashbox of the store"`. Платежи с `amount ≤ 0` игнорируются.
- **Ошибки с кодом** возвращаются телом-объектом без `statusCode`:
  ```json
  { "code": "NOT_AVAILABLE", "message": "...", "variantId": "uuid", "available": 0 }
  ```
  | HTTP | `code` | Когда |
  |------|--------|-------|
  | 400 | `RENTAL_DISABLED` | у магазина `rentalEnabled = false` |
  | 400 | `VARIANT_NOT_RENTABLE` (+`variantId`) | `canRent = false`, нет цены за день, товар в архиве |
  | 409 | `NOT_AVAILABLE` (+`variantId`, `available`) | не хватает свободных единиц на даты (бронь/изменение) или вещь не в салоне (выдача) |

  Остальные ошибки — стандартные Nest (`{ statusCode, message, error }`): `400` — валидация/бизнес-правило, `403` — нет прав/доступа к складу, `404` — аренда другого магазина или не найдена.

---

## GET /rental/availability

```
?warehouseId=uuid&startDate=2027-05-14&endDate=2027-05-16&variantIds=a,b
&excludeRentalId=uuid   // при редактировании брони — не считать её саму
```
```json
[{ "variantId": "a", "owned": 3, "available": 2 }]
```
`owned` — `Inventory.quantity` на складе, `available` — `owned − пиковое занятие` на `[startDate 12:00, endDate 12:00)` (R1). `startDate` в прошлом здесь разрешён.

## GET /rental/calendar

```
?warehouseId=uuid&from=2027-05-01&to=2027-05-31&variantIds=a,b   // variantIds опционален
```
Не больше 93 дней. Без `variantIds` — все варианты склада с `canRent = true` (товар не в архиве). День `d` = окно `[d 12:00, d+1 12:00)`.

```json
{
  "from": "2027-05-01",
  "to": "2027-05-31",
  "variants": [{
    "variantId": "a", "sku": "DR-M", "productId": "uuid", "productName": "Платье Белла",
    "owned": 1,
    "days": [{ "date": "2027-05-14", "busy": 1, "available": 0 }],
    "bookings": [{ "rentalId": "uuid", "from": "2027-05-14T07:00:00.000Z", "to": "2027-05-16T07:00:00.000Z", "quantity": 1 }]
  }],
  "rentals": [{ "id": "uuid", "orderId": "uuid", "status": "BOOKED", "startDate": "...", "endDate": "...", "customerName": "Иванова" }]
}
```
`bookings[].to` уже учитывает химчистку (`availableFrom`) и просрочку (`max(endDate, now)`).

## POST /rental

```json
{
  "warehouseId": "uuid",
  "customerId": "uuid",
  "startDate": "2027-05-14",
  "endDate": "2027-05-16",
  "items": [
    { "variantId": "dress-m", "quantity": 1, "sale": 25000 },
    { "variantId": "suit-50", "quantity": 1, "sale": 18750 }
  ],
  "services": [{ "name": "Макияж", "price": 900000, "sale": 56250, "description": "опц." }],
  "notes": "Свадьба 15.05"
}
```

- `retailPrice` клиент **не** присылает — бэкенд ставит `rentPricePerDay × plannedDays`; `items[].sale` — скидка **на единицу**.
- `items` ≥ 1; каждый вариант — один раз (иначе `400`, используйте `quantity`). `customerId` обязателен.
- Создаёт Order (`channel POS`, `status HOLD`, `costAtSale = 0`) + Rental (`BOOKED`). Склад не меняется.
- Ошибки: `400 RENTAL_DISABLED`, `400 VARIANT_NOT_RENTABLE`, `409 NOT_AVAILABLE`, `403` скидка на позиции без OWNER/MANAGER, `400` если `startDate ≥ endDate`, `startDate` в прошлом, скидка больше цены, клиент не найден.

## PATCH /rental/:id

Тело как у `POST /rental`, передаётся **целиком** (позиции и услуги заменяются). Только `BOOKED`.

- Доступность проверяется без учёта самой брони; занято → `409 NOT_AVAILABLE` `{ variantId, available }`, клиент выбирает другой вариант (R11).
- Даты → пересчёт `plannedDays` и `retailPrice`; скидки присылаются заново. Продавец может прислать ту же скидку позиции, что уже сохранена; новую/другую — только OWNER/MANAGER (`403`).
- `startDate` в прошлом — только если он не меняется.
- Новый итог < `paidAmount` → `400 "...already paid..."`.

## GET /rental

```
?pageSize=10&currentPage=1&status=BOOKED,ISSUED&from=2027-05-01&to=2027-05-31&customerId=uuid&overdue=true
&view=returnToday&q=Дилноза&variantId=uuid&sort=asc
```
- `pageSize` по умолчанию 10, максимум 50. Сортировка — `startDate`, `sort=asc|desc` (по умолчанию `desc`).
- `status` — список через запятую (неизвестный → `400`); `from`/`to` — аренды, пересекающие период; `overdue=true` — ISSUED/PARTIALLY_RETURNED с `endDate < now`.
- `view` — быстрый фильтр (2026-11-06):
  - `issueToday` — BOOKED, `startDate` ≤ сегодня 12:00 следующего дня и `endDate > now` (можно выдать сейчас, R5a);
  - `returnToday` — ISSUED/PARTIALLY_RETURNED с `endDate` = сегодня 12:00;
  - `overdue` — как `overdue=true`; `booked` — BOOKED; `out` — ISSUED/PARTIALLY_RETURNED; `all` — без фильтра.
- `q` (≤ 64) — имя клиента (без учёта регистра), цифры телефона (от 3 цифр) или начало кода брони (4–8 hex-символов).
- `variantId` — аренды, в которых есть этот вариант (ближайшие брони вещи).
- OWNER видит весь магазин, остальные — свои склады. Фильтры складываются (AND).

```json
{
  "currentPage": 1, "pageSize": 10, "total": 42,
  "data": [{
    "id": "uuid", "orderId": "uuid", "warehouseId": "uuid", "status": "ISSUED",
    "startDate": "...", "endDate": "...", "plannedDays": 2, "issuedAt": "...", "...": "остальные поля Rental",
    "overdue": false,
    "order": { "id": "uuid", "status": "HOLD", "totalAmount": "1500000", "paidAmount": "500000", "dueAmount": "1000000" },
    "customer": { "id": "uuid", "fullName": "Иванова", "phone": "+998..." },
    "code": "3F2A9C",
    "itemCount": 2,
    "items": [{ "variantId": "uuid", "productName": "Aurora", "imageUrl": "https://...", "quantity": 1 }]
  }]
}
```
- `code` — короткий код брони: первые 6 символов `id` в верхнем регистре (не уникален гарантированно, для показа и поиска).
- `items` — позиции в порядке брони для миниатюр; `imageUrl` — главное фото товара или `null`.

## GET /rental/summary

Счётчики быстрых фильтров (те же условия, что `view` в `GET /rental`), в области видимости пользователя:
```json
{ "issueToday": 3, "returnToday": 2, "overdue": 1, "booked": 8, "out": 4, "all": 15 }
```

## GET /rental/similar

```
?warehouseId=uuid&variantId=uuid&startDate=2027-05-14&endDate=2027-05-16[&excludeRentalId=uuid]
```
Замена для занятой вещи. `variantId` — вариант этого магазина (иначе `404`).
```json
{
  "sameProduct":  [{ "variantId": "uuid", "sku": "AU-48", "productId": "uuid", "productName": "Aurora", "imageUrl": null,
                     "rentPricePerDay": "200000", "attributes": [{ "name": "Размер", "value": "48" }], "owned": 2, "available": 2 }],
  "sameCategory": [ ... ]
}
```
- `sameProduct` — другие сдаваемые варианты того же товара; `sameCategory` — сдаваемые варианты других товаров той же категории (нет категории — пусто). Только с остатком на этом складе, не в архиве, до 20 в каждом списке.
- `available` — свободно на `[startDate 12:00, endDate 12:00)`; занятые (`0`) тоже в списке, свободные — первыми.

## GET /rental/:id

Все поля `Rental` (в т.ч. `issuedWithoutCollateral`) + `overdue` + `code`, а также:
- `collaterals[]` — `{ id, type, description, receivedAt, receivedBy, returnedAt, returnedBy }`;
- `returns[]` — `{ id, returnedAt, penaltyAmount, penaltyComment, earlyReturnRefund, createdBy, items[{ orderItemId, quantity, cleaningDays, availableFrom }] }`;
- `order` — заказ с `customer.user {id, fullName, phone}`, `warehouse {id, name}`, `services[]`, `payments[]`, `dueAmount` и `items[]`:
  `{ id, variantId, quantity, retailPrice, sale, returnedQuantity, variant: { id, sku, barCode, rentPricePerDay, defaultCleaningDays, product {id, name}, attributes[...] } }` (`costAtSale` скрыт).

`dueAmount = totalAmount − paidAmount`; у `CANCELLED` — `0`.

## POST /rental/:id/payments

```json
{
  "payments": [{ "type": "CASH", "amount": 500000 }],
  "collaterals": [{ "type": "PASSPORT", "description": "AA1234567" }],
  "cashboxId": "uuid"
}
```
- Хотя бы один платёж > 0 или залог, иначе `400 "Nothing to save..."`.
- Статусы BOOKED / ISSUED / PARTIALLY_RETURNED. `paidAmount + Σ ≤ totalAmount`.
- Payment + `CashTransaction INCOME / RENTAL` + баланс кассы. В `PARTIALLY_RETURNED` статус заказа пересчитывается (COMPLETED / DEBT); в BOOKED/ISSUED заказ остаётся HOLD.
- Залог без денег — касса не нужна.
- После полного возврата (`RETURNED`) долг гасится существующим `POST /payment`.

## POST /rental/:id/issue

```json
{
  "collaterals": [{ "type": "PASSPORT", "description": "AA1234567" }],
  "payments": [{ "type": "CARD", "amount": 200000 }],
  "cashboxId": "uuid"
}
```
Все поля опциональны. Правила (R5a):
- только `BOOKED`;
- сегодня ≥ дата `startDate` и сейчас < `endDate` 12:00, иначе `400` — сначала `PATCH` дат;
- вещи должны быть свободны на `[now, endDate)` без учёта этой брони, иначе `409 NOT_AVAILABLE` (предыдущий клиент не вернул / химчистка);
- `Rental → ISSUED` (`issuedAt`, `issuedBy`), `Order.soldAt = now`, Order остаётся HOLD.
- `issuedWithoutCollateral = true`, если после выдачи у салона нет ни одного невозвращённого залога (выдано под ответственность продавца) — отметка для истории, выдачу не блокирует.

## GET /rental/:id/cleaning-conflicts

```
?returnedAt=2027-05-16T11:00:00+05:00&items=<orderItemId>:1:1,<orderItemId>:1:2   // orderItemId:quantity:cleaningDays
```
`returnedAt` по умолчанию — сейчас. Только для ISSUED / PARTIALLY_RETURNED. `cleaningDays` 0…30; при 0 конфликтов нет.

```json
[{
  "orderItemId": "uuid",
  "variantId": "uuid",
  "availableFrom": "2027-05-17T06:00:00.000Z",
  "conflicts": [{
    "rentalId": "uuid", "orderId": "uuid", "customerName": "Петрова",
    "startDate": "2027-05-17", "endDate": "2027-05-19",
    "quantity": 1, "availableAtStart": 0
  }]
}]
```
Конфликт — бронь в `BOOKED`, которой на пересечении с химчисткой остаётся свободно `availableAtStart < quantity`. Только предупреждение.

## POST /rental/:id/returns/preview и /returns

```json
{
  "returnedAt": "2027-05-16T15:00:00+05:00",
  "items": [{ "orderItemId": "uuid", "quantity": 1, "cleaningDays": 1 }],
  "penaltyAmount": 300000,
  "penaltyComment": "Порван подол, просрочка 1 день",
  "earlyReturnRefund": 0,
  "refundPaymentType": "CASH",
  "payments": [{ "type": "CASH", "amount": 1000000 }],
  "cashboxId": "uuid"
}
```
- `items` ≥ 1, каждая позиция один раз, `quantity ≤` невозвращённого, `cleaningDays` 0…30 (обязателен; UI по умолчанию ставит `variant.defaultCleaningDays`).
- `returnedAt` (ISO с зоной) — по умолчанию сейчас; не в будущем, не раньше выдачи; в прошлом > 5 мин — только OWNER/MANAGER (`403`).
- `penaltyAmount > 0` требует непустой `penaltyComment`.
- `earlyReturnRefund > 0` — только OWNER/MANAGER (`403`), только если `returnedAt < endDate`, не больше стоимости возвращаемых сейчас позиций (`maxEarlyReturnRefund`).
- Если после этого `paidAmount > нового итога` — переплата выдаётся из кассы (`EXPENSE / RETURN`), `refundPaymentType` обязателен. Платёж в том же запросе, превышающий новый итог, → `400`.
- Preview **ничего не пишет** и касса ему не нужна; те же проверки и те же цифры, что у `/returns`.

Ответ preview (деньги — строки):
```json
{
  "returnedAt": "2027-05-16T10:00:00.000Z",
  "items": [{
    "orderItemId": "uuid", "variantId": "uuid", "quantity": 1, "cleaningDays": 1,
    "availableFrom": "2027-05-17T10:00:00.000Z",
    "plannedDays": 2, "actualDays": 3
  }],
  "penaltyAmount": "300000",
  "earlyReturnRefund": "0",
  "maxEarlyReturnRefund": "0",
  "overdueDays": 1,
  "suggestedPenalty": "350000",
  "unusedDays": 0,
  "unusedDaysAmount": "0",
  "newTotalAmount": "1800000",
  "paidAmount": "500000",
  "paymentsAmount": "0",
  "dueAmount": "1300000",
  "cashOutAmount": "0",
  "paidAmountAfter": "500000",
  "rentalStatusAfter": "RETURNED",
  "orderStatusAfter": "DEBT"
}
```
- `paidAmount` — оплачено до возврата; `paymentsAmount` — платежи этого запроса; `dueAmount` — останется к оплате; `cashOutAmount` — к выдаче клиенту.
- `actualDays` — только подсказка (R2/R4), сумму не меняет.
- Подсказки (2026-11-06), сумму сами **не меняют**:
  - `overdueDays = max(0, actualDays − plannedDays)`; `suggestedPenalty` = Σ (`retailPrice / plannedDays`, цена за день без скидки) × возвращаемые шт × `overdueDays`, округление вниз. Клиент предзаполняет им поле штрафа, продавец меняет или обнуляет (штраф по-прежнему ручной, R4).
  - `unusedDays` — неиспользованные плановые дни при раннем возврате (иначе 0); `unusedDaysAmount` = Σ ((`retailPrice − sale`) / `plannedDays`) × шт × `unusedDays`, округление вниз, не больше `maxEarlyReturnRefund` — подсказка для `earlyReturnRefund` (кнопка «за N дней»).

`/returns` записывает `RentalReturn` + `RentalReturnItem` (`availableFrom = returnedAt + cleaningDays`), обновляет `Order.totalAmount / paidAmount / status` и `Rental.status` (`RETURNED` + `closedAt` или `PARTIALLY_RETURNED`). Ответ — детали аренды.

## POST /rental/:id/collaterals/:collateralId/return

Без тела. Разрешено, если `paidAmount ≥ totalAmount` или аренда `CANCELLED`; иначе `400 "...only after full payment"`. Повторно — `400`. Вещи у клиента не проверяются (UI предупреждает).

## POST /rental/:id/cancel

```json
{ "refundAmount": 300000, "refundPaymentType": "CASH", "reason": "Отмена свадьбы", "cashboxId": "uuid" }
```
- Только OWNER/MANAGER (`403`), только `BOOKED` (выданное — через возврат).
- `0 ≤ refundAmount ≤ paidAmount`; `refundAmount > 0` требует `refundPaymentType` и открытую кассу → `CashTransaction EXPENSE / RETURN`, баланс кассы уменьшается.
- Order → CANCELLED, `paidAmount −= refundAmount`; Rental → CANCELLED (`cancelledAt`, `cancelledBy`, `refundAmount`, `cancelReason`).

---

## Изменения в существующих эндпоинтах

| Эндпоинт | Изменение |
|----------|-----------|
| `PUT /store/:id` | поля `salesEnabled`, `rentalEnabled` (OWNER); хотя бы один `true` |
| Создание/изменение товара и варианта | `canSell`, `canRent`, `rentPricePerDay` (`canRent` ⇒ цена > 0); поля есть в ответах товаров/вариантов/поиска |
| `POST /orders/items` | `AdditionalService.sale` (скидка на услугу, ≤ цены) учитывается в итоге |
| `POST /orders/items`, `POST /orders/payment/:id` | отклоняют заказы с `Rental`, варианты с `canSell = false`, магазин с `salesEnabled = false` |
| `POST /orders/return`, `DELETE /orders/:id`, очистка клиента заказа | отклоняют заказы с `Rental` (`400 "This is a rental order; manage it via the /rental endpoints"`) |
| `POST /payment` (погашение долга) | работает для арендных заказов в DEBT; оплаченное берётся из `order.paidAmount` (выдача переплаты при раннем возврате уменьшает его без отрицательного Payment) |
| `GET /orders/summary` | COMPLETED/DEBT по `soldAt`, плюс заказы с `Rental` в HOLD (выданные, `soldAt` ставится при выдаче) |
| `GET /orders` | арендные заказы видны как обычные (фильтра по типу пока нет) |
