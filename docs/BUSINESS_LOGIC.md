# Бизнес-логика Billing System

## Содержание
1. [Жизненный цикл заказа](#жизненный-цикл-заказа)
2. [Управление кассой (Cashbox)](#управление-кассой-cashbox)
3. [Возврат товаров](#возврат-товаров)
4. [Управление долгами](#управление-долгами)
5. [Управление инвентарем](#управление-инвентарем)
6. [Роли и права доступа](#роли-и-права-доступа)
7. [Товары и варианты](#товары-и-варианты)

---

## Жизненный цикл заказа

### Статусы заказа (OrderStatus)
```
CREATED → HOLD → [DEBT | COMPLETED] → [REFUNDED | CANCELLED]
```

1. **CREATED** — заказ создан, но товары еще не добавлены
2. **HOLD** — товары добавлены, заказ готов к оплате (inventory еще НЕ списан)
3. **DEBT** — частичная оплата (paidAmount < totalAmount)
4. **COMPLETED** — полностью оплачен (paidAmount >= totalAmount)
5. **CANCELLED** — отменен (до оплаты)
6. **REFUNDED** — возвращен

### Этап 1: Создание заказа
**Endpoint**: `POST /order`

**Что происходит**:
1. Валидация staff:
   - Staff должен принадлежать указанному магазину
   - Staff должен иметь доступ к указанному складу (через `StaffOnWarehouse`)
   - AuthAccount должен быть активен

2. Проверка/создание открытой кассы:
   ```sql
   SELECT * FROM cashbox 
   WHERE storeId = :storeId 
     AND warehouseId = :warehouseId 
     AND sellerId = :staffId 
     AND status = 'OPEN'
   ```
   - Если кассы нет → создается новая с `balance = 0`
   - Если есть → используется существующая

3. Создание заказа:
   ```typescript
   Order {
     status: CREATED,
     totalAmount: 0,
     paidAmount: 0,
     storeId: dto.storeId,
     warehouseId: dto.warehouseId,
     cashierId: staff.id,
     customerId: dto.customerId || null,
     channel: dto.channel (POS | ONLINE)
   }
   ```

### Этап 2: Добавление товаров
**Endpoint**: `POST /order/:id/items`

**Что происходит**:
1. Валидация статуса заказа:
   - Должен быть `CREATED` или `HOLD`

2. Валидация товаров:
   - Все variantId должны существовать
   - Все варианты должны принадлежать магазину заказа
   - Проверка наличия на складе заказа:
     ```typescript
     const available = inventory.quantity;
     const requested = sum(items.where(variantId).quantity);
     if (requested > available) throw Error('Insufficient stock');
     ```

3. Создание/обновление OrderItem:
   - Если `itemId` передан и существует → UPDATE
   - Если `itemId` передан, но не существует → CREATE
   - Если `itemId` не передан → CREATE

4. Управление AdditionalService (доп. услуги):
   - Если `service.id` есть в DTO и существует → UPDATE
   - Если `service.id` есть в DTO, но не существует → игнорируется
   - Если `service.id` не передан → CREATE
   - Удаление: если service существует в БД, но нет в DTO → DELETE

5. Удаление OrderItem:
   - Если OrderItem есть в БД, но нет в DTO → DELETE

6. Пересчет totalAmount:
   ```typescript
   totalAmount = sum(items.map(i => (i.retailPrice - i.sale) * i.quantity))
               + sum(services.map(s => s.price))
   ```

7. Обновление статуса → `HOLD`

**Важно**: На этом этапе inventory НЕ списывается! Это происходит только при оплате.

### Этап 3: Оплата заказа
**Endpoint**: `POST /order/:id/pay`

**Что происходит**:
1. Валидация статуса заказа:
   - Должен быть `HOLD` или `DEBT`

2. Валидация суммы платежа:
   ```typescript
   const totalPaidBefore = sum(order.payments.map(p => p.amount));
   const newPaid = sum(dto.payments.map(p => p.amount));
   const totalPaid = totalPaidBefore + newPaid;
   
   if (totalPaid > order.totalAmount) {
     throw Error('Payment amount exceeds order total');
   }
   ```

3. Проверка открытой кассы:
   ```sql
   SELECT * FROM cashbox 
   WHERE storeId = order.storeId 
     AND warehouseId = order.warehouseId 
     AND sellerId = staff.id 
     AND status = 'OPEN'
   ```

4. **Транзакция** (все атомарно):

   a. Создание Payment записей:
   ```typescript
   Payment {
     orderId: order.id,
     type: payment.type (CASH | CARD | ONLINE | TRANSFER),
     amount: payment.amount,
     createdBy: staff.id
   }
   ```

   b. Создание CashTransaction записей:
   ```typescript
   CashTransaction {
     cashboxId: cashbox.id,
     type: INCOME,
     category: SALE,
     paymentType: payment.type,
     amount: payment.amount,
     orderId: order.id,
     createdById: staff.id
   }
   ```

   c. Создание StockMovement записей:
   ```typescript
   StockMovement {
     type: OUT,
     reason: SALE,
     variantId: item.variantId,
     quantity: item.quantity,
     unitCost: item.costAtSale,
     warehouseId: order.warehouseId,
     createdById: staff.id
   }
   ```

   d. Списание inventory (атомарно с проверкой):
   ```typescript
   // Группируем по variantId, чтобы списать один раз на вариант
   for (const [variantId, needQty] of qtyByVariantId) {
     const updated = await prisma.inventory.updateMany({
       where: {
         warehouseId: order.warehouseId,
         variantId: variantId,
         quantity: { gte: needQty } // НЕ уйдет в минус!
       },
       data: {
         quantity: { decrement: needQty }
       }
     });
     
     if (updated.count !== 1) {
       throw Error('Insufficient stock'); // Rollback всей транзакции
     }
   }
   ```

   e. Определение нового статуса заказа:
   ```typescript
   const status = totalPaid >= order.totalAmount 
     ? OrderStatus.COMPLETED 
     : OrderStatus.DEBT;
   ```

   f. Обновление заказа:
   ```typescript
   Order {
     status: status,
     paidAmount: totalPaid,
     customerId: customerId || null
   }
   ```

   g. Обновление баланса кассы:
   ```typescript
   Cashbox {
     balance: { increment: newPaid }
   }
   ```

### Отмена заказа
**Endpoint**: `DELETE /order/:id`

**Условия**:
- Статус НЕ `COMPLETED`, `DEBT`, `REFUNDED`
- Нет платежей (`payments.length === 0`)
- Staff принадлежит магазину (или ADMIN/OWNER может отменить любой)

**Что происходит**:
- Заказ переводится в статус `CANCELLED`
- Inventory НЕ изменяется (т.к. он еще не был списан)

---

## Управление кассой (Cashbox)

### Концепция
**Cashbox** (касса) нужна для **разделения доходов разных продавцов** на одном складе.

**Пример**: У магазина один склад, но работают 2 продавца. Чтобы не перемешивать, кто сколько заработал, у каждого продавца своя касса.

### Открытие кассы
**Endpoint**: `POST /cashbox`

**Условия**:
- У продавца НЕТ уже открытой кассы на этом складе/магазине
- Можно указать начальный баланс (`balance`, default: 0)

**Что происходит**:
```typescript
Cashbox {
  storeId: dto.storeId,
  warehouseId: dto.warehouseId,
  sellerId: staff.id,
  status: OPEN,
  balance: dto.balance || 0
}
```

### Закрытие кассы
**Endpoint**: `POST /cashbox/:id/close`

**Условия**:
- Касса должна быть `OPEN`
- Staff должен быть владельцем кассы (или ADMIN/OWNER может закрыть любую)

**Что происходит**:
- Статус → `CLOSED`
- После закрытия **НЕЛЬЗЯ** добавлять новые транзакции

**Важно**: Логика с остатками (что делать с `balance` после закрытия) пока не реализована и требует отдельной проработки.

### Добавление транзакции в кассу (ручные операции)
**Endpoint**: `POST /cashbox/:id/transaction`

**Условия**:
- Касса должна быть `OPEN`
- Staff должен быть владельцем кассы (или ADMIN/OWNER)

#### Типы ручных транзакций

**1. INCOME (Приход денег в кассу)**

Используется когда:
- Кто-то принес деньги, но кассир **не знает точно**, на что это (неопознанный платеж)
- Планируется потом связать с конкретным назначением для отчетности
- Аванс от клиента
- Возврат займа
- Прочие поступления

Пример:
```typescript
{
  type: INCOME,
  category: OTHER,
  paymentType: CASH,
  amount: 5000,
  comment: "Клиент Иванов принес деньги, уточнить назначение"
}
```

**Что происходит**:
- CashTransaction создается (INCOME, OTHER)
- Cashbox.balance увеличивается на `amount`
- `orderId` и `debtId` остаются `null` (потом можно связать)

**2. EXPENSE (Расход денег из кассы)**

Используется когда:
- Нужно выдать деньги клиенту (возврат)
- Кто-то взял из кассы на личные нужды (купить попить, поесть)
- Выдача зарплаты работникам
- Оплата аренды наличными
- Доставка
- Закупка товаров у поставщика наличными
- Прочие расходы

Примеры:
```typescript
// Возврат клиенту (кредит по заказу)
{
  type: EXPENSE,
  category: RETURN,
  paymentType: CASH,
  amount: 100,
  comment: "Возврат клиенту по заказу #123",
  orderId: "uuid-order"
}

// Личные расходы
{
  type: EXPENSE,
  category: OTHER,
  paymentType: CASH,
  amount: 20,
  comment: "Купил воду для магазина"
}

// Зарплата
{
  type: EXPENSE,
  category: SALARY,
  paymentType: CASH,
  amount: 5000,
  comment: "Зарплата продавцу Петрову за июль"
}

// Аренда
{
  type: EXPENSE,
  category: RENT,
  paymentType: CASH,
  amount: 10000,
  comment: "Аренда помещения за август"
}

// Закупка
{
  type: EXPENSE,
  category: PURCHASE,
  paymentType: CASH,
  amount: 50000,
  comment: "Закупка товара у поставщика Ромашка"
}
```

**Что происходит**:
- CashTransaction создается (EXPENSE, category)
- Cashbox.balance уменьшается на `amount`

#### Логика обновления баланса

```typescript
if (type === INCOME) {
  cashbox.balance += amount;  // Приход денег
} else {
  cashbox.balance -= amount;  // Расход денег
}
```

#### Планируемая доработка

В будущем планируется:
- Связывание неопознанных платежей (INCOME, OTHER) с конкретными заказами/долгами
- Улучшенная отчетность по категориям расходов
- Лимиты на расходы определенных категорий
- Согласование крупных расходов

### Автоматическое создание кассы
При создании заказа (`POST /order`), если у продавца нет открытой кассы на этом складе — она создается автоматически с `balance = 0`.

### Несколько касс одновременно
**Да**, может быть несколько открытых касс одновременно:
- Разные продавцы → разные кассы
- Один склад, но разные продавцы → каждый со своей кассой
- Разные склады → разные кассы

### Автоматические транзакции vs Ручные

**Автоматические** (создаются системой):
- Оплата заказа → INCOME, SALE
- Возврат товара (из заказа) → EXPENSE, RETURN
- Оплата старого долга → INCOME, DEBT_PAYMENT

**Ручные** (создает кассир через UI):
- Неопознанные поступления → INCOME, OTHER
- Личные расходы → EXPENSE, OTHER
- Зарплата → EXPENSE, SALARY
- Аренда → EXPENSE, RENT
- Доставка → EXPENSE, DELIVERY
- Закупка → EXPENSE, PURCHASE
- Прочие → EXPENSE/INCOME, OTHER

---

## Возврат товаров

### Концепция возврата
Клиент может вернуть товары из заказа. В зависимости от того, сколько он вернул и сколько заплатил, возврат получает один из статусов:
- **DEBT** — клиент все еще должен магазину
- **CREDIT** — магазин должен клиенту (деньги не выданы сразу)
- **COMPLETED** — расчет полностью завершен

### Endpoint
`POST /order/return/:orderId`

### Условия
- Заказ должен быть в статусе `COMPLETED` или `DEBT`
- Заказ НЕ должен быть уже возвращен (`isReturned = false`)
- У продавца должна быть открытая касса на складе заказа

### DTO
```typescript
{
  orderId: string;
  items: [
    {
      itemId: string;        // ID OrderItem
      quantity: number;      // Сколько возвращаем
      retailPrice: Decimal;  // Цена на момент продажи
      sale: Decimal;         // Скидка на момент продажи
      costAtSale: Decimal;   // Себестоимость
    }
  ];
  returnPayments: [
    {
      type: PaymentType;     // CASH | CARD | ONLINE | TRANSFER
      amount: Decimal;       // Сколько вернули клиенту наличными
    }
  ];
}
```

### Бизнес-сценарии

#### Сценарий 1: Частичный возврат (клиент все еще должен)
**Исходные данные**:
- Заказ на 100 сум (10 товаров по 10 сум)
- Клиент оплатил 40 сум (аванс)
- Статус заказа: `DEBT`

**Действие**: Клиент возвращает 1 товар (10 сум)

**Расчет**:
```
Новая стоимость заказа = 100 - 10 = 90
Долг клиента = 90 - 40 = 50
```

**Результат**:
- ReturnedOrder.status = `DEBT`
- Order.status = `DEBT`
- Order.returnedAmount = 10
- Кассир НЕ выдает деньги клиенту (`returnPayments = []`)

---

#### Сценарий 2: Возврат с кредитом (магазин должен клиенту)
**Исходные данные**:
- Заказ на 100 сум (10 товаров по 10 сум)
- Клиент оплатил 40 сум
- Статус заказа: `DEBT`

**Действие**: Клиент возвращает 7 товаров (70 сум)

**Расчет**:
```
Новая стоимость заказа = 100 - 70 = 30
Долг магазина клиенту = 40 - 30 = 10
```

**Ситуация**: В кассе не было денег, и кассир НЕ выдал клиенту 10 сум сразу.

**Результат**:
- ReturnedOrder.status = `CREDIT`
- Order.status = `REFUNDED`
- Order.returnedAmount = 70
- Кассир выдал 0 сум (`returnPayments = []`)
- **Клиенту нужно вернуть 10 сум позже**

**Когда вернут 10 сум**: ReturnedOrder.status → `COMPLETED`

---

#### Сценарий 3: Возврат с полным расчетом
**Исходные данные**:
- Заказ на 100 сум (10 товаров по 10 сум)
- Клиент оплатил 40 сум
- Статус заказа: `DEBT`

**Действие**: Клиент возвращает 6 товаров (60 сум)

**Расчет**:
```
Новая стоимость заказа = 100 - 60 = 40
Долг = 40 - 40 = 0
```

**Результат**:
- ReturnedOrder.status = `COMPLETED`
- Order.status = `REFUNDED`
- Order.returnedAmount = 60
- Кассир НЕ выдает деньги (`returnPayments = []`)

---

#### Сценарий 4: Возврат с выдачей денег
**Исходные данные**:
- Заказ на 100 сум (10 товаров по 10 сум)
- Клиент оплатил 100 сум (полностью)
- Статус заказа: `COMPLETED`

**Действие**: Клиент возвращает 7 товаров (70 сум), кассир сразу выдает 70 сум наличными

**Результат**:
- ReturnedOrder.status = `COMPLETED`
- Order.status = `REFUNDED`
- Order.returnedAmount = 70
- Кассир выдал 70 сум (`returnPayments = [{ type: CASH, amount: 70 }]`)
- Cashbox.balance уменьшается на 70

---

### Что происходит при возврате (транзакция)

1. **Создание ReturnedOrder**:
   ```typescript
   ReturnedOrder {
     orderId: order.id,
     createdBy: staff.id,
     status: initialReturnStatus, // Рассчитывается через returnInitialStatus()
     totalAmount: refundAmount     // Сумма возвращаемых товаров
   }
   ```

2. **Создание ReturnItem** (для каждого возвращаемого товара):
   ```typescript
   ReturnItem {
     returnId: returnOrder.id,
     itemId: orderItem.id,
     quantity: returnedQuantity
   }
   ```

3. **Восстановление inventory** (StockMovement):
   ```typescript
   StockMovement {
     type: IN,
     reason: RETURN,
     variantId: orderItem.variantId,
     quantity: returnedQuantity,
     unitCost: costAtSale,
     warehouseId: order.warehouseId,
     createdById: staff.id
   }
   
   // Inventory увеличивается автоматически
   ```

4. **Создание CashTransaction** (для каждого returnPayment):
   ```typescript
   CashTransaction {
     cashboxId: cashbox.id,
     type: EXPENSE,
     category: RETURN,
     paymentType: payment.type,
     amount: payment.amount,
     orderId: order.id,
     createdById: staff.id
   }
   ```

5. **Создание ReturnPayment** (для учета):
   ```typescript
   ReturnPayment {
     returnOrderId: returnOrder.id,
     type: payment.type,
     amount: payment.amount,
     createdBy: staff.id
   }
   ```

6. **Валидация и определение финального статуса**:
   - Вызывается `validateReturnPayments()` для проверки корректности
   - Определяется финальный статус: `DEBT` | `CREDIT` | `COMPLETED`

7. **Обновление заказа**:
   ```typescript
   Order {
     status: finalStatus === DEBT ? DEBT : REFUNDED,
     returnedAmount: refundAmount,
     returnedAt: now,
     isReturned: true
   }
   ```

8. **Обновление ReturnedOrder с финальным статусом**

9. **Обновление баланса кассы**:
   ```typescript
   Cashbox {
     balance: { decrement: cashierPayments }
   }
   ```

### Валидация возврата

**validateReturnPayments()** проверяет:
1. Сумма возврата НЕ превышает стоимость заказа
2. Кассир НЕ выдал больше, чем стоимость возврата
3. Для заказов `DEBT`:
   - Если возврат <= долг → кассир НЕ должен выдавать деньги
   - Если возврат > долг → кассир выдает только разницу (возврат - долг)
4. Для заказов `COMPLETED`:
   - Кассир может выдать полную сумму возврата или меньше (тогда `CREDIT`)

---

## Управление долгами

Система поддерживает **два типа долгов**:

### 1. Order Debt (долг по заказу)
- Возникает автоматически при частичной оплате заказа
- Order.status = `DEBT`
- Оплата: `POST /order/:id/pay` (добавление платежа к существующему заказу)

### 2. CustomerDebt (старые долги)
- Создается вручную для долгов, возникших **ДО внедрения системы**
- НЕ связан с конкретным заказом в системе
- Позволяет перенести историю задолженностей при миграции на новую систему

### Создание старого долга
**Endpoint**: `POST /debt`

```typescript
CustomerDebt {
  storeId: dto.storeId,
  customerId: dto.customerId,
  description: dto.description, // "Долг за товары 2024 года"
  totalAmount: dto.amount,
  paidAmount: 0,
  status: ACTIVE,
  createdAt: dto.createdAt,     // Можно указать прошлую дату
  returnedAt: dto.returnedAt    // Дата возврата (если применимо)
}
```

### Оплата старого долга
**Endpoint**: `POST /debt/payment`

**Что происходит (транзакция)**:

1. **Создание DebtPayment**:
   ```typescript
   DebtPayment {
     debtId: debt.id,
     amount: payment.amount,
     type: payment.type (CASH | CARD | ONLINE | TRANSFER),
     createdBy: staff.id
   }
   ```

2. **Создание CashTransaction**:
   ```typescript
   CashTransaction {
     cashboxId: cashbox.id,
     type: INCOME,
     category: DEBT_PAYMENT,  // НЕ SALE!
     paymentType: payment.type,
     amount: payment.amount,
     debtId: debtPayment.id,  // Связь с DebtPayment
     createdById: staff.id
   }
   ```

3. **Обновление баланса кассы**:
   ```typescript
   Cashbox {
     balance: { increment: totalPaymentAmount }
   }
   ```

4. **Обновление CustomerDebt**:
   ```typescript
   const newPaidAmount = debt.paidAmount + totalPaymentAmount;
   const newStatus = newPaidAmount >= debt.totalAmount 
     ? DebtStatus.PAID 
     : DebtStatus.ACTIVE;
   
   CustomerDebt {
     paidAmount: { increment: totalPaymentAmount },
     status: newStatus
   }
   ```

### Отличия от Order Debt
| Параметр | Order Debt | CustomerDebt |
|----------|-----------|--------------|
| Связь с заказом | Да (`Order.id`) | Нет |
| Создание | Автоматически при частичной оплате | Вручную |
| CashTransaction.category | `SALE` | `DEBT_PAYMENT` |
| Использование | Текущие долги | Исторические долги |

---

## Управление инвентарем

### Inventory (остатки)
Хранятся по связке `warehouseId + variantId`:
```typescript
Inventory {
  warehouseId: string,
  variantId: string,
  quantity: number
}
```

### StockMovement (аудит движений)
Каждое изменение остатков логируется:

```typescript
StockMovement {
  type: IN | OUT,
  reason: PURCHASE | SALE | ADJUSTMENT | RETURN,
  variantId: string,
  warehouseId: string,
  quantity: number,
  unitCost: Decimal,       // Себестоимость
  createdById: string,     // Staff ID
  createdAt: DateTime
}
```

### Типы движений

#### 1. PURCHASE (приход товара)
**Endpoint**: `POST /warehouse/:id/inventory-movement`

```typescript
{
  type: IN,
  reason: PURCHASE,
  variantId: string,
  quantity: number,
  costPrice: Decimal,  // Закупочная цена
  price: Decimal       // Розничная цена (обновляется в ProductVariant)
}
```

**Что происходит (транзакция)**:
1. Inventory увеличивается на `quantity`
2. StockMovement создается с `reason: PURCHASE`
3. ProductVariant.price обновляется

#### 2. SALE (продажа)
Автоматически при оплате заказа (`POST /order/:id/pay`):
- Inventory уменьшается
- StockMovement создается с `reason: SALE`

#### 3. RETURN (возврат от клиента)
Автоматически при возврате товара (`POST /order/return/:id`):
- Inventory увеличивается
- StockMovement создается с `reason: RETURN`

#### 4. ADJUSTMENT (корректировка)
Используется для:
- Инвентаризации (обнаружили несоответствие физических остатков)
- Списание брака
- Пересортица

**Может быть как IN, так и OUT**:
```typescript
// Нашли на складе 5 лишних единиц
StockMovement { type: IN, reason: ADJUSTMENT, quantity: 5 }

// Обнаружили недостачу 3 единиц
StockMovement { type: OUT, reason: ADJUSTMENT, quantity: 3 }
```

### Атомарное списание inventory
При продаже используется `updateMany` с проверкой:
```typescript
const updated = await prisma.inventory.updateMany({
  where: {
    warehouseId: warehouseId,
    variantId: variantId,
    quantity: { gte: needQty }  // НЕ уйдет в минус!
  },
  data: {
    quantity: { decrement: needQty }
  }
});

if (updated.count !== 1) {
  throw new BadRequestException('Insufficient stock');
  // Вся транзакция откатывается
}
```

---

## Роли и права доступа

### User Roles (на уровне User)
- **ADMIN** — супер-администратор системы (управление всеми магазинами)
- **OWNER** — владелец магазина
- **USER** — обычный пользователь (Customer)

### Staff Roles (на уровне Staff)
Используются для сотрудников магазина:

#### 1. OWNER (Владелец)
**Права**:
- ✅ Создание/удаление сотрудников
- ✅ Просмотр отчетов магазина
- ✅ Создание/управление товарами
- ✅ Управление складами
- ✅ Создание заказов
- ✅ Возвраты
- ✅ Управление кассой
- ✅ Корректировка остатков (ADJUSTMENT)
- ✅ Изменение цен товаров
- ✅ Закрытие касс других продавцов

#### 2. MANAGER (Менеджер)
**Права**:
- ❌ Создание сотрудников
- ❌ Просмотр отчетов
- ✅ Создание/управление товарами
- ✅ Управление складами
- ✅ Создание заказов
- ✅ Возвраты
- ✅ Управление кассой
- ✅ Корректировка остатков (ADJUSTMENT)
- ✅ Изменение цен товаров
- ❌ Закрытие касс других продавцов

#### 3. SELLER (Продавец) — В ПЛАНАХ
**Планируемые права**:
- Создание заказов
- Возвраты (своих заказов)
- Управление своей кассой
- Просмотр товаров

#### 4. CASHIER (Кассир) — В ПЛАНАХ
**Планируемые права**:
- Прием платежей
- Управление своей кассой
- Просмотр заказов

#### 5. WAREHOUSE (Складской работник) — В ПЛАНАХ
**Планируемые права**:
- Приход товара (PURCHASE)
- Корректировка остатков (ADJUSTMENT)
- Просмотр остатков

### Текущая реализация
Сейчас активно используются только **OWNER** и **MANAGER**. Остальные роли запланированы на будущее.

### Проверка прав в коде

#### 1. RolesGuard (декларативно)
```typescript
@Roles(StaffRole.OWNER, StaffRole.MANAGER)
@UseGuards(AuthJWTGuard, RolesGuard)
async updatePrice(@Body() dto: UpdatePriceDto) { ... }
```

#### 2. Проверка в сервисах (императивно)
```typescript
// Проверка принадлежности к магазину
if (user.staff.storeId !== order.storeId) {
  throw new BadRequestException('Staff does not belong to the store');
}

// Проверка доступа к складу
if (!user.staff.warehouse.find(w => w.warehouseId === dto.warehouseId)) {
  throw new BadRequestException('Staff does not have access to this warehouse');
}

// Проверка роли
const hasAccess = user.role === UserRole.OWNER || user.staff.role === StaffRole.MANAGER;
if (!hasAccess) {
  throw new ForbiddenException('Insufficient permissions');
}
```

---

## Товары и варианты

### Концепция
- **Product** — логический товар (например, "Футболка Nike")
- **ProductVariant** — конкретный SKU с ценой и баркодом (например, "Футболка Nike, размер M, красная")

### Создание товара
**Endpoint**: `POST /product`

**Что происходит**:
1. Валидация warehouse (должен существовать)
2. Создание Product:
   ```typescript
   Product {
     name: dto.name,
     warehouseId: dto.warehouseId,
     storeId: warehouse.storeId,  // Берется из warehouse!
     brandId: dto.brandId,
     categoryId: dto.categoryId,
     description: dto.description,
     images: [...],               // ProductImage (isMain = true для первой)
     attributes: [...],           // ProductAttribute (связь с Attribute)
     tags: [...]                  // ProductTagValue (связь с TagValue)
   }
   ```

### Создание вариантов
**Endpoint**: `POST /product/variant`

**Что происходит (транзакция для каждого варианта)**:
1. Генерация уникального баркода:
   ```typescript
   // BarcodeSequence хранит счетчик
   const barCode = await barcodeService.generateUniqueBarcode();
   // Например: "200000000001", "200000000002", ...
   ```

2. Генерация SKU:
   ```typescript
   // buildSku(productName, category, attributes)
   // Например: "nike-футболка-m-красная"
   ```

3. Создание ProductVariant:
   ```typescript
   ProductVariant {
     productId: product.id,
     warehouseId: product.warehouseId,
     storeId: warehouse.storeId,
     sku: generatedSku,
     barCode: generatedBarCode,
     price: variant.retailPrice
   }
   ```

4. Создание Inventory:
   ```typescript
   Inventory {
     variantId: newVariant.id,
     warehouseId: warehouse.id,
     quantity: variant.quantity
   }
   ```

5. Создание StockMovement:
   ```typescript
   StockMovement {
     type: IN,
     reason: PURCHASE,
     variantId: newVariant.id,
     warehouseId: warehouse.id,
     quantity: variant.quantity,
     unitCost: variant.costPrice,
     createdById: staff.id
   }
   ```

6. Связывание с AttributeValue:
   ```typescript
   VariantAttributeValue {
     variantId: newVariant.id,
     attributeValueId: attr.attributeValueId
   }
   ```

### Уникальность
- **SKU**: уникален в пределах магазина (`@@unique([storeId, sku])`)
- **Barcode**: уникален глобально (`@@unique([barCode])`)

### Архивирование товара
**Endpoint**: `DELETE /product/:id`

**Что происходит**:
- Product.isArchived → `true`
- Товар остается в БД, но не показывается в списках (фильтр `where: { isArchived: false }`)

### Обновление цены варианта
**Endpoint**: `PATCH /product/variant/:id`

**Права**:
- OWNER или MANAGER
- Доступ к складу варианта

**Что происходит**:
```typescript
ProductVariant {
  price: dto.price
}
```

### Поиск товаров
**Endpoint**: `GET /product/search?text=:text&warehouseId=:warehouseId`

**Поиск по**:
- Barcode (contains, case-insensitive)
- SKU (contains, case-insensitive)
- Product name (contains, case-insensitive)

**Пример**:
```sql
SELECT * FROM product_variants
WHERE (
  barCode ILIKE '%search%'
  OR sku ILIKE '%search%'
  OR product.name ILIKE '%search%'
) AND storeId = :storeId 
  AND warehouseId = :warehouseId
```

---

## AdditionalService (Дополнительные услуги)

### Концепция
Дополнительные услуги к заказу, которые НЕ являются товарами:
- Доставка
- Нарезка
- Упаковка
- Гравировка
- Установка
- И т.д.

### Создание
Создаются вручную при добавлении товаров в заказ (`POST /order/:id/items`):
```typescript
AdditionalService {
  orderId: order.id,
  name: "Доставка",         // Вводится вручную
  price: 50,                // Вводится вручную
  description: "Доставка по городу" // Опционально
}
```

### Учет в totalAmount
Доп. услуги **включаются** в общую сумму заказа:
```typescript
totalAmount = sum(orderItems) + sum(additionalServices)
```

### Управление
- Если `service.id` передан в DTO и существует → UPDATE
- Если `service.id` не передан → CREATE
- Если service существует в БД, но нет в DTO → DELETE

### Влияние на возвраты
При возврате товаров доп. услуги **НЕ возвращаются**:
```typescript
// В validateReturnPayments()
const servicesAmount = order.services.reduce((sum, s) => sum + s.price, 0);

// Для COMPLETED заказов:
if (refundAmount === (orderTotalAmount - servicesAmount)) {
  // Полный возврат товаров (без услуг)
}
```

---

## Ключевые правила бизнес-логики

1. **Inventory списывается ТОЛЬКО при оплате** (не при добавлении в заказ)
2. **Нельзя продать товар со склада, к которому нет доступа**
3. **Нельзя продать больше, чем есть на складе** (atomic check)
4. **Каждое движение inventory логируется** (StockMovement)
5. **Каждая денежная операция логируется** (CashTransaction)
6. **Возврат товара восстанавливает inventory** на тот же склад
7. **Долги бывают двух типов**: Order Debt и CustomerDebt
8. **Касса привязана к продавцу + склад + магазин**
9. **После закрытия кассы нельзя добавлять транзакции**
10. **SKU уникален в рамках магазина, barcode — глобально**
