# Business Workflows — Пошаговые процессы

Этот документ описывает пошаговые сценарии выполнения ключевых бизнес-процессов в системе.

---

## 1. Регистрация и авторизация

### 1.1. Регистрация нового клиента

**Кто**: Любой посетитель

**Шаги**:
1. `POST /signup`
   ```json
   {
     "fullName": "Иван Иванов",
     "phone": "+998901234567",
     "login": "ivan@example.com",
     "password": "secure123",
     "type": "CUSTOMER"
   }
   ```
2. Система создает:
   - `User` (type: CUSTOMER)
   - `AuthAccount` (passwordHash через bcrypt)
   - `Customer`
3. Ответ: данные пользователя
4. Клиент может логиниться

### 1.2. Создание сотрудника (Staff)

**Кто**: OWNER магазина или ADMIN

**Шаги**:
1. `POST /user`
   ```json
   {
     "fullName": "Петр Продавцов",
     "phone": "+998901234568",
     "login": "petr",
     "password": "seller123",
     "type": "STAFF",
     "storeId": "uuid-store",
     "role": "MANAGER"
   }
   ```
2. Система создает:
   - `User` (type: STAFF)
   - `AuthAccount`
   - `Staff` (привязан к магазину)
3. OWNER вручную назначает склады через `StaffOnWarehouse`
4. Сотрудник может логиниться

### 1.3. Вход в систему

**Кто**: Любой зарегистрированный пользователь

**Шаги**:
1. `POST /login`
   ```json
   {
     "login": "ivan@example.com",
     "password": "secure123"
   }
   ```
2. Система проверяет:
   - Существует ли AuthAccount с таким login
   - Совпадает ли passwordHash
   - Активен ли аккаунт (isActive)
3. Генерируются токены:
   - `accessToken` (15 минут) → в response body
   - `refreshToken` (7 дней) → в httpOnly cookie
4. Создается `RefreshSession` с хешем refresh токена
5. Клиент использует accessToken для всех запросов

### 1.4. Обновление токена

**Кто**: Любой аутентифицированный пользователь

**Шаги**:
1. `GET /refresh` (с refreshToken в cookie)
2. Система проверяет:
   - Существует ли RefreshSession
   - Совпадает ли хеш токена
   - Не отозван ли токен (isRevoked)
   - Не истек ли срок (expiresAt)
3. Старая сессия помечается `isRevoked: true`
4. Генерируются новые токены (rotation)
5. Создается новая `RefreshSession`
6. Ответ: новый accessToken + новый refreshToken в cookie

---

## 2. Настройка магазина

### 2.1. Создание магазина

**Кто**: ADMIN

**Шаги**:
1. `POST /store`
   ```json
   {
     "name": "Мой магазин",
     "ownerId": "uuid-user"
   }
   ```
2. Система создает `Store`
3. ADMIN создает первого OWNER сотрудника для этого магазина

### 2.2. Создание склада

**Кто**: OWNER магазина

**Шаги**:
1. `POST /warehouse`
   ```json
   {
     "name": "Склад №1",
     "storeId": "uuid-store",
     "ownerId": "uuid-staff"  // Staff ID владельца
   }
   ```
2. Система создает:
   - `Warehouse`
   - `StaffOnWarehouse` (связь владельца со складом)
3. Теперь можно добавлять товары на этот склад

### 2.3. Назначение сотрудника на склад

**Кто**: OWNER магазина

**Шаги**:
1. Прямая вставка в БД (или через админ-панель):
   ```sql
   INSERT INTO staff_on_warehouses (staffId, warehouseId)
   VALUES ('uuid-staff', 'uuid-warehouse');
   ```
2. Теперь сотрудник может работать на этом складе

---

## 3. Управление товарами

### 3.1. Добавление нового товара

**Кто**: OWNER или MANAGER

**Шаги**:

#### Шаг 1: Создание базового товара
```
POST /product
{
  "name": "Футболка Nike",
  "warehouseId": "uuid-warehouse",
  "categoryId": "uuid-category",
  "brandId": "uuid-brand",
  "description": "Спортивная футболка",
  "images": ["https://s3.../image1.jpg"],
  "attributeIds": ["uuid-attr-size", "uuid-attr-color"],
  "tagIds": ["uuid-tag-cotton"]
}
```

**Результат**: Product создан (без вариантов, без inventory)

