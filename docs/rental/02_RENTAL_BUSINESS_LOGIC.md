# 📖 Бизнес-логика и Workflow Сценарии Системы Аренды

## 📌 Содержание

1. [Основные сценарии](#основные-сценарии)
2. [Сценарий 1: Создание аренды в заказе](#сценарий-1-создание-аренды-в-заказе)
3. [Сценарий 2: Платеж за аренду с залогом](#сценарий-2-платеж-за-аренду-с-залогом)
4. [Сценарий 3: Возврат товара в нормальном состоянии](#сценарий-3-возврат-товара-в-нормальном-состоянии)
5. [Сценарий 4: Возврат поврежденного товара](#сценарий-4-возврат-поврежденного-товара)
6. [Сценарий 5: Ранний возврат товара](#сценарий-5-ранний-возврат-товара)
7. [Сценарий 6: Продление аренды](#сценарий-6-продление-аренды)
8. [Сценарий 7: Товар не возвращен (LATE/LOST)](#сценарий-7-товар-не-возвращен)
9. [Сценарий 8: Бронирование товара](#сценарий-8-бронирование-товара)
10. [Сценарий 9: Клиент решил купить арендованный товар](#сценарий-9-клиент-решил-купить-арендованный-товар)
11. [Смешанный заказ (SALE + RENT)](#смешанный-заказ)

---

## 🎯 Основные сценарии

```
┌─────────────────────────────────────────────────────────────┐
│            ОСНОВНЫЕ БИЗНЕС-ПРОЦЕССЫ АРЕНДЫ                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Клиент бронирует товар на будущие даты (опционально)   │
│  2. Клиент приходит, арендует товар                        │
│  3. Система рассчитывает цену по тарифам                   │
│  4. Клиент платит (аренда + залог, если требуется)         │
│  5. Товар выдается клиенту                                 │
│  6. Клиент использует товар в течение периода              │
│  7. Клиент возвращает товар:                               │
│     ├─ В нормальном состоянии → возврат залога             │
│     ├─ Поврежден → штраф + возврат остатка залога         │
│     ├─ Потерян → конфискация залога                        │
│     └─ Рано → опциональный возврат                         │
│  8. Опционально: продление аренды перед дюдатом            │
│  9. Опционально: клиент решает купить товар                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔷 Сценарий 1: Создание аренды в заказе

### Ситуация
Клиент пришел в магазин и хочет взять платье в аренду на 5 дней.

### Входные данные
```typescript
POST /order
{
  storeId: "store-uuid",
  warehouseId: "warehouse-uuid",
  staffId: "staff-uuid",
  customerId: "customer-uuid",
  channel: "POS",
  
  items: [
    {
      variantId: "dress-M-variant-uuid",
      quantity: 1,
      itemType: "RENT",  // ← НОВОЕ
      rentalStartDate: "2026-08-20T10:00:00Z",
      rentalEndDate: "2026-08-25T10:00:00Z"
    }
  ]
}
```

### Процесс (Транзакция)

#### Шаг 1: Валидация

```typescript
✓ Staff belongs to Store
✓ Staff has access to Warehouse (StaffOnWarehouse)
✓ AuthAccount.isActive = true

✓ ProductVariant exists and belongs to Store
✓ ProductVariant.canRent = true        // ← КРИТИЧНО

✓ rentalStartDate < rentalEndDate      // Даты корректны
✓ rentalStartDate >= now()             // Не в прошлом

✓ getAvailableRentalItems(
    variantId: dress-M,
    startDate: 2026-08-20,
    endDate: 2026-08-25
  ) >= 1                               // ← КРИТИЧНО
```

#### Шаг 2: Расчет цены

```typescript
const rentalDays = daysBetween(
  "2026-08-20", 
  "2026-08-25"
) = 5;

// Найти применимый тариф
const tariff = await RentalRate.findFirst({
  where: {
    productVariantId: "dress-M-variant-uuid",
    minDays: { lte: 5 },
    maxDays: { gte: 5 }  // или null
  }
});

// Результат: tariff.minDays = 3, maxDays = 7, price = 80
const rentalPrice = new Decimal(5).mul(80) = 400 сум
```

#### Шаг 3: Создание Order

```prisma
Order {
  id: "order-uuid",
  storeId: "store-uuid",
  warehouseId: "warehouse-uuid",
  cashierId: "staff-uuid",
  customerId: "customer-uuid",
  channel: "POS",
  status: "CREATED",
  totalAmount: 400,
  paidAmount: 0,
  createdAt: now()
}
```

#### Шаг 4: Создание OrderItem

```prisma
OrderItem {
  id: "orderitem-uuid",
  orderId: "order-uuid",
  variantId: "dress-M-variant-uuid",
  quantity: 1,
  retailPrice: 400,        // Из расчета выше
  sale: 0,
  costAtSale: 50,          // Себестоимость платья (для отчетов)
  itemType: "RENT",        // ← НОВОЕ
  rentalId: NULL,          // Будет заполнено после создания Rental
  createdAt: now()
}
```

#### Шаг 5: Создание Rental

```prisma
Rental {
  id: "rental-uuid",
  orderItemId: "orderitem-uuid",
  
  startDate: "2026-08-20T10:00:00Z",
  dueDate: "2026-08-25T10:00:00Z",
  returnedAt: NULL,
  
  status: "ACTIVE",        // Товар выдан
  rentalPrice: 400,
  
  depositAmount: NULL,     // Пока нет залога
  depositStatus: NULL,
  depositReturnedAt: NULL,
  
  damageFee: NULL,
  damageDescription: NULL,
  damagePhotoUrl: NULL,
  
  earlyReturnRefund: NULL,
  notes: NULL,
  
  createdAt: now()
}
```

#### Шаг 6: Обновление OrderItem с ссылкой на Rental

```prisma
OrderItem.update({
  rentalId: "rental-uuid"
})
```

#### Шаг 7: Создание StockMovement

```prisma
StockMovement {
  id: "stockmove-uuid",
  variantId: "dress-M-variant-uuid",
  warehouseId: "warehouse-uuid",
  type: "OUT",             // Товар выходит со склада
  reason: "RENT",          // ← НОВЫЙ REASON (вместо SALE)
  quantity: -1,            // Минус 1 единица
  unitCost: 50,            // Себестоимость
  createdById: "staff-uuid",
  createdAt: now()
}
```

#### Шаг 8: Обновление Inventory

```typescript
// Автоматически при создании StockMovement
Inventory.update({
  where: {
    warehouseId_variantId: {
      warehouseId: "warehouse-uuid",
      variantId: "dress-M-variant-uuid"
    }
  },
  data: {
    quantity: { decrement: 1 }  // 3 → 2
  }
})
```

#### Шаг 9: Проверка/Создание Cashbox

```prisma
// Если нет открытой кассы — создаем
Cashbox {
  id: "cashbox-uuid",
  sellerId: "staff-uuid",
  storeId: "store-uuid",
  warehouseId: "warehouse-uuid",
  status: "OPEN",
  balance: 0,
  createdAt: now()
}
```

#### Шаг 10: Обновление Order status

```prisma
Order.update({
  status: "HOLD",  // Готов к оплате
  totalAmount: 400
})
```

### Результат

✅ **Создано**:
- Order (HOLD) с totalAmount = 400 сум
- OrderItem (type = RENT, rentalId = "rental-uuid")
- Rental (status = ACTIVE)
- StockMovement (OUT/RENT)
- Cashbox (если её не было)

✅ **Обновлено**:
- Inventory: quantity 3 → 2

✅ **Система знает**:
- Платье находится в аренде с 20.08 по 25.08
- Платье на складе осталось 2 единицы
- Второй клиент не может взять платье на эти даты
- Резервирования на 20-25 августа не смогут быть созданы

---

## 🔷 Сценарий 2: Платеж за аренду с залогом

### Ситуация
Магазин требует залог за платье. Клиент платит 400 сум за аренду + 1000 сум залог наличными.

### Входные данные
```typescript
POST /order/order-uuid/pay
{
  payments: [
    {
      type: "CASH",
      amount: 1400  // 400 (аренда) + 1000 (залог)
    }
  ],
  
  // ← НОВОЕ: Если есть RENT items, можно указать депозит
  rentals: [
    {
      orderItemId: "orderitem-uuid",
      depositAmount: 1000,
      depositType: "CASH",
      depositDescription: null
    }
  ]
}
```

### Процесс (Транзакция)

#### Шаг 1: Валидация

```typescript
✓ Order.status = "HOLD" или "DEBT"
✓ Order.totalAmount = 400

✓ sum(payments) = 1400
✓ sum(payments) >= Order.totalAmount  // 1400 >= 400 ✓

✓ Cashbox.status = "OPEN"
✓ Staff owns Cashbox (или ADMIN/OWNER)
```

#### Шаг 2: Создание Payment для аренды

```prisma
Payment {
  id: "payment1-uuid",
  orderId: "order-uuid",
  type: "CASH",
  amount: 400,  // Только за аренду
  createdBy: "staff-uuid",
  createdAt: now()
}
```

#### Шаг 3: Создание CashTransaction для аренды

```prisma
CashTransaction {
  id: "cashtx1-uuid",
  cashboxId: "cashbox-uuid",
  type: "INCOME",
  category: "RENT",         // ← НОВАЯ КАТЕГОРИЯ
  paymentType: "CASH",
  amount: 400,
  orderId: "order-uuid",
  createdById: "staff-uuid",
  createdAt: now()
}
```

#### Шаг 4: Создание RentalDeposit (если залог)

```prisma
RentalDeposit {
  id: "deposit-uuid",
  rentalId: "rental-uuid",
  amount: 1000,
  type: "CASH",           // ← НОВОЕ ПОЛЕ
  description: null,
  paidAt: now(),
  returnedAt: null,
  status: "HELD",         // Деньги удерживаются в кассе
  createdAt: now()
}
```

#### Шаг 5: Создание Payment для залога

```prisma
Payment {
  id: "payment2-uuid",
  orderId: "order-uuid",
  type: "CASH",
  amount: 1000,           // Залог
  createdBy: "staff-uuid",
  createdAt: now()
}
```

#### Шаг 6: Создание CashTransaction для залога

```prisma
CashTransaction {
  id: "cashtx2-uuid",
  cashboxId: "cashbox-uuid",
  type: "INCOME",
  category: "RENT_DEPOSIT",  // ← НОВАЯ КАТЕГОРИЯ
  paymentType: "CASH",
  amount: 1000,
  orderId: "order-uuid",
  debtId: null,
  createdById: "staff-uuid",
  createdAt: now()
}
```

#### Шаг 7: Обновление Cashbox

```typescript
Cashbox.update({
  balance: { increment: 1400 }  // 0 + 400 + 1000
})
```

#### Шаг 8: Обновление Order

```prisma
Order.update({
  status: "COMPLETED",   // Полностью оплачен
  paidAmount: 1400
})
```

#### Шаг 9: Обновление Rental с информацией о депозите

```prisma
Rental.update({
  depositAmount: 1000,
  depositStatus: "HELD",
  depositReturnedAt: null
})
```

### Результат

✅ **Создано**:
- Payment #1: 400 сум (за аренду)
- Payment #2: 1000 сум (залог)
- CashTransaction #1: INCOME/RENT (400)
- CashTransaction #2: INCOME/RENT_DEPOSIT (1000)
- RentalDeposit: 1000 сум, status HELD

✅ **Обновлено**:
- Cashbox.balance: 0 → 1400
- Order.status: HOLD → COMPLETED
- Order.paidAmount: 0 → 1400
- Rental.depositAmount: 1000
- Rental.depositStatus: HELD

✅ **В системе**:
```
КАССА (cashbox):
├─ Доход от аренды: 400 сум
├─ Залог (удерживается): 1000 сум
└─ Итого баланс: 1400 сум

ЗАКАЗ (order):
├─ Статус: COMPLETED
├─ Товар выдан клиенту
└─ Залог внесен
```

---

## 🔷 Сценарий 3: Возврат товара в нормальном состоянии

### Ситуация
Прошло 5 дней, клиент вернул платье в нормальном состоянии. Требуется вернуть залог.

### Входные данные
```typescript
POST /rental/rental-uuid/return
{
  damageStatus: "NONE",           // Товар в нормальном состоянии
  damageDescription: null,
  damagePhotoUrl: null,
  
  // Staff решает: возвращать ли залог?
  shouldRefundDeposit: true,
  refundAmount: null              // Система посчитает автоматически
}
```

### Процесс (Транзакция)

#### Шаг 1: Валидация

```typescript
✓ Rental.status = "ACTIVE"
✓ Rental.returnedAt = null
✓ RentalDeposit exists and status = "HELD"
✓ Cashbox.status = "OPEN"
```

#### Шаг 2: Обновление Rental

```prisma
Rental.update({
  returnedAt: now(),
  status: "RETURNED",    // Товар возвращен
  damageFee: null,       // Нет ущерба
  damageDescription: null,
  damagePhotoUrl: null
})
```

#### Шаг 3: Создание StockMovement

```prisma
StockMovement {
  id: "stockmove-return-uuid",
  variantId: "dress-M-variant-uuid",
  warehouseId: "warehouse-uuid",
  type: "IN",                // Товар возвращается на склад
  reason: "RENT_RETURN",     // ← НОВЫЙ REASON
  quantity: 1,               // Плюс 1 единица
  unitCost: 50,
  createdById: "staff-uuid",
  createdAt: now()
}
```

#### Шаг 4: Обновление Inventory

```typescript
Inventory.update({
  quantity: { increment: 1 }  // 2 → 3
})
```

#### Шаг 5: Возврат залога (если shouldRefundDeposit = true)

```prisma
RentalDeposit.update({
  returnedAt: now(),
  status: "RETURNED"     // Залог возвращен
})
```

#### Шаг 6: Создание Payment для возврата залога

```prisma
Payment {
  id: "refund-payment-uuid",
  orderId: "order-uuid",
  type: "CASH",
  amount: -1000,         // Отрицательная сумма = возврат
  createdBy: "staff-uuid",
  createdAt: now()
}
```

#### Шаг 7: Создание CashTransaction для возврата

```prisma
CashTransaction {
  id: "cashtx-refund-uuid",
  cashboxId: "cashbox-uuid",
  type: "EXPENSE",           // Выплата клиенту
  category: "RENT_DEPOSIT",  // Возврат залога
  paymentType: "CASH",
  amount: 1000,
  orderId: "order-uuid",
  createdById: "staff-uuid",
  createdAt: now()
}
```

#### Шаг 8: Обновление Cashbox

```typescript
Cashbox.update({
  balance: { decrement: 1000 }  // 1400 - 1000 = 400
})
```

#### Шаг 9: Финальные данные

```
Касса (cashbox):
├─ Начальный баланс: 1400 сум
├─ Минус возврат залога: -1000 сум
└─ ИТОГО баланс: 400 сум  ← доход магазина от аренды
```

### Результат

✅ **Создано**:
- StockMovement (IN/RENT_RETURN)
- Payment (возврат -1000)
- CashTransaction (EXPENSE/RENT_DEPOSIT)

✅ **Обновлено**:
- Rental.status: ACTIVE → RETURNED
- Rental.returnedAt: now()
- Inventory.quantity: 2 → 3
- RentalDeposit.status: HELD → RETURNED
- Cashbox.balance: 1400 → 400

✅ **Финансовый итог**:
```
Касса получила:
├─ Платеж за аренду: +400 сум (ОСТАЕТСЯ)
├─ Залог внесен: +1000 сум
└─ Залог возвращен: -1000 сум (УХОДИТ)
───────────────────────────────
ИТОГО ДОХОД: 400 сум
```

---

## 🔷 Сценарий 4: Возврат поврежденного товара

### Ситуация
Клиент вернул платье, но оно повреждено (порвано). Стафф осматривает товар и определяет штраф в 300 сум. Залог был 1000 сум.

### Входные данные
```typescript
POST /rental/rental-uuid/return
{
  damageStatus: "DAMAGED",
  damageDescription: "Порвано в области подола",
  damagePhotoUrl: "s3://bucket/damage-photo.jpg",
  
  // Staff определяет штраф
  shouldRefundDeposit: true,
  refundAmount: null              // Система посчитает
}
```

### Процесс (Транзакция)

#### Шаг 1-4: (Как в Сценарии 3)

```prisma
Rental.update({
  returnedAt: now(),
  status: "DAMAGED"              // ← ИНОЙ статус
})

StockMovement {
  type: "OUT",
  reason: "WRITE_OFF"            // ← Товар списан
}

Inventory.update({
  quantity: { decrement: 1 }     // Товар НЕ возвращается на склад
})
```

#### Шаг 5: Создание платежа за ущерб

```prisma
Payment {
  id: "damage-fee-payment-uuid",
  orderId: "order-uuid",
  type: "CASH",
  amount: 300,  // Штраф за ущерб
  createdBy: "staff-uuid",
  createdAt: now()
}
```

#### Шаг 6: Создание CashTransaction за ущерб

```prisma
CashTransaction {
  id: "cashtx-damage-uuid",
  cashboxId: "cashbox-uuid",
  type: "INCOME",
  category: "DAMAGE",           // ← НОВАЯ КАТЕГОРИЯ
  paymentType: "CASH",
  amount: 300,
  orderId: "order-uuid",
  createdById: "staff-uuid",
  createdAt: now()
}
```

#### Шаг 7: Обновление Rental с информацией об ущербе

```prisma
Rental.update({
  damageFee: 300,
  damageDescription: "Порвано в области подола",
  damagePhotoUrl: "s3://bucket/damage-photo.jpg"
})
```

#### Шаг 8: Возврат остатка залога (если depositAmount > damageFee)

```typescript
const depositAmount = 1000;
const damageFee = 300;
const refundAmount = depositAmount - damageFee; // 700 сум

// Если refundAmount > 0
if (refundAmount > 0) {
  Payment {
    amount: -refundAmount  // Возврат остатка
  }
  
  CashTransaction {
    type: "EXPENSE",
    category: "RENT_DEPOSIT",
    amount: refundAmount
  }
}
```

#### Шаг 9: Обновление Cashbox

```typescript
// Шаг по шагам:
// 1. Было: 1400 (400 аренда + 1000 залог)
// 2. Добавляем штраф за ущерб: +300
// 3. Возвращаем остаток залога: -700
// Итого: 1400 + 300 - 700 = 1000

Cashbox.update({
  balance: { increment: 300 },   // +300 (штраф)
  balance: { decrement: 700 }    // -700 (возврат остатка)
})
// Или просто: balance = 1000
```

#### Шаг 10: Обновление RentalDeposit

```prisma
RentalDeposit.update({
  status: "FORFEITED",   // Залог частично конфискован
  returnedAt: now()
})
```

### Результат

✅ **Создано**:
- StockMovement (OUT/WRITE_OFF)
- Payment (штраф: +300)
- Payment (возврат остатка: -700)
- CashTransaction (INCOME/DAMAGE)
- CashTransaction (EXPENSE/RENT_DEPOSIT)

✅ **Обновлено**:
- Rental.status: ACTIVE → DAMAGED
- Rental.damageFee: 300
- Rental.damageDescription: "Порвано в области подола"
- Inventory.quantity: 2 → 1 (товар списан)
- RentalDeposit.status: HELD → FORFEITED
- Cashbox.balance: 1400 → 1000

✅ **Финансовый итог**:
```
Касса получила:
├─ Платеж за аренду: +400 сум (ОСТАЕТСЯ)
├─ Залог внесен: +1000 сум
├─ Штраф за ущерб: +300 сум (ОСТАЕТСЯ)
└─ Возврат остатка залога: -700 сум
───────────────────────────────
ИТОГО ДОХОД: 400 + 300 = 700 сум
ВОЗВРАЩЕНО КЛИЕНТУ: 700 сум
```

---

## 🔷 Сценарий 5: Ранний возврат товара

### Ситуация
Клиент взял платье на 5 дней (с 20 по 25 августа) за 400 сум, но вернул его на 3-й день (22 августа).

**Дополнительные условия**:
- OrderItem.allowEarlyReturnRefund = true
- OrderItem.earlyReturnRefundType = "FULL"

### Входные данные
```typescript
POST /rental/rental-uuid/return
{
  damageStatus: "NONE",
  shouldRefundDeposit: true,
  
  // ← НОВОЕ: обработка раннего возврата
  earlyReturn: {
    actualReturnDate: "2026-08-22T10:00:00Z",  // Вернул раньше
    refundPolicy: "FULL"                       // Или "CUSTOM"
  }
}
```

### Процесс (Транзакция)

#### Шаг 1: Расчет возврата

```typescript
// Базовые данные
const startDate = "2026-08-20";
const dueDate = "2026-08-25";
const returnedDate = "2026-08-22";
const rentalPrice = 400;
const daysScheduled = 5;
const daysUsed = 2;  // 20-22
const daysRemaining = 3;  // 22-25

// В зависимости от политики:

// Политика: FULL
if (policy === "FULL") {
  const refundAmount = (daysRemaining / daysScheduled) * rentalPrice;
  // (3 / 5) * 400 = 240 сум
}

// Политика: NONE
else if (policy === "NONE") {
  const refundAmount = 0;  // Возврата нет
}

// Политика: CUSTOM
else if (policy === "CUSTOM") {
  const refundAmount = staff.determines();  // Стафф сам решает
}
```

#### Шаг 2: Создание платежа возврата (если refundAmount > 0)

```prisma
Payment {
  id: "early-return-refund-uuid",
  orderId: "order-uuid",
  type: "CASH",
  amount: -240,  // Возврат 240 сум
  createdBy: "staff-uuid",
  createdAt: now()
}
```

#### Шаг 3: Создание CashTransaction

```prisma
CashTransaction {
  id: "cashtx-early-return-uuid",
  cashboxId: "cashbox-uuid",
  type: "EXPENSE",
  category: "RENT",          // Возврат части платежа за аренду
  paymentType: "CASH",
  amount: 240,
  orderId: "order-uuid",
  createdById: "staff-uuid",
  createdAt: now()
}
```

#### Шаг 4: Обновление Rental

```prisma
Rental.update({
  returnedAt: "2026-08-22T10:00:00Z",
  status: "RETURNED",
  earlyReturnRefund: 240  // ← НОВОЕ ПОЛЕ
})
```

#### Шаг 5-9: (Как обычно)

- Создание StockMovement (IN/RENT_RETURN)
- Обновление Inventory (quantity +1)
- Возврат залога (1000)
- Обновление Cashbox

#### Шаг 10: Обновление Cashbox

```typescript
// Рассчитаем общий баланс:
const startBalance = 1400;  // 400 (аренда) + 1000 (залог)
const earlyReturnRefund = 240;  // Возврат части аренды
const depositRefund = 1000;     // Возврат залога
const finalBalance = 1400 - 240 - 1000 = 160;

// Но это не совсем верно. На самом деле:
// Касса ПОЛУЧИЛА за аренду: 400 - 240 = 160 сум
// Касса ПОЛУЧИЛА залог, потом вернула: 1000 - 1000 = 0
// ИТОГО в кассе: 160 сум

Cashbox.update({
  balance: { decrement: 240 },   // -240 (возврат за неиспользованные дни)
  balance: { decrement: 1000 }   // -1000 (возврат залога)
})
// Итого: 1400 - 240 - 1000 = 160
```

### Результат

✅ **Создано**:
- StockMovement (IN/RENT_RETURN)
- Payment (возврат -240 за неиспользованные дни)
- Payment (возврат -1000 залога)
- CashTransaction (EXPENSE/RENT, -240)
- CashTransaction (EXPENSE/RENT_DEPOSIT, -1000)

✅ **Обновлено**:
- Rental.returnedAt: 2026-08-22
- Rental.earlyReturnRefund: 240
- Inventory.quantity: 2 → 3
- Cashbox.balance: 1400 → 160

✅ **Финансовый итог**:
```
Касса получила:
├─ Платеж за аренду: 400 сум
│  └─ Вернули за неиспользованные дни: -240 сум
│  └─ ИТОГО за аренду: 160 сум ✓
│
├─ Залог внесен: 1000 сум
│  └─ Вернули клиенту: -1000 сум
│  └─ ИТОГО залог: 0 сум
│
└── ИТОГО ДОХОД МАГАЗИНА: 160 сум
```

---

## 🔷 Сценарий 6: Продление аренды

### Ситуация
Клиент использует платье и хочет продлить аренду еще на 3 дня (с 25 августа на 28 августа).

### Входные данные
```typescript
POST /rental/rental-uuid/extend
{
  newDueDate: "2026-08-28T10:00:00Z",
  additionalFee: null  // Система может рассчитать или стафф ввести
}
```

### Процесс (Транзакция)

#### Шаг 1: Валидация

```typescript
✓ Rental.status = "ACTIVE"
✓ Rental.returnedAt = null

✓ newDueDate > Rental.dueDate  // 2026-08-28 > 2026-08-25
✓ newDueDate > now()           // Не в прошлом

// КРИТИЧНО: проверка доступности на новые даты
✓ getAvailableRentalItems(
    variantId,
    currentDueDate: "2026-08-25",  // От текущего дюдата
    newDueDate: "2026-08-28"       // До новой даты
  ) >= 1
  
  // Если другой клиент не забронировал платье на 26-28 августа
  // Если нет других ACTIVE аренд на эту дату
  // → Продление возможно
```

#### Шаг 2: Расчет доп платежа (опционально)

```typescript
const additionalDays = daysBetween("2026-08-25", "2026-08-28") = 3;

// Найти тариф для 3 дней (может отличаться от основного)
const tariff = getRentalRate(variantId, additionalDays);
// Результат: 3 дня в диапазоне "3-7 дней = 80 сум/день"

const additionalFee = 3 * 80 = 240 сум;
```

#### Шаг 3: Создание Payment для доп платежа

```prisma
Payment {
  id: "extension-payment-uuid",
  orderId: "order-uuid",
  type: "CASH",
  amount: 240,
  createdBy: "staff-uuid",
  createdAt: now()
}
```

#### Шаг 4: Создание CashTransaction

```prisma
CashTransaction {
  id: "cashtx-extension-uuid",
  cashboxId: "cashbox-uuid",
  type: "INCOME",
  category: "RENT",
  paymentType: "CASH",
  amount: 240,
  orderId: "order-uuid",
  createdById: "staff-uuid",
  createdAt: now()
}
```

#### Шаг 5: Обновление Rental

```prisma
Rental.update({
  dueDate: "2026-08-28T10:00:00Z",  // Новая дата возврата
  rentalPrice: { increment: 240 }   // Плюс стоимость продления
})
```

#### Шаг 6: Обновление Cashbox

```typescript
Cashbox.update({
  balance: { increment: 240 }  // +240 за продление
})
```

#### Шаг 7: Обновление Order (опционально)

```prisma
Order.update({
  totalAmount: { increment: 240 },
  paidAmount: { increment: 240 }
})
```

### Результат

✅ **Создано**:
- Payment (240 сум за продление)
- CashTransaction (INCOME/RENT, 240)

✅ **Обновлено**:
- Rental.dueDate: 2026-08-25 → 2026-08-28
- Rental.rentalPrice: 400 → 640
- Cashbox.balance: 400 → 640
- Order.totalAmount: 400 → 640

✅ **Итоговая аренда**:
```
Платье M:
├─ Первоначально: 5 дней (20-25.08) × 80 = 400 сум
├─ Продление: 3 дня (25-28.08) × 80 = 240 сум
└─ ИТОГО: 8 дней за 640 сум
```

---

## 🔷 Сценарий 7: Товар не возвращен (LATE/LOST)

### Ситуация
Дюдат истек (25 августа), но клиент не вернул платье. Прошло еще 2 дня (сейчас 27 августа).

### Входные данные (Auto Job или Manual Action)

```typescript
// Можно сделать через job который запускается каждый день
POST /rental/rental-uuid/mark-late
{
  lateFee?: Decimal  // Штраф за задержку (опционально)
}
```

### Процесс

#### Шаг 1: Обновление Rental

```prisma
Rental.update({
  status: "LATE"  // Товар не возвращен в срок
})
```

#### Шаг 2: Если нужно добавить штраф (опционально)

```prisma
Payment {
  amount: lateFee  // Штраф за просрочку
}

CashTransaction {
  category: "DAMAGE"  // Можно отнести сюда
  amount: lateFee
}
```

#### Шаг 3: Уведомление клиента (внешняя система)

```
Клиент получает SMS/Email:
"Платье М должно было быть возвращено 25.08
Текущая задолженность: {lateFee} сум
Просьба вернуть немедленно"
```

---

### Если товар потерян

```typescript
POST /rental/rental-uuid/mark-lost
{
  damageDescription: "Товар потерян",
  shouldConfiscateDeposit: true
}
```

**Процесс**:
- Rental.status = "LOST"
- RentalDeposit.status = "FORFEITED" (залог конфискован)
- StockMovement (OUT/WRITE_OFF) — товар списан
- Inventory (quantity -1)
- Cashbox (залог остается у магазина)

---

## 🔷 Сценарий 8: Бронирование товара

### Ситуация
Клиент хочет забронировать платье на 2-3 сентября, но сейчас оно занято. Он создает бронирование.

### Входные данные

```typescript
POST /rental/reserve
{
  productVariantId: "dress-M-variant-uuid",
  customerId: "customer-uuid",
  storeId: "store-uuid",
  rentalStartDate: "2026-09-02T10:00:00Z",
  rentalEndDate: "2026-09-03T10:00:00Z",
  notes: "Нужно для свадьбы"
}
```

### Процесс

#### Шаг 1: Валидация

```typescript
✓ ProductVariant.canRent = true
✓ rentalStartDate < rentalEndDate
✓ rentalStartDate > now()

✓ getAvailableRentalItems(startDate, endDate) >= 1
  
  // Если нет доступного товара → ошибка
  // Если есть → создаем бронирование
```

#### Шаг 2: Создание Reservation

```prisma
Reservation {
  id: "reservation-uuid",
  productVariantId: "dress-M-variant-uuid",
  customerId: "customer-uuid",
  storeId: "store-uuid",
  
  rentalStartDate: "2026-09-02T10:00:00Z",
  rentalEndDate: "2026-09-03T10:00:00Z",
  
  status: "PENDING",     // Ожидание подтверждения
  convertedToRentalId: null,
  
  notes: "Нужно для свадьбы",
  expiresAt: now() + 24 hours,  // Бронь действительна 24 часа
  
  createdAt: now()
}
```

#### Шаг 3: Уведомление клиента

```
Клиент получает:
"Платье зарезервировано на 2-3 сентября
Бронь действительна до {expiresAt}
Подтвердите бронирование в приложении"
```

#### Шаг 4: Когда клиент подтверждает

```typescript
PATCH /reservation/reservation-uuid/confirm
{
  confirmed: true
}

// Обновление
Reservation.update({
  status: "CONFIRMED"
})
```

#### Шаг 5: Когда наступает дата (2-3 сентября)

```typescript
// При создании заказа с этой датой:
Rental {
  // ...
}

Reservation.update({
  status: "CONVERTED_TO_RENTAL",
  convertedToRentalId: "rental-uuid"
})
```

---

## 🔷 Сценарий 9: Клиент решил купить арендованный товар

### Ситуация
Клиент использовал платье в аренде и решил его купить (вместо возврата).

### Входные данные

```typescript
POST /rental/rental-uuid/purchase
{
  purchasePrice: 5000,  // Цена покупки (может быть со скидкой)
  deductFromDeposit: true  // Зачесть залог в стоимость
}
```

### Процесс

#### Шаг 1: Создание нового Order и OrderItem

```prisma
OrderItem {
  orderId: "new-order-uuid",
  variantId: "dress-M-variant-uuid",
  quantity: 1,
  itemType: "SALE",    // ← Теперь это продажа
  retailPrice: 5000,
  sale: 0
}
```

#### Шаг 2: Обновление Rental

```prisma
Rental.update({
  status: "PURCHASED",
  purchasedAt: now(),
  purchaseOrderItemId: "new-orderitem-uuid"
})
```

#### Шаг 3: Стоимость платежа

```typescript
const purchasePrice = 5000;
const depositOnHand = 1000;

if (deductFromDeposit) {
  const remainingPrice = purchasePrice - depositOnHand; // 4000
  
  // Клиент платит только остаток
  // Залог зачисляется в счет покупки
  
  Payment {
    amount: 4000
  }
} else {
  // Залог возвращается, клиент платит полную цену
  Payment {
    amount: 5000
  }
  // Плюс отдельный возврат залога
}
```

#### Шаг 4: Финальное состояние

```
Rental.status = "PURCHASED"
OrderItem.itemType = "SALE"
Inventory -> товар остается как проданный
```

---

## 🔷 Смешанный заказ (SALE + RENT)

### Ситуация
Клиент хочет купить туфли и взять платье в аренду одновременно.

### Входные данные

```typescript
POST /order
{
  storeId: "store-uuid",
  customerId: "customer-uuid",
  items: [
    {
      variantId: "shoes-uuid",
      quantity: 1,
      itemType: "SALE",           // Туфли — продажа
      retailPrice: 500,
      sale: 0
    },
    {
      variantId: "dress-M-uuid",
      quantity: 1,
      itemType: "RENT",           // Платье — аренда
      rentalStartDate: "2026-08-20",
      rentalEndDate: "2026-08-25"
    }
  ]
}
```

### Процесс

#### Этап 1: Создание Order

```prisma
Order {
  totalAmount: 500 + 400 = 900,  // Туфли + Аренда платья
  paidAmount: 0
}
```

#### Этап 2: Создание OrderItems

```prisma
// Item 1: Туфли (SALE)
OrderItem {
  itemType: "SALE",
  retailPrice: 500
}

// Item 2: Платье (RENT)
OrderItem {
  itemType: "RENT",
  rentalId: "rental-uuid"
}
```

#### Этап 3: Создание движений

```prisma
// Туфли (продажа)
StockMovement {
  reason: "SALE",
  quantity: -1
}

// Платье (аренда)
StockMovement {
  reason: "RENT",
  quantity: -1
}

Rental {
  status: "ACTIVE"
}
```

#### Этап 4: Оплата

```typescript
// Один платеж на всю сумму
Payment {
  amount: 900  // За всё вместе
}

CashTransaction #1 {
  category: "SALE",
  amount: 500
}

CashTransaction #2 {
  category: "RENT",
  amount: 400
}
```

#### Этап 5: Finalize

```
Order.status = COMPLETED
Tuфли: проданы и уходят со склада навсегда
Платье: в аренде до 25.08, потом вернется
```

---

## 📊 Резюме Workflow

| Сценарий              | Статус Rental | Inventory | StockMovement  | CashTransaction        |
| --------------------- | ------------- | --------- | -------------- | ---------------------- |
| 1. Создание аренды    | ACTIVE        | -1        | OUT/RENT       | INCOME/RENT            |
| 3. Возврат нормальный | RETURNED      | +1        | IN/RENT_RETURN | EXPENSE/RENT_DEPOSIT   |
| 4. Возврат поврежден  | DAMAGED       | -1        | OUT/WRITE_OFF  | INCOME/DAMAGE          |
| 5. Ранний возврат     | RETURNED      | +1        | IN/RENT_RETURN | EXPENSE/RENT (возврат) |
| 6. Продление          | ACTIVE        | —         | —              | INCOME/RENT            |
| 7. LATE/LOST          | LATE/LOST     | -1        | OUT/WRITE_OFF  | INCOME/DAMAGE (штраф)  |
| 8. Бронирование       | —             | —         | —              | —                      |
| 9. Покупка            | PURCHASED     | —         | —              | INCOME/SALE            |

