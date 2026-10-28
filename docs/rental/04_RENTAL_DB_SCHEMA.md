# 🗄️ Схема Базы Данных для Системы Аренды

## 📌 Содержание

1. [Обзор изменений](#обзор-изменений)
2. [Новые таблицы](#новые-таблицы)
3. [Модифицированные таблицы](#модифицированные-таблицы)
4. [Новые ENUMS](#новые-enums)
5. [Связи и ограничения](#связи-и-ограничения)
6. [Индексы](#индексы)
7. [Примеры данных](#примеры-данных)

---

## 📋 Обзор изменений

```
НОВЫЕ ТАБЛИЦЫ (5):
├── rental_rates
├── rentals
├── rental_deposits
├── reservations
└── inventory_items (опционально)

МОДИФИЦИРОВАННЫЕ ТАБЛИЦЫ (4):
├── product_variants
├── order_items
├── stock_movements (enum)
└── cash_transactions (enum)

НОВЫЕ ENUMS (7):
├── OrderItemType
├── RentalStatus
├── DepositStatus
├── DepositType
├── ReservationStatus
├── InventoryItemStatus
└── EarlyReturnRefundType
```

---

## 🔷 Новые таблицы

### 1. rental_rates

**Назначение**: Хранит тарифные сетки для аренды товаров  
**Связь**: 1 ProductVariant → много RentalRate  

```sql
CREATE TABLE rental_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Ссылка на товар
  product_variant_id UUID NOT NULL UNIQUE FOREIGN KEY,
  
  -- Диапазон дней
  min_days INT NOT NULL,      -- Минимум дней (включительно)
  max_days INT,               -- Максимум дней (включительно, NULL = без верхнего лимита)
  
  -- Цена
  price_per_day DECIMAL(15,2) NOT NULL,  -- Цена за один день
  
  -- Системные поля
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Ограничения
  CHECK (min_days >= 1),
  CHECK (max_days IS NULL OR max_days >= min_days),
  
  -- Индекс
  INDEX idx_product_variant (product_variant_id)
);
```

**Примеры**:
```sql
-- Платье M: 1-2 дня = 100 сум/день
INSERT INTO rental_rates (product_variant_id, min_days, max_days, price_per_day)
VALUES ('variant-uuid-1', 1, 2, 100);

-- Платье M: 3-7 дней = 80 сум/день
INSERT INTO rental_rates (product_variant_id, min_days, max_days, price_per_day)
VALUES ('variant-uuid-1', 3, 7, 80);

-- Платье M: 13+ дней = 50 сум/день
INSERT INTO rental_rates (product_variant_id, min_days, max_days, price_per_day)
VALUES ('variant-uuid-1', 13, NULL, 50);
```

**Поиск тарифа**:
```sql
-- Найти тариф для 5 дней
SELECT * FROM rental_rates
WHERE product_variant_id = 'variant-uuid'
AND min_days <= 5
AND (max_days IS NULL OR max_days >= 5)
LIMIT 1;
```

---

### 2. rentals

**Назначение**: Основная таблица для каждой аренды  
**Связь**: 1 OrderItem → 1 Rental (когда itemType = RENT)  

```sql
CREATE TABLE rentals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Ссылка на заказ
  order_item_id UUID NOT NULL UNIQUE FOREIGN KEY,
  
  -- Даты аренды
  start_date TIMESTAMP NOT NULL,         -- Когда клиент забирает
  due_date TIMESTAMP NOT NULL,           -- Когда должен вернуть
  returned_at TIMESTAMP,                 -- Когда фактически вернул (NULL если еще в аренде)
  
  -- Статус
  status rental_status NOT NULL DEFAULT 'ACTIVE',
  
  -- Финансовые поля
  rental_price DECIMAL(15,2) NOT NULL,  -- Цена аренды на момент создания
  
  -- Залог (опционально)
  deposit_amount DECIMAL(15,2),         -- Сумма залога
  deposit_status deposit_status,        -- Статус залога
  deposit_returned_at TIMESTAMP,        -- Когда вернули залог
  
  -- Ущерб
  damage_fee DECIMAL(15,2),             -- Штраф за ущерб
  damage_description TEXT,              -- Описание ущерба
  damage_photo_url TEXT,                -- Ссылка на фото ущерба
  
  -- Ранний возврат
  early_return_refund DECIMAL(15,2),    -- Возврат за неиспользованные дни
  
  -- Доп информация
  notes TEXT,                           -- Заметки кассира
  
  -- Системные поля
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Индексы
  INDEX idx_order_item (order_item_id),
  INDEX idx_status_due_date (status, due_date),
  INDEX idx_created_at (created_at)
);
```

**Возможные состояния**:
```
ACTIVE
├─ Товар выдан, ждем возврата
├─ Может перейти → RETURNED (вернулся в срок)
├─ Может перейти → LATE (не вернулся в срок)
└─ Может перейти → PURCHASED (решил купить)

RETURNED
├─ Товар возвращен нормально
└─ Финальное состояние (невозвратное)

LATE
├─ Дюдат прошел, товар не возвращен
├─ Может остаться в LATE (нужно взять руками)
└─ Может перейти → LOST (признан потерянным)

DAMAGED
├─ Возвращен поврежденным
└─ Финальное состояние

LOST
├─ Товар потерян/не возвращен
└─ Финальное состояние (залог конфискован)

PURCHASED
├─ Клиент купил товар вместо возврата
└─ Финальное состояние
```

**Примеры запросов**:

```sql
-- Активные аренды на конкретную дату
SELECT * FROM rentals
WHERE status = 'ACTIVE'
AND start_date <= '2026-08-22'::date
AND due_date >= '2026-08-22'::date;

-- Аренды, которые нужно вернуть завтра
SELECT * FROM rentals
WHERE status = 'ACTIVE'
AND due_date <= NOW() + INTERVAL '1 day'
ORDER BY due_date ASC;

-- Просроченные аренды
SELECT * FROM rentals
WHERE status IN ('ACTIVE', 'LATE')
AND due_date < NOW();

-- Доход от аренд за период
SELECT 
  SUM(rental_price) as total_rental,
  SUM(damage_fee) as total_damage,
  COUNT(*) as count
FROM rentals
WHERE created_at BETWEEN '2026-08-01' AND '2026-08-31';
```

---

### 3. rental_deposits

**Назначение**: Отдельный учет залогов (может быть CASH, GOLD, DOCUMENT, OTHER)  
**Связь**: 1 Rental → 1 RentalDeposit (опционально)  

```sql
CREATE TABLE rental_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Ссылка на аренду
  rental_id UUID NOT NULL UNIQUE FOREIGN KEY,
  
  -- Информация о залоге
  amount DECIMAL(15,2) NOT NULL,       -- Сумма залога
  type deposit_type NOT NULL,          -- CASH, GOLD, DOCUMENT, OTHER
  description TEXT,                   -- Описание (номер документа, вес и т.д.)
  
  -- Даты
  paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,   -- Когда внесен
  returned_at TIMESTAMP,                         -- Когда вернули/конфисковали
  
  -- Статус
  status deposit_status NOT NULL DEFAULT 'HELD',
  
  -- Системные поля
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Индексы
  INDEX idx_rental (rental_id),
  INDEX idx_status (status)
);
```

**Примеры**:

```sql
-- Залог денежный
INSERT INTO rental_deposits (rental_id, amount, type, description, status)
VALUES ('rental-uuid-1', 1000, 'CASH', NULL, 'HELD');

-- Залог документ
INSERT INTO rental_deposits (rental_id, amount, type, description, status)
VALUES ('rental-uuid-2', 0, 'DOCUMENT', 'Паспорт: 1234567890', 'HELD');

-- Залог золото (вес)
INSERT INTO rental_deposits (rental_id, amount, type, description, status)
VALUES ('rental-uuid-3', 0, 'GOLD', 'Кольцо: 3.5 грамма', 'HELD');
```

---

### 4. reservations

**Назначение**: Бронирования товаров на будущие даты  
**Связь**: Customer и ProductVariant  

```sql
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Ссылка на товар и клиента
  product_variant_id UUID NOT NULL FOREIGN KEY,
  customer_id UUID NOT NULL FOREIGN KEY,
  store_id UUID NOT NULL FOREIGN KEY,
  
  -- Даты бронирования
  rental_start_date TIMESTAMP NOT NULL,
  rental_end_date TIMESTAMP NOT NULL,
  
  -- Статус
  status reservation_status NOT NULL DEFAULT 'PENDING',
  
  -- Ссылка на созданную аренду (если бронь стала арендой)
  converted_to_rental_id UUID,
  
  -- Доп информация
  notes TEXT,
  expires_at TIMESTAMP,  -- До какого времени действительна бронь
  
  -- Системные поля
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Ограничения
  CHECK (rental_start_date < rental_end_date),
  
  -- Индексы
  INDEX idx_variant_dates (product_variant_id, rental_start_date, rental_end_date),
  INDEX idx_customer (customer_id),
  INDEX idx_status (status),
  INDEX idx_expires (expires_at)
);
```

**Жизненный цикл**:
```
PENDING (создана)
  ↓
CONFIRMED (клиент подтвердил)
  ↓
CONVERTED_TO_RENTAL (наступила дата, создана Rental)
  
ИЛИ:

PENDING → CANCELLED (клиент отменил или истекло время)
```

**Примеры**:

```sql
-- Создать бронирование
INSERT INTO reservations (
  product_variant_id, customer_id, store_id,
  rental_start_date, rental_end_date,
  status, expires_at
)
VALUES (
  'variant-uuid', 'customer-uuid', 'store-uuid',
  '2026-09-02 10:00:00', '2026-09-05 10:00:00',
  'PENDING',
  NOW() + INTERVAL '24 hours'  -- Действительна 24 часа
);

-- Получить активные бронирования на конкретный период
SELECT * FROM reservations
WHERE product_variant_id = 'variant-uuid'
AND status IN ('PENDING', 'CONFIRMED')
AND rental_start_date < '2026-08-25'::timestamp
AND rental_end_date > '2026-08-20'::timestamp;

-- Очистить истекшие бронирования
DELETE FROM reservations
WHERE status = 'PENDING'
AND expires_at < NOW();
```

---

### 5. inventory_items (ОПЦИОНАЛЬНО)

**Назначение**: Поштучный учет товаров (нужна для платьев, инструментов)  
**Связь**: ProductVariant → много InventoryItem  

```sql
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Ссылка на товар и склад
  variant_id UUID NOT NULL FOREIGN KEY,
  warehouse_id UUID NOT NULL FOREIGN KEY,
  
  -- Идентификация
  sku TEXT,                         -- Артикул или номер
  serial_number TEXT UNIQUE,        -- Уникальный номер (если нужен)
  
  -- Статус
  status inventory_item_status NOT NULL DEFAULT 'AVAILABLE',
  
  -- Системные поля
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Индексы
  INDEX idx_variant (variant_id),
  INDEX idx_status (status),
  INDEX idx_warehouse (warehouse_id)
);
```

**Примеры**:

```sql
-- 3 платья M
INSERT INTO inventory_items (variant_id, warehouse_id, sku, status)
VALUES 
  ('dress-M-uuid', 'warehouse-uuid', 'DRESS-M-001', 'AVAILABLE'),
  ('dress-M-uuid', 'warehouse-uuid', 'DRESS-M-002', 'AVAILABLE'),
  ('dress-M-uuid', 'warehouse-uuid', 'DRESS-M-003', 'AVAILABLE');

-- Проверить доступные предметы
SELECT * FROM inventory_items
WHERE variant_id = 'dress-M-uuid'
AND status = 'AVAILABLE';
```

---

## 🔷 Модифицированные таблицы

### 1. product_variants (ИЗМЕНЕНИЯ)

```sql
ALTER TABLE product_variants ADD COLUMN (
  can_sell BOOLEAN DEFAULT true,      -- Может ли продаваться
  can_rent BOOLEAN DEFAULT false      -- Может ли сдаваться в аренду
);
```

**Логика**:
```sql
-- Товар только для продажи
UPDATE product_variants SET can_sell = true, can_rent = false WHERE id = 'shirt-uuid';

-- Товар только для аренды
UPDATE product_variants SET can_sell = false, can_rent = true WHERE id = 'wedding-dress-uuid';

-- Товар для обоих
UPDATE product_variants SET can_sell = true, can_rent = true WHERE id = 'drill-uuid';

-- Найти товары доступные для аренды
SELECT * FROM product_variants WHERE can_rent = true;
```

---

### 2. order_items (ИЗМЕНЕНИЯ)

```sql
ALTER TABLE order_items ADD COLUMN (
  item_type order_item_type DEFAULT 'SALE',  -- SALE или RENT
  rental_id UUID UNIQUE,                      -- FK к rentals (если RENT)
  allow_early_return_refund BOOLEAN DEFAULT false,
  early_return_refund_type early_return_refund_type,
  early_return_refund_amount DECIMAL(15,2)
);

ALTER TABLE order_items ADD FOREIGN KEY (rental_id) REFERENCES rentals(id);
```

**Логика**:
```sql
-- OrderItem с типом SALE
INSERT INTO order_items (..., item_type, rental_id)
VALUES (..., 'SALE', NULL);

-- OrderItem с типом RENT
INSERT INTO order_items (..., item_type, rental_id, allow_early_return_refund, early_return_refund_type)
VALUES (..., 'RENT', 'rental-uuid', true, 'FULL');

-- Получить все RENT items в заказе
SELECT * FROM order_items
WHERE order_id = 'order-uuid'
AND item_type = 'RENT';
```

---

### 3. stock_movements (ENUM EXPANSION)

**Текущий enum**:
```sql
ENUM StockMovementReason {
  PURCHASE,
  SALE,
  SALE_RETURN,
  ADJUSTMENT
}
```

**Новый enum** (РАСШИРЕНИЕ):
```sql
ALTER TYPE stock_movement_reason ADD VALUE 'RENT';        -- Товар выдан в аренду
ALTER TYPE stock_movement_reason ADD VALUE 'RENT_RETURN';  -- Товар возвращен из аренды
ALTER TYPE stock_movement_reason ADD VALUE 'WRITE_OFF';    -- Товар списан (ущерб/потеря)
```

**Примеры**:
```sql
-- Выдача в аренду (OUT/RENT)
INSERT INTO stock_movements (variant_id, warehouse_id, type, reason, quantity, unit_cost, created_by_id)
VALUES ('dress-M-uuid', 'warehouse-uuid', 'OUT', 'RENT', -1, 50, 'staff-uuid');

-- Возврат из аренды (IN/RENT_RETURN)
INSERT INTO stock_movements (variant_id, warehouse_id, type, reason, quantity, unit_cost, created_by_id)
VALUES ('dress-M-uuid', 'warehouse-uuid', 'IN', 'RENT_RETURN', 1, 50, 'staff-uuid');

-- Списание за ущерб (OUT/WRITE_OFF)
INSERT INTO stock_movements (variant_id, warehouse_id, type, reason, quantity, unit_cost, created_by_id)
VALUES ('dress-M-uuid', 'warehouse-uuid', 'OUT', 'WRITE_OFF', -1, 50, 'staff-uuid');
```

---

### 4. cash_transactions (ENUM EXPANSION)

**Текущий enum**:
```sql
ENUM CashTransactionCategory {
  SALE,
  DEBT_PAYMENT,
  DELIVERY,
  SALARY,
  PURCHASE,
  RETURN,
  OTHER
}
```

**Новый enum** (РАСШИРЕНИЕ):
```sql
ALTER TYPE cash_transaction_category ADD VALUE 'RENT';         -- Платеж за аренду
ALTER TYPE cash_transaction_category ADD VALUE 'DAMAGE';       -- Штраф за ущерб
ALTER TYPE cash_transaction_category ADD VALUE 'RENT_DEPOSIT';  -- Залоговые платежи
```

**Примеры**:
```sql
-- Платеж за аренду (INCOME/RENT)
INSERT INTO cash_transactions (cashbox_id, type, category, payment_type, amount, order_id, created_by_id)
VALUES ('cashbox-uuid', 'INCOME', 'RENT', 'CASH', 400, 'order-uuid', 'staff-uuid');

-- Внесение залога (INCOME/RENT_DEPOSIT)
INSERT INTO cash_transactions (cashbox_id, type, category, payment_type, amount, order_id, created_by_id)
VALUES ('cashbox-uuid', 'INCOME', 'RENT_DEPOSIT', 'CASH', 1000, 'order-uuid', 'staff-uuid');

-- Штраф за ущерб (INCOME/DAMAGE)
INSERT INTO cash_transactions (cashbox_id, type, category, payment_type, amount, order_id, created_by_id)
VALUES ('cashbox-uuid', 'INCOME', 'DAMAGE', 'CASH', 300, 'order-uuid', 'staff-uuid');

-- Возврат залога (EXPENSE/RENT_DEPOSIT)
INSERT INTO cash_transactions (cashbox_id, type, category, payment_type, amount, order_id, created_by_id)
VALUES ('cashbox-uuid', 'EXPENSE', 'RENT_DEPOSIT', 'CASH', 1000, 'order-uuid', 'staff-uuid');
```

---

## 🔷 Новые ENUMS

```sql
CREATE TYPE order_item_type AS ENUM ('SALE', 'RENT');

CREATE TYPE rental_status AS ENUM (
  'ACTIVE',      -- Товар в аренде
  'RETURNED',    -- Вернулся нормально
  'LATE',        -- Не вернулся в срок
  'DAMAGED',     -- Вернулся поврежденным
  'LOST',        -- Потерян
  'PURCHASED'    -- Клиент купил
);

CREATE TYPE deposit_status AS ENUM (
  'HELD',        -- Удерживается в кассе
  'RETURNED',    -- Возвращен клиенту
  'FORFEITED'    -- Конфискован (из-за ущерба)
);

CREATE TYPE deposit_type AS ENUM (
  'CASH',
  'GOLD',
  'DOCUMENT',
  'OTHER'
);

CREATE TYPE reservation_status AS ENUM (
  'PENDING',               -- Ожидает подтверждения
  'CONFIRMED',             -- Подтверждено
  'CONVERTED_TO_RENTAL',   -- Стало арендой
  'CANCELLED'              -- Отменено
);

CREATE TYPE inventory_item_status AS ENUM (
  'AVAILABLE',  -- На складе
  'RENTED',     -- В аренде
  'SOLD',       -- Продано
  'DAMAGED',    -- Повреждено
  'LOST'        -- Потеряно
);

CREATE TYPE early_return_refund_type AS ENUM (
  'FULL',    -- 100% возврат за неиспользованные дни
  'CUSTOM',  -- Стафф определяет сумму
  'NONE'     -- Возврат не разрешен
);
```

---

## 🔗 Связи и ограничения

### Диаграмма связей

```
ProductVariant
├── 1→∞ RentalRate
├── 1→∞ InventoryItem (опционально)
└── 1→∞ Reservation

OrderItem
├── 1→1 Rental (если itemType = RENT)
└── ORDER_ITEM_TYPE = 'RENT' → MUST_EXIST Rental

Rental
├── 1→1 OrderItem (FK)
└── 1→1 RentalDeposit (опционально)

Order
├── 1→∞ OrderItem
│   ├── type = 'SALE' → StockMovement (OUT/SALE)
│   └── type = 'RENT' → Rental + StockMovement (OUT/RENT)

StockMovement
├── Reasons: PURCHASE, SALE, SALE_RETURN, RENT, RENT_RETURN, WRITE_OFF, ADJUSTMENT

CashTransaction
├── Categories: SALE, DEBT_PAYMENT, RENT, DAMAGE, RENT_DEPOSIT, DELIVERY, SALARY, PURCHASE, RETURN, OTHER

Cashbox
├── 1→∞ CashTransaction
│   ├── INCOME/RENT
│   ├── INCOME/RENT_DEPOSIT
│   ├── INCOME/DAMAGE
│   ├── EXPENSE/RENT_DEPOSIT (возврат залога)
│   └── EXPENSE/RENT (возврат за ранний возврат)
```

### Ограничения

```sql
-- rental_rates
MIN_DAYS >= 1
MAX_DAYS IS NULL OR MAX_DAYS >= MIN_DAYS

-- rentals
START_DATE < DUE_DATE
RENTAL_PRICE > 0
IF status = 'RETURNED' THEN returned_at IS NOT NULL
IF status = 'DAMAGED' THEN damage_fee IS NOT NULL
IF status = 'LOST' THEN damage_fee > 0

-- reservations
RENTAL_START_DATE < RENTAL_END_DATE

-- order_items
IF item_type = 'RENT' THEN rental_id IS NOT NULL
IF item_type = 'SALE' THEN rental_id IS NULL
IF allow_early_return_refund = true THEN early_return_refund_type IS NOT NULL

-- inventory_items
status IN ('AVAILABLE', 'RENTED', 'SOLD', 'DAMAGED', 'LOST')
```

---

## 🔑 Индексы

```sql
-- rental_rates
CREATE INDEX idx_rental_rates_variant ON rental_rates(product_variant_id);
CREATE INDEX idx_rental_rates_days ON rental_rates(min_days, max_days);

-- rentals
CREATE INDEX idx_rentals_order_item ON rentals(order_item_id);
CREATE INDEX idx_rentals_status_due_date ON rentals(status, due_date);
CREATE INDEX idx_rentals_created_at ON rentals(created_at);
CREATE INDEX idx_rentals_returned_at ON rentals(returned_at);

-- reservations
CREATE INDEX idx_reservations_variant ON reservations(product_variant_id);
CREATE INDEX idx_reservations_dates ON reservations(rental_start_date, rental_end_date);
CREATE INDEX idx_reservations_status ON reservations(status);
CREATE INDEX idx_reservations_customer ON reservations(customer_id);
CREATE INDEX idx_reservations_expires ON reservations(expires_at);

-- inventory_items
CREATE INDEX idx_inventory_items_variant ON inventory_items(variant_id);
CREATE INDEX idx_inventory_items_status ON inventory_items(status);
CREATE INDEX idx_inventory_items_warehouse ON inventory_items(warehouse_id);
CREATE INDEX idx_inventory_items_serial ON inventory_items(serial_number);
```

---

## 📊 Примеры данных

### Сценарий: Аренда платья на 5 дней

```sql
-- 1. ProductVariant (платье)
SELECT * FROM product_variants WHERE id = 'dress-M-uuid';
-- Result: canSell=true, canRent=true, price=5000

-- 2. RentalRate (тарифы)
SELECT * FROM rental_rates WHERE product_variant_id = 'dress-M-uuid';
-- Result:
-- { minDays: 1, maxDays: 2, pricePerDay: 100 }
-- { minDays: 3, maxDays: 7, pricePerDay: 80 }
-- { minDays: 13, maxDays: null, pricePerDay: 50 }

-- 3. Order и OrderItem
INSERT INTO orders (...) VALUES ('order-uuid', 'store-uuid', ...);
INSERT INTO order_items (...) VALUES (
  'orderitem-uuid', 'order-uuid', 'dress-M-uuid', 1, 
  400, 0, 50,  -- retailPrice, sale, costAtSale
  'RENT', 'rental-uuid'
);

-- 4. Rental
INSERT INTO rentals (...) VALUES (
  'rental-uuid', 'orderitem-uuid',
  '2026-08-20 10:00:00', '2026-08-25 10:00:00', NULL,
  'ACTIVE', 400,
  1000, 'HELD', NULL,  -- depositAmount, depositStatus, depositReturnedAt
  NULL, NULL, NULL,     -- damageFee, damageDescription, damagePhotoUrl
  NULL,                 -- earlyReturnRefund
  'Платье для гостя'
);

-- 5. RentalDeposit (если залог)
INSERT INTO rental_deposits (...) VALUES (
  'deposit-uuid', 'rental-uuid', 1000, 'CASH', NULL,
  NOW(), NULL,
  'HELD'
);

-- 6. StockMovement (выдача)
INSERT INTO stock_movements (...) VALUES (
  'movement-uuid', 'dress-M-uuid', 'warehouse-uuid',
  'OUT', 'RENT', -1, 50,
  'staff-uuid', NOW()
);

-- 7. Inventory (обновлено)
UPDATE inventory SET quantity = quantity - 1
WHERE variant_id = 'dress-M-uuid' AND warehouse_id = 'warehouse-uuid';

-- 8. CashTransactions (платежи)
INSERT INTO cash_transactions (...) VALUES
  ('cashtx-rent-uuid', 'cashbox-uuid', 'INCOME', 'RENT', 'CASH', 400, 'order-uuid', 'staff-uuid'),
  ('cashtx-deposit-uuid', 'cashbox-uuid', 'INCOME', 'RENT_DEPOSIT', 'CASH', 1000, 'order-uuid', 'staff-uuid');
```

---

## 🔍 Запросы для отчетов

### Доход от аренд за период

```sql
SELECT
  DATE_TRUNC('day', r.created_at) as date,
  SUM(r.rental_price) as rental_income,
  SUM(r.damage_fee) as damage_income,
  COUNT(CASE WHEN r.status = 'RETURNED' THEN 1 END) as returned_count,
  COUNT(CASE WHEN r.status = 'DAMAGED' THEN 1 END) as damaged_count,
  COUNT(CASE WHEN r.status = 'LOST' THEN 1 END) as lost_count
FROM rentals r
WHERE r.created_at BETWEEN '2026-08-01' AND '2026-08-31'
GROUP BY DATE_TRUNC('day', r.created_at)
ORDER BY date DESC;
```

### Популярные товары для аренды

```sql
SELECT
  pv.id,
  p.name,
  pv.sku,
  COUNT(r.id) as rental_count,
  SUM(r.rental_price) as total_income
FROM rentals r
JOIN order_items oi ON r.order_item_id = oi.id
JOIN product_variants pv ON oi.variant_id = pv.id
JOIN products p ON pv.product_id = p.id
WHERE r.created_at >= NOW() - INTERVAL '30 days'
GROUP BY pv.id, p.name, pv.sku
ORDER BY rental_count DESC
LIMIT 10;
```

### Активные аренды (что сейчас на руках)

```sql
SELECT
  r.id,
  r.start_date,
  r.due_date,
  (r.due_date < NOW()) as is_overdue,
  p.name,
  pv.sku,
  c.user_id,
  c2.full_name
FROM rentals r
JOIN order_items oi ON r.order_item_id = oi.id
JOIN product_variants pv ON oi.variant_id = pv.id
JOIN products p ON pv.product_id = p.id
JOIN orders o ON oi.order_id = o.id
JOIN customers c ON o.customer_id = c.id
JOIN users c2 ON c.user_id = c2.id
WHERE r.status = 'ACTIVE'
ORDER BY r.due_date ASC;
```