#### Шаг 2: Создание вариантов товара
```
POST /product/variant
{
  "productId": "uuid-product",
  "category": "Одежда",
  "variants": [
    {
      "retailPrice": 500.00,
      "costPrice": 300.00,
      "quantity": 10,
      "attributes": [
        { "attributeValueId": "uuid-size-m", "value": "M" },
        { "attributeValueId": "uuid-color-red", "value": "Красный" }
      ]
    },
    {
      "retailPrice": 500.00,
      "costPrice": 300.00,
      "quantity": 5,
      "attributes": [
        { "attributeValueId": "uuid-size-l", "value": "L" },
        { "attributeValueId": "uuid-color-blue", "value": "Синий" }
      ]
    }
  ]
}
```

**Результат для каждого варианта**:
- Генерируется уникальный `barCode` (например, "200000000001")
- Генерируется `SKU` (например, "футболка-nike-одежда-m-красный")
- Создается `ProductVariant`
- Создается `Inventory` (quantity: 10 и 5)
- Создается `StockMovement` (type: IN, reason: PURCHASE)
- Связываются атрибуты

#### Шаг 3: Продажа товара
Теперь товар доступен для продажи. При сканировании баркода "200000000001" система найдет вариант "Футболка Nike M Красная" с ценой 500 и остатком 10.

### 3.2. Приход товара на склад (закупка)

**Кто**: OWNER или MANAGER

**Шаги**:
1. `POST /warehouse/:id/inventory-movement`
   ```json
   {
     "variantId": "uuid-variant",
     "type": "IN",
     "reason": "PURCHASE",
     "quantity": 20,
     "costPrice": 280.00,
     "price": 520.00  // Новая розничная цена
   }
   ```
2. **Транзакция**:
   - `Inventory.quantity += 20`
   - `StockMovement` создается (IN, PURCHASE, unitCost: 280)
   - `ProductVariant.price = 520` (обновление розничной цены)

### 3.3. Корректировка остатков (инвентаризация)

**Кто**: OWNER или MANAGER

**Сценарий**: При инвентаризации обнаружили, что физически на складе 8 единиц, а в системе 10.

**Шаги**:
1. `POST /warehouse/:id/inventory-movement`
   ```json
   {
     "variantId": "uuid-variant",
     "type": "OUT",
     "reason": "ADJUSTMENT",
     "quantity": 2,
     "costPrice": 300.00,
     "price": 500.00
   }
   ```
2. **Транзакция**:
   - `Inventory.quantity -= 2`
   - `StockMovement` создается (OUT, ADJUSTMENT)

---

## 4. Продажа товара (основной flow)

### 4.1. Полная оплата наличными (простой case)

**Участники**: Продавец (SELLER), Клиент

**Шаги**:

#### 1. Продавец открывает смену (если касса закрыта)
```
POST /cashbox
{
  "storeId": "uuid-store",
  "warehouseId": "uuid-warehouse",
  "balance": 0  // Начальный баланс
}
```
**Результат**: Cashbox status: OPEN

#### 2. Продавец создает новый заказ
```
POST /order
{
  "storeId": "uuid-store",
  "warehouseId": "uuid-warehouse",
  "customerId": null,  // Анонимный клиент
  "channel": "POS"
}
```
**Результат**: Order status: CREATED, totalAmount: 0

#### 3. Продавец сканирует товары или добавляет вручную
```
POST /order/:orderId/items
{
  "orderId": "uuid-order",
  "customerId": null,
  "items": [
    {
      "variantId": "uuid-variant-1",
      "quantity": 2,
      "retailPrice": 500.00,
      "sale": 0,
      "costAtSale": 300.00
    },
    {
      "variantId": "uuid-variant-2",
      "quantity": 1,
      "retailPrice": 800.00,
      "sale": 100.00,
      "costAtSale": 400.00
    }
  ],
  "additionalServices": []
}
```
**Что происходит**:
- Система проверяет наличие на складе (quantity >= requested)
- Создаются OrderItem
- Рассчитывается totalAmount: (500*2) + (800-100) = 1700
- Order status → HOLD
- **Inventory пока НЕ списывается!**

