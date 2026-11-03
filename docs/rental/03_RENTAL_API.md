# Аренда — API

Модуль: `billing/src/rental/` (новый). Все эндпоинты — `JwtAuthGuard`, сотрудник магазина с `rentalEnabled = true`. `storeId` / `warehouseId` никогда не берутся из тела запроса.

| Метод | Путь | Назначение | Роли |
|-------|------|-----------|------|
| GET | `/rental/availability` | Свободные единицы вариантов на интервал | все сотрудники |
| GET | `/rental/calendar` | Занятость вариантов по дням (для календаря) | все |
| POST | `/rental` | Создать бронь (Order + Rental) | все |
| PATCH | `/rental/:id` | Изменить бронь (BOOKED) | все; снижение цены — OWNER/MANAGER |
| GET | `/rental` | Список: `status`, `from`, `to`, `customerId`, `overdue`, пагинация | все |
| GET | `/rental/:id` | Детали: заказ, позиции, услуги, платежи, залоги, возвраты | все |
| POST | `/rental/:id/payments` | Предоплата/доплата (BOOKED, ISSUED, PARTIALLY_RETURNED) | все, открытая касса |
| POST | `/rental/:id/issue` | Выдача + залоги + опц. платежи | все |
| GET | `/rental/:id/cleaning-conflicts` | Конфликты химчистки (предупреждение) | все |
| POST | `/rental/:id/returns/preview` | План/факт дней, итог, к оплате/к выдаче (без записи) | все |
| POST | `/rental/:id/returns` | Возврат (полный/частичный) | все; `earlyReturnRefund > 0` — OWNER/MANAGER |
| POST | `/rental/:id/collaterals/:collateralId/return` | Вернуть паспорт/драгоценности | все, при полной оплате (R5) |
| POST | `/rental/:id/cancel` | Отмена брони с возвратом части предоплаты | OWNER, MANAGER |

---

## GET /rental/availability

```
?warehouseId=...&startDate=2027-05-14&endDate=2027-05-16&variantIds=a,b
&excludeRentalId=...   // при редактировании брони — не считать её саму
```
`warehouseId` проверяется через `StaffOnWarehouse`.

```json
[{ "variantId": "a", "owned": 3, "available": 2 }]
```

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
  "services": [{ "name": "Макияж", "price": 900000, "sale": 56250 }],
  "payments": [{ "type": "CASH", "amount": 500000 }],
  "notes": "Свадьба 15.05"
}
```

- `retailPrice` клиент **не** присылает — бэкенд ставит `rentPricePerDay × plannedDays`.
- Ошибки: `400 RENTAL_DISABLED`, `400 VARIANT_NOT_RENTABLE`, `409 NOT_AVAILABLE` (с `variantId`, `available`), `403` при снижении цены без прав, `400` если `startDate ≥ endDate` или в прошлом.

## POST /rental/:id/issue

```json
{
  "collaterals": [{ "type": "PASSPORT", "description": "AA1234567" }],
  "payments": [{ "type": "CARD", "amount": 200000 }]
}
```
Только из BOOKED.

## GET /rental/:id/cleaning-conflicts

```
?returnedAt=2027-05-16T11:00&items=dress-m-item:1:1,suit-item:1:2   // orderItemId:qty:cleaningDays
```
```json
[{
  "orderItemId": "dress-m-item",
  "variantId": "dress-m",
  "availableFrom": "2027-05-17T11:00",
  "conflicts": [{ "rentalId": "...", "orderNumber": "...", "customerName": "...", "startDate": "2027-05-17", "availableAtStart": 0 }]
}]
```

## POST /rental/:id/returns/preview и /returns

```json
{
  "returnedAt": "2027-05-16T15:00:00+05:00",   // по умолчанию now; в прошлое — только OWNER/MANAGER
  "items": [{ "orderItemId": "dress-m-item", "quantity": 1, "cleaningDays": 1 }],
  "penaltyAmount": 300000,                     // повреждение и/или просрочка
  "penaltyComment": "Порван подол, просрочка 1 день",
  "earlyReturnRefund": 0,                      // > 0 — только OWNER/MANAGER (R4)
  "refundPaymentType": "CASH",                 // если из-за earlyReturnRefund нужно выдать деньги
  "payments": [{ "type": "CASH", "amount": 1000000 }]
}
```

Ответ preview:
```json
{
  "items": [{ "orderItemId": "dress-m-item", "plannedDays": 2, "actualDays": 3 }],
  "penaltyAmount": 300000,
  "earlyReturnRefund": 0,
  "newTotalAmount": 1800000,
  "paidAmount": 500000,
  "dueAmount": 1300000,        // к оплате клиентом
  "cashOutAmount": 0,          // к выдаче клиенту (ранний возврат при переплате)
  "rentalStatusAfter": "PARTIALLY_RETURNED"
}
```

## POST /rental/:id/cancel

```json
{ "refundAmount": 300000, "refundPaymentType": "CASH", "reason": "Отмена свадьбы" }
```
`0 ≤ refundAmount ≤ paidAmount`. Только BOOKED.

## PATCH /rental/:id

Тело как у `POST /rental` (без `payments`). Только BOOKED. Доступность проверяется без учёта самой брони; если вариант занят на новые даты — `409 NOT_AVAILABLE` `{ variantId, available }`, клиент выбирает другой вариант (R11).

---

## Изменения в существующих эндпоинтах

| Эндпоинт | Изменение |
|----------|-----------|
| `PUT /store/:id` | поля `salesEnabled`, `rentalEnabled` (OWNER) |
| Создание/изменение товара и варианта | `canSell`, `canRent`, `rentPricePerDay` |
| `POST /orders/items`, `POST /orders/payment/:id` | отклонять заказы с `Rental`; отклонять варианты с `canSell = false`; отклонять, если `salesEnabled = false` |
| `POST /orders/return` (возврат продажи) | отклонять заказы с `Rental` |
| `DELETE /orders/:id` | отклонять заказы с `Rental` (отмена — через `/rental/:id/cancel`) |
| `POST /payment` (погашение долга) | без изменений — работает для арендных заказов в DEBT |
| `GET /orders`, `GET /orders/summary` | показывать арендные заказы; фильтр по типу (опц.) |