#### 4. Клиент оплачивает
```
POST /order/:orderId/pay
{
  "customerId": null,
  "payments": [
    { "type": "CASH", "amount": 1700.00 }
  ]
}
```
**Что происходит (транзакция)**:
1. Создается `Payment` (CASH, 1700)
2. Создается `CashTransaction` (INCOME, SALE, 1700)
3. Создаются `StockMovement` для каждого товара (OUT, SALE)
4. **Списывается Inventory** (атомарно с проверкой quantity >= needed)
5. Обновляется `Cashbox.balance += 1700`
6. `Order.paidAmount = 1700`, `status = COMPLETED`

**Результат**: Чек напечатан, товар продан, касса пополнилась.

#### 5. В конце смены продавец закрывает кассу
```
POST /cashbox/:id/close
```
**Результат**: Cashbox status: CLOSED, нельзя больше добавлять транзакции

### 4.2. Частичная оплата (долг)

**Сценарий**: Клиент покупает на 1000, но платит только 400.

**Шаги 1-3**: такие же, как в 4.1

#### 4. Клиент оплачивает частично
```
POST /order/:orderId/pay
{
  "customerId": "uuid-customer",  // Обязательно указать клиента!
  "payments": [
    { "type": "CASH", "amount": 400.00 }
  ]
}
```
**Что происходит**:
- Inventory списывается ПОЛНОСТЬЮ (как будто оплачено полностью)
- CashTransaction (INCOME, SALE, 400)
- Cashbox.balance += 400
- **Order.status = DEBT** (т.к. 400 < 1000)
- Order.paidAmount = 400

**Результат**: Заказ в статусе DEBT, клиент должен 600.

#### 5. Клиент приходит позже и доплачивает
```
POST /order/:orderId/pay
{
  "customerId": "uuid-customer",
  "payments": [
    { "type": "CASH", "amount": 600.00 }
  ]
}
```
**Что происходит**:
- Payment создается (CASH, 600)
- CashTransaction (INCOME, SALE, 600)
- Cashbox.balance += 600
- Order.paidAmount = 400 + 600 = 1000
- **Order.status = COMPLETED** (т.к. 1000 >= 1000)

**Результат**: Долг полностью погашен.

### 4.3. Покупка с дополнительной услугой

**Сценарий**: Клиент покупает товар на 1000 + доставка 100.

**Шаги 1-2**: такие же

#### 3. Добавление товаров + услуги
```
POST /order/:orderId/items
{
  "orderId": "uuid-order",
  "items": [...],  // Товары на 1000
  "additionalServices": [
    {
      "name": "Доставка",
      "price": 100.00,
      "description": "По городу"
    }
  ]
}
```
**Результат**: totalAmount = 1000 + 100 = 1100

#### 4. Оплата
```
POST /order/:orderId/pay
{
  "payments": [
    { "type": "CASH", "amount": 1100.00 }
  ]
}
```
**Результат**: Order status: COMPLETED, весь чек оплачен.

---

## 5. Возврат товара

### 5.1. Полный возврат (заказ был полностью оплачен)

**Сценарий**: Клиент купил товар на 1000 наличными, через час вернул весь товар.

**Шаги**:

#### 1. Продавец открывает заказ клиента
```
GET /order/:orderId
```

#### 2. Продавец создает возврат
```
POST /order/return/:orderId
{
  "orderId": "uuid-order",
  "items": [
    {
      "itemId": "uuid-order-item-1",
      "quantity": 2,
      "retailPrice": 500.00,
      "sale": 0,
      "costAtSale": 300.00
    }
  ],
  "returnPayments": [
    {
      "type": "CASH",
      "amount": 1000.00  // Возвращаем клиенту всю сумму
    }
  ]
}
```

**Что происходит (транзакция)**:
1. Создается `ReturnedOrder` (totalAmount: 1000)
2. Создаются `ReturnItem`
3. Создаются `StockMovement` (IN, RETURN) — **Inventory восстанавливается**
4. Создаются `CashTransaction` (EXPENSE, RETURN, 1000)
5. Создаются `ReturnPayment` (CASH, 1000)
6. Обновляется `Cashbox.balance -= 1000`
7. Система валидирует:
   - Заказ был COMPLETED, сумма возврата = totalAmount, кассир вернул всю сумму
   - **ReturnedOrder.status = COMPLETED**
8. Order.status → REFUNDED, isReturned: true

**Результат**: Товар вернулся на склад, деньги выданы клиенту, касса уменьшилась.

### 5.2. Частичный возврат (клиент был в долгу)

**Сценарий**: 
- Клиент купил на 1000, заплатил 400 (долг 600)
- Вернул товар на 300
- Долг уменьшается: 1000 - 300 = 700, заплатил 400, новый долг = 300

**Шаги**:

#### 1. Создание возврата
```
POST /order/return/:orderId
{
  "orderId": "uuid-order",
  "items": [
    {
      "itemId": "uuid-order-item",
      "quantity": 1,  // Возврат на 300
      "retailPrice": 300.00,
      "sale": 0,
      "costAtSale": 200.00
    }
  ],
  "returnPayments": []  // Кассир НЕ выдает деньги!
}
```

**Что происходит**:
1. Товар возвращается на склад
2. **ReturnedOrder.status = DEBT** (т.к. клиент все еще должен)
3. Order.status остается DEBT
4. Order.returnedAmount = 300
5. Новый долг = (1000 - 300) - 400 = 300

**Результат**: Долг уменьшился с 600 до 300.

### 5.3. Возврат с кредитом (магазин должен клиенту)

**Сценарий**:
- Клиент купил на 1000, заплатил 400 (долг 600)
- Вернул товар на 700
- Расчет: (1000 - 700) - 400 = -100 → магазин должен 100

**Шаги**:

#### 1. Создание возврата (без денег)
```
POST /order/return/:orderId
{
  "orderId": "uuid-order",
  "items": [...],  // Товары на 700
  "returnPayments": []  // В кассе не было денег!
}
```

**Что происходит**:
1. Товар возвращается на склад
2. **ReturnedOrder.status = CREDIT** (магазин должен 100)
3. Order.status → REFUNDED
4. Клиенту нужно вернуть 100 позже

**Результат**: Магазин зафиксировал, что должен клиенту 100 сум.

#### 2. Позже выдают деньги
**Логика**: когда будут деньги, создается отдельная транзакция в кассу (ручная).

```
POST /cashbox/:id/transaction
{
  "type": "EXPENSE",
  "category": "OTHER",
  "paymentType": "CASH",
  "amount": 100.00,
  "comment": "Возврат клиенту по заказу #123"
}
```

**Результат**: Cashbox.balance -= 100, ReturnedOrder.status можно обновить на COMPLETED (вручную в БД).

---

## 6. Ручные операции с кассой

### 6.1. Прием неопознанного платежа

**Сценарий**: Клиент Иванов принес 5000, но кассир не знает точно, на что это (возможно долг, возможно аванс).

**Шаги**:

#### 1. Кассир открывает свою кассу (если еще не открыта)
```
POST /cashbox
{
  "storeId": "uuid-store",
  "warehouseId": "uuid-warehouse",
  "balance": 0
}
```

#### 2. Кассир добавляет транзакцию
```
POST /cashbox/:id/transaction
{
  "type": "INCOME",
  "category": "OTHER",
  "paymentType": "CASH",
  "amount": 5000.00,
  "comment": "Клиент Иванов принес деньги, уточнить назначение"
}
```

**Что происходит**:
- Создается CashTransaction (INCOME, OTHER)
- Cashbox.balance += 5000
- Поля `orderId` и `debtId` остаются `null`

**Результат**: Деньги в кассе, но не привязаны ни к заказу, ни к долгу.

#### 3. Позже выясняется, что это оплата долга
**Вариант A**: Создать платеж по долгу вручную:
```
POST /debt/payment
{
  "debtId": "uuid-debt",
  "warehouseId": "uuid-warehouse",
  "payments": [
    { "type": "CASH", "amount": 5000.00 }
  ]
}
```

**Важно**: Это создаст еще одну транзакцию INCOME в кассу, т.е. баланс увеличится дважды!

**Вариант B** (будущее): Связать существующую транзакцию с долгом через админ-панель, чтобы не дублировать.

### 6.2. Личные расходы из кассы

**Сценарий**: Продавец купил воду для магазина на 20 сум из кассы.

**Шаги**:
```
POST /cashbox/:id/transaction
{
  "type": "EXPENSE",
  "category": "OTHER",
  "paymentType": "CASH",
  "amount": 20.00,
  "comment": "Купил воду для магазина"
}
```

**Что происходит**:
- Создается CashTransaction (EXPENSE, OTHER)
- Cashbox.balance -= 20

**Результат**: Из кассы вычли 20, зафиксирован расход.

### 6.3. Выдача зарплаты наличными

**Сценарий**: Выдали зарплату продавцу Петрову 5000 из кассы.

**Шаги**:
```
POST /cashbox/:id/transaction
{
  "type": "EXPENSE",
  "category": "SALARY",
  "paymentType": "CASH",
  "amount": 5000.00,
  "comment": "Зарплата продавцу Петрову за июль"
}
```

**Что происходит**:
- Создается CashTransaction (EXPENSE, SALARY)
- Cashbox.balance -= 5000

**Результат**: Зарплата выдана, баланс уменьшен.

### 6.4. Оплата аренды из кассы

**Сценарий**: Заплатили аренду за август 10,000 из кассы.

**Шаги**:
```
POST /cashbox/:id/transaction
{
  "type": "EXPENSE",
  "category": "RENT",
  "paymentType": "CASH",
  "amount": 10000.00,
  "comment": "Аренда помещения за август"
}
```

**Что происходит**:
- Создается CashTransaction (EXPENSE, RENT)
- Cashbox.balance -= 10000

### 6.5. Закупка товара наличными

**Сценарий**: Закупили товар у поставщика "Ромашка" на 50,000 наличными из кассы.

**Шаги**:
```
POST /cashbox/:id/transaction
{
  "type": "EXPENSE",
  "category": "PURCHASE",
  "paymentType": "CASH",
  "amount": 50000.00,
  "comment": "Закупка товара у поставщика Ромашка"
}
```

**Что происходит**:
- Создается CashTransaction (EXPENSE, PURCHASE)
- Cashbox.balance -= 50000

**Примечание**: Это НЕ создает автоматически inventory! Товар нужно добавить отдельно через `POST /warehouse/:id/inventory-movement`.

### 6.6. Возврат денег клиенту (кредит по заказу)

**Сценарий**: Магазин должен клиенту 100 по возврату товара, деньги были не выданы сразу. Теперь выдаем.

**Шаги**:
```
POST /cashbox/:id/transaction
{
  "type": "EXPENSE",
  "category": "RETURN",
  "paymentType": "CASH",
  "amount": 100.00,
  "comment": "Возврат клиенту по заказу #123",
  "orderId": "uuid-order"
}
```

**Что происходит**:
- Создается CashTransaction (EXPENSE, RETURN)
- Cashbox.balance -= 100
- Связывается с заказом (orderId)

**Результат**: Кредит погашен, ReturnedOrder.status можно обновить на COMPLETED (вручную или через админку).

---

## 7. Управление долгами

### 6.1. Оплата долга по заказу

**Сценарий**: Клиент должен 600 по заказу, пришел заплатить 300.

**Шаги**:
```
POST /order/:orderId/pay
{
  "customerId": "uuid-customer",
  "payments": [
    { "type": "CASH", "amount": 300.00 }
  ]
}
```

**Что происходит**:
- Payment создается (300)
- CashTransaction (INCOME, SALE, 300)
- Cashbox.balance += 300
- Order.paidAmount = 400 + 300 = 700
- Order.status остается DEBT (т.к. 700 < 1000)

**Результат**: Долг уменьшился с 600 до 300.

### 6.2. Создание старого долга

**Сценарий**: Магазин переходит на новую систему. У клиента Иванова был старый долг 5000 с 2024 года.

**Шаги**:
```
POST /debt
{
  "storeId": "uuid-store",
  "customerId": "uuid-customer-ivanov",
  "amount": 5000.00,
  "description": "Долг за товары 2024 года",
  "createdAt": "2024-06-15T00:00:00Z",
  "returnedAt": "2024-12-31T00:00:00Z"
}
```

**Результат**: CustomerDebt создан, status: ACTIVE, paidAmount: 0

### 6.3. Оплата старого долга

**Шаги**:
```
POST /debt/payment
{
  "debtId": "uuid-debt",
  "warehouseId": "uuid-warehouse",  // Для привязки к кассе
  "payments": [
    { "type": "CASH", "amount": 2000.00 }
  ]
}
```

**Что происходит (транзакция)**:
1. Создается `DebtPayment` (2000)
2. Создается `CashTransaction` (INCOME, **DEBT_PAYMENT**, 2000)
3. Обновляется `Cashbox.balance += 2000`
4. Обновляется `CustomerDebt.paidAmount = 2000`
5. Статус остается ACTIVE (т.к. 2000 < 5000)

**Результат**: Долг уменьшился с 5000 до 3000.

**Когда заплатит еще 3000**: CustomerDebt.status → PAID

---

## 7. Отчеты и аналитика (будущее)

### 7.1. Выручка за день
**Кто**: OWNER

**Логика**:
```sql
SELECT SUM(amount) 
FROM cash_transactions 
WHERE cashboxId IN (SELECT id FROM cashbox WHERE storeId = :storeId)
  AND type = 'INCOME' 
  AND category = 'SALE'
  AND DATE(createdAt) = CURRENT_DATE;
```

### 7.2. Топ товаров
**Кто**: OWNER

**Логика**:
```sql
SELECT 
  p.name,
  SUM(oi.quantity) as total_sold,
  SUM((oi.retailPrice - oi.sale) * oi.quantity) as revenue
FROM order_items oi
JOIN product_variants pv ON oi.variantId = pv.id
JOIN products p ON pv.productId = p.id
WHERE pv.storeId = :storeId
  AND oi.orderId IN (SELECT id FROM orders WHERE status IN ('COMPLETED', 'DEBT'))
GROUP BY p.id
ORDER BY total_sold DESC
LIMIT 10;
```

### 7.3. Остатки по складу
**Кто**: OWNER/MANAGER

**Логика**:
```sql
SELECT 
  p.name,
  pv.sku,
  pv.barCode,
  i.quantity,
  pv.price
FROM inventories i
JOIN product_variants pv ON i.variantId = pv.id
JOIN products p ON pv.productId = p.id
WHERE i.warehouseId = :warehouseId
  AND i.quantity > 0
ORDER BY i.quantity ASC;
```

---

## 8. Типичные сценарии ошибок

### 8.1. Попытка продать товар, которого нет

**Сценарий**: Продавец добавляет 10 единиц товара, а на складе только 5.

**Этап ошибки**: `POST /order/:id/items`

**Ошибка**:
```json
{
  "statusCode": 400,
  "message": "Insufficient stock for variant: uuid-variant (available: 5, requested: 10)"
}
```

**Решение**: Уменьшить количество или сделать приход товара.

### 8.2. Попытка оплатить больше, чем нужно

**Сценарий**: Заказ на 1000, клиент хочет заплатить 1500.

**Этап ошибки**: `POST /order/:id/pay`

**Ошибка**:
```json
{
  "statusCode": 400,
  "message": "Payment amount exceeds order total"
}
```

**Решение**: Скорректировать сумму платежа.

### 8.3. Возврат товара дважды

**Сценарий**: Продавец пытается создать второй возврат для уже возвращенного заказа.

**Этап ошибки**: `POST /order/return/:id`

**Ошибка**:
```json
{
  "statusCode": 400,
  "message": "Order is already returned"
}
```

**Решение**: Проверить статус заказа перед возвратом.

### 8.4. Работа без открытой кассы

**Сценарий**: Продавец пытается оплатить заказ, но забыл открыть кассу.

**Этап ошибки**: `POST /order/:id/pay`

**Ошибка**:
```json
{
  "statusCode": 400,
  "message": "Open cashbox not found for the order store and warehouse"
}
```

**Решение**: Открыть кассу через `POST /cashbox`.

### 8.5. Доступ к чужому складу

**Сценарий**: Продавец со склада A пытается продать товар со склада B.

**Этап ошибки**: `POST /order`

**Ошибка**:
```json
{
  "statusCode": 400,
  "message": "Staff does not belong to the store or warehouse"
}
```

**Решение**: OWNER должен назначить продавца на склад B через `StaffOnWarehouse`.

---

## 9. Интеграция с внешними системами (будущее)

### 9.1. 1С Бухгалтерия
- Экспорт заказов
- Экспорт остатков
- Импорт цен

### 9.2. SMS уведомления
- Новый заказ → SMS клиенту
- Долг погашен → SMS клиенту
- Возврат оформлен → SMS клиенту

### 9.3. Telegram бот для OWNER
- Ежедневная сводка: выручка, количество заказов, долги
- Уведомления о новых долгах
- Отчеты по запросу

---

## Заключение

Эти workflows покрывают 90% типичных операций в системе. Для более сложных сценариев обращайтесь к документам:
- **BUSINESS_LOGIC.md** — подробная бизнес-логика
- **API_MODULES.md** — полная документация API
- **DATABASE.md** — схема базы данных
