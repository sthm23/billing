# 🏗️ Архитектура Системы Аренды

## 📌 Содержание

1. [Обзор](#обзор)
2. [Ключевые концепции](#ключевые-концепции)
3. [Структура данных](#структура-данных)
4. [Отношения между сущностями](#отношения-между-сущностями)
5. [Интеграция с существующей системой](#интеграция-с-существующей-системой)

---

## 📋 Обзор

**Система аренды товаров** — это расширение платформы my-billing, которое позволяет:

- Сдавать товары в краткосрочную и долгосрочную аренду
- Смешивать продажи и аренду в одном заказе
- Управлять депозитами и штрафами за ущерб
- Отслеживать доступность товаров с учетом активных аренд
- Резервировать товары на будущие даты
- Продлевать аренду и обрабатывать ранние возвраты

---

## 🎯 Ключевые концепции

### 1. Товар может быть в трех состояниях

```
Product → ProductVariant
├── canSell: true, canRent: false    → Только продажа (футболка)
├── canSell: false, canRent: true    → Только аренда (свадебное платье)
└── canSell: true, canRent: true     → И продажа И аренда (генератор)
```

### 2. Один заказ может содержать ОБА типа операций

```
Order #123
├── Item 1: Футболка         → Type: SALE       → Продана
├── Item 2: Платье            → Type: RENT       → В аренде
├── Item 3: Туфли             → Type: RENT       → В аренде
└── Item 4: Носки             → Type: SALE       → Продана
```

### 3. Инвентарь отражает ФИЗИЧЕСКОЕ наличие

```
ProductVariant: Платье M
├── Total Stock: 3
├── Active Rentals: 2  (сейчас в аренде)
├── Available: 1       (можно сдать еще)
└── Reservations: 1    (зарезервировано на будущее)
```

### 4. Движение товара отслеживается полностью

```
Платье в истории:
PURCHASE → 100 сум (приход на склад)
RENT_OUT → -1 (выдано в аренду)
RENT_RETURN → +1 (возвращено из аренды)
WRITE_OFF → -1 (списано за ущерб)
```

### 5. Тарифы гибкие и динамические

```
RentalRate для платья M:
├── 1-2 дня:   100 сум/день
├── 3-7 дней:  80 сум/день
└── 13+ дней:  50 сум/день

Магазин может изменить в любой момент
```

### 6. Депозит — это временно удержанные деньги

```
Клиент берет платье в аренду:
├── Цена аренды (5 дней × 80 сум):  400 сум  ← доход
├── Залог (депозит):                 1000 сум ← временный платеж
├── ИТОГО К ОПЛАТЕ:                  1400 сум
└── Статус залога: HELD

При возврате в нормальном состоянии:
├── Залог возвращается:              1000 сум (EXPENSE)
└── Статус залога: RETURNED

При возврате с ущербом:
├── Ущерб (100 сум):                 ← INCOME (штраф)
├── Залог минус ущерб:                900 сум (EXPENSE)
└── Статус залога: FORFEITED
```

---

## 🗂️ Структура данных

### Новые таблицы

#### 1. RentalRate (Тарифная сетка)

```prisma
model RentalRate {
  id                String   @id @default(uuid())
  productVariantId  String   // FK к ProductVariant
  
  minDays           Int      // Минимум дней (включительно)
  maxDays           Int?     // Максимум дней (включительно, null = без лимита)
  pricePerDay       Decimal  // Цена за день
  
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  
  variant           ProductVariant @relation(fields: [productVariantId], references: [id])
}
```

**Примеры**:
- minDays: 1, maxDays: 2, price: 100 → 1-2 дня по 100 сум/день
- minDays: 3, maxDays: 7, price: 80 → 3-7 дней по 80 сум/день
- minDays: 13, maxDays: null, price: 50 → 13+ дней по 50 сум/день

---

#### 2. Rental (Запись об аренде)

```prisma
model Rental {
  id                    String    @id @default(uuid())
  orderItemId           String    @unique  // FK к OrderItem
  
  // Основные даты
  startDate             DateTime            // Когда клиент забирает
  dueDate               DateTime            // Когда должен вернуть
  returnedAt            DateTime?           // Когда фактически вернул
  
  // Статус аренды
  status                RentalStatus        // ACTIVE, RETURNED, LATE, DAMAGED, LOST, PURCHASED
  
  // Плата за аренду
  rentalPrice           Decimal             // Цена которая была вычислена при создании
  
  // Депозит (опциональный)
  depositAmount         Decimal?            // Сумма залога (если был)
  depositStatus         DepositStatus?      // HELD, RETURNED, FORFEITED
  depositReturnedAt     DateTime?           // Когда вернули залог
  
  // При возврате
  damageFee             Decimal?            // Штраф за ущерб (заполняется при возврате)
  damageDescription     String?             // Описание ущерба
  damagePhotoUrl        String?             // Фото ущерба
  
  // Возврат денег при раннем возврате
  earlyReturnRefund     Decimal?            // Возврат за неиспользованные дни (если разрешено)
  
  // Доп информация
  notes                 String?             // Заметки кассира
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  
  // Связи
  orderItem             OrderItem @relation(fields: [orderItemId], references: [id])
}
```

**Статусы Rental**:
- **ACTIVE**: Товар выдан, клиент его использует
- **RETURNED**: Возвращен в нормальном состоянии
- **LATE**: Не возвращен в срок (автоматически через job)
- **DAMAGED**: Возвращен поврежденным (ущерб определен)
- **LOST**: Товар потерян (клиент не вернул)
- **PURCHASED**: Клиент решил купить вместо возврата

---

#### 3. RentalDeposit (Отдельный учет депозита)

```prisma
model RentalDeposit {
  id                String         @id @default(uuid())
  rentalId          String         @unique  // FK к Rental
  
  amount            Decimal        // Сумма залога
  type              DepositType    // CASH, GOLD, DOCUMENT, OTHER
  description       String?        // Описание (для документов)
  
  paidAt            DateTime       @default(now())
  returnedAt        DateTime?      // Когда вернули/конфисковали
  
  status            DepositStatus  // HELD, RETURNED, FORFEITED
  
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt
  
  rental            Rental @relation(fields: [rentalId], references: [id])
}
```

**DepositType**:
- **CASH**: Деньги
- **GOLD**: Золото (украшения)
- **DOCUMENT**: Документы (паспорт, документы)
- **OTHER**: Прочее (телефон, электроника)

---

#### 4. Reservation (Бронирование)

```prisma
model Reservation {
  id                    String              @id @default(uuid())
  productVariantId      String
  customerId            String
  storeId               String
  
  rentalStartDate       DateTime            // Когда клиент хочет взять
  rentalEndDate         DateTime            // Когда хочет вернуть
  
  status                ReservationStatus   // PENDING, CONFIRMED, CONVERTED_TO_RENTAL, CANCELLED
  convertedToRentalId   String?             // ID Rental, если стало арендой
  
  notes                 String?
  createdAt             DateTime @default(now())
  expiresAt             DateTime?           // Бронь действительна до этого времени
  
  variant               ProductVariant @relation(fields: [productVariantId], references: [id])
  customer              Customer @relation(fields: [customerId], references: [id])
  store                 Store @relation(fields: [storeId], references: [id])
}
```

**ReservationStatus**:
- **PENDING**: Ожидание подтверждения (клиент может отменить)
- **CONFIRMED**: Клиент подтвердил, ждет даты аренды
- **CONVERTED_TO_RENTAL**: Перешло в актуальную Rental
- **CANCELLED**: Клиент отменил или истекло время

---

#### 5. InventoryItem (Поштучный учет — опционально)

```prisma
model InventoryItem {
  id              String                @id @default(uuid())
  variantId       String
  warehouseId     String
  
  sku             String?               // Артикул или уникальный номер
  serialNumber    String?               @unique
  
  status          InventoryItemStatus   // AVAILABLE, RENTED, SOLD, DAMAGED, LOST
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  variant         ProductVariant @relation(fields: [variantId], references: [id])
  warehouse       Warehouse @relation(fields: [warehouseId], references: [id])
  rentals         Rental[]              // История аренд для этого конкретного товара
}
```

**InventoryItemStatus**:
- **AVAILABLE**: Товар доступен на складе
- **RENTED**: Сейчас в аренде
- **SOLD**: Продан
- **DAMAGED**: Поврежден
- **LOST**: Потерян

---

### Модифицированные таблицы

#### ProductVariant

**НОВЫЕ ПОЛЯ**:
```prisma
canSell         Boolean @default(true)   // Может ли продаваться
canRent         Boolean @default(false)  // Может ли сдаваться в аренду

// Связи
rentalRates     RentalRate[]             // Тарифы аренды
inventoryItems  InventoryItem[]?         // Если нужен поштучный учет
```

---

#### OrderItem

**НОВЫЕ ПОЛЯ**:
```prisma
itemType        OrderItemType @default(SALE)  // SALE или RENT
rentalId        String?       @unique         // FK к Rental (если RENT)
rental          Rental?                       // Связь с Rental

// Доп поля для раннего возврата
allowEarlyReturnRefund  Boolean @default(false)  // Разрешить возврат
earlyReturnRefundType   EarlyReturnRefundType?   // FULL, CUSTOM, NONE
earlyReturnRefundAmount Decimal?                 // Если CUSTOM, сколько вернуть
```

**EarlyReturnRefundType**:
- **FULL**: Возвращается 100% за неиспользованные дни (100% × (дни_осталось / всего_дней))
- **CUSTOM**: Стафф сам определяет сумму
- **NONE**: Возврат не разрешен

---

#### StockMovement

**НОВЫЕ ENUM ЗНАЧЕНИЯ**:
```prisma
enum StockMovementReason {
  PURCHASE      // существующий
  SALE          // существующий
  SALE_RETURN   // существующий
  RENT          // ← НОВЫЙ (когда товар выдан в аренду)
  RENT_RETURN   // ← НОВЫЙ (когда товар возвращен из аренды)
  ADJUSTMENT    // существующий
  WRITE_OFF     // ← НОВЫЙ (товар списан за ущерб/потерю)
}
```

---

#### CashTransaction

**НОВЫЕ ENUM ЗНАЧЕНИЯ**:
```prisma
enum CashTransactionCategory {
  SALE          // существующий
  DEBT_PAYMENT  // существующий
  RENT          // ← НОВЫЙ (платежи за аренду)
  DAMAGE        // ← НОВЫЙ (штрафы за ущерб)
  RENT_DEPOSIT  // ← НОВЫЙ (залоговые платежи)
  DELIVERY      // существующий
  SALARY        // существующий
  PURCHASE      // существующий
  RETURN        // существующий
  OTHER         // существующий
}
```

---

#### Новые ENUMS

```prisma
enum OrderItemType {
  SALE      // Продажа
  RENT      // Аренда
}

enum DepositStatus {
  HELD      // Залог удерживается в кассе
  RETURNED  // Возвращен клиенту
  FORFEITED // Конфискован (из-за ущерба/потери)
}

enum DepositType {
  CASH      // Деньги
  GOLD      // Золото
  DOCUMENT  // Документы
  OTHER     // Прочее
}

enum ReservationStatus {
  PENDING               // Ожидание подтверждения
  CONFIRMED             // Подтверждено
  CONVERTED_TO_RENTAL   // Стало арендой
  CANCELLED             // Отменено
}

enum InventoryItemStatus {
  AVAILABLE
  RENTED
  SOLD
  DAMAGED
  LOST
}

enum EarlyReturnRefundType {
  FULL      // 100% возврат за неиспользованные дни
  CUSTOM    // Стафф определяет сумму
  NONE      // Возврат не разрешен
}
```

---

## 🔗 Отношения между сущностями

```
┌─────────────────────────────────────────────────────────────┐
│                          STORE                              │
│  (Магазин определяет политику аренды)                        │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
    WAREHOUSE        PRODUCT         CUSTOMER
    (Склад)         ├── Продажа      │
                    │   └── SALE      ├── может бронировать
                    └── Аренда       │
                        ├── RENT      └── может арендовать
                        └── RentalRate

    ProductVariant (SKU)
    ├── canSell, canRent
    ├── RentalRate[]
    │   ├── 1-2 дня:  100 сум/день
    │   ├── 3-7 дней: 80 сум/день
    │   └── 13+:      50 сум/день
    │
    ├── InventoryItem[] (опционально, для поштучного учета)
    │   ├── #001 → AVAILABLE
    │   ├── #002 → RENTED
    │   └── #003 → AVAILABLE
    │
    └── Inventory (общее количество)
        └── quantity = total - rented - reserved

    ORDER (Чек/документ)
    │
    └── OrderItem[] (позиции в чеке)
        ├── Item 1: SALE    (обычная продажа)
        │   └── StockMovement: OUT/SALE
        │
        └── Item 2: RENT    (аренда)
            ├── Rental (специфичные данные аренды)
            │   ├── startDate, dueDate
            │   ├── depositAmount, depositStatus
            │   ├── damageFee, damageDescription
            │   └── earlyReturnRefund
            │
            ├── RentalDeposit (если были деньги в залоге)
            │   ├── type: CASH, GOLD, DOCUMENT
            │   └── status: HELD → RETURNED/FORFEITED
            │
            └── StockMovement: OUT/RENT
                └── (при возврате) IN/RENT_RETURN

    RESERVATION (Опциональное бронирование)
    │
    ├── productVariantId
    ├── customerId
    ├── rentalStartDate, rentalEndDate
    └── status: PENDING → CONFIRMED → CONVERTED_TO_RENTAL

    PAYMENT (Платежи)
    │
    ├── Payment за аренду (категория: RENT)
    ├── Payment залога (категория: RENT_DEPOSIT)
    └── Payment штрафа за ущерб (категория: DAMAGE)

    CASHBOX & CASHTRANSACTION
    │
    ├── INCOME/RENT (платеж за аренду)
    ├── INCOME/DAMAGE (штраф за ущерб)
    ├── INCOME/RENT_DEPOSIT (внесен залог)
    ├── EXPENSE/RENT_DEPOSIT (возврат залога)
    └── EXPENSE/WRITE_OFF (списание за потерю)
```

---

## 🔄 Интеграция с существующей системой

### Как это работает с текущим Order Flow

**Текущая система**:
```
Order (CREATED) 
  → OrderItem (CREATED/HOLD)
  → Payment (создается платеж)
  → StockMovement (OUT/SALE)
  → CashTransaction (INCOME/SALE)
  → Order.status = COMPLETED
```

**С системой аренды**:
```
Order (CREATED)
  ├── OrderItem 1 (SALE)
  │   └── StockMovement (OUT/SALE)
  │   └── CashTransaction (INCOME/SALE)
  │
  └── OrderItem 2 (RENT)
      ├── Rental (ACTIVE)
      │   ├── RentalDeposit (если залог)
      │   └── StockMovement (OUT/RENT)
      │
      └── CashTransaction (INCOME/RENT)
      └── CashTransaction (INCOME/RENT_DEPOSIT) - если было

Payment (единый на весь заказ)
  ├── amount = SALE_price + RENT_price + DEPOSIT
  ├── type = CASH | CARD | ONLINE | TRANSFER
  └── стафф может добавить несколько платежей

Order.status = COMPLETED (когда все оплачено)
```

### Что НЕ меняется

✅ **Не меняется**:
- Order структура (остается generic документом)
- Payment система (работает как раньше)
- Cashbox логика (залог тоже идет в баланс)
- Auth и Role система
- Warehouse логика
- Customer/Staff управление

❌ **Меняется**:
- OrderItem получает поле `itemType`
- StockMovement добавляет новые reasons
- CashTransaction добавляет новые категории
- ProductVariant добавляет `canSell/canRent`

---

## 📐 Диаграмма взаимодействия

```
┌────────────────────────────────────────────────────────┐
│  КЛИЕНТ хочет взять платье в аренду на 5 дней         │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
         ┌─────────────────────────┐
         │ 1. ПРОВЕРКА ДОСТУПНОСТИ │
         └────────────┬────────────┘
                      │
         ┌────────────▼──────────────────┐
         │ getAvailableRentalItems()     │
         │ ├─ Total Stock: 5            │
         │ ├─ Active Rentals: 2         │
         │ ├─ Reservations: 1           │
         │ └─ Available: 2 ✓            │
         └────────────┬──────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │ 2. РАСЧЕТ ЦЕНЫ         │
         └────────────┬───────────┘
                      │
         ┌────────────▼─────────────────┐
         │ calculateRentalPrice()       │
         │ ├─ 5 дней попадает в тариф  │
         │ │  "3-7 дней = 80 сум/день" │
         │ └─ Итого: 5 × 80 = 400 сум  │
         └────────────┬─────────────────┘
                      │
                      ▼
         ┌─────────────────────────┐
         │ 3. СОЗДАНИЕ ЗАКАЗА      │
         └────────────┬────────────┘
                      │
         ┌────────────▼──────────────────┐
         │ OrderItem {                   │
         │   itemType: RENT              │
         │   startDate: 2026-08-20       │
         │   dueDate: 2026-08-25         │
         │   unitPrice: 400 (из тарифа)  │
         │ }                             │
         └────────────┬──────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │ 4. СОЗДАНИЕ RENTAL     │
         └────────────┬───────────┘
                      │
         ┌────────────▼─────────────────┐
         │ Rental {                     │
         │   status: ACTIVE             │
         │   rentalPrice: 400           │
         │   depositAmount: 1000 (опц)  │
         │   depositStatus: HELD        │
         │ }                            │
         └────────────┬─────────────────┘
                      │
                      ▼
         ┌─────────────────────────────────┐
         │ 5.股票 ДВИЖЕНИЕ              │
         └────────────┬───────────────────┘
                      │
         ┌────────────▼──────────────────────┐
         │ StockMovement {                   │
         │   type: OUT                       │
         │   reason: RENT  ← НОВЫЙ            │
         │   quantity: -1                    │
         │ }                                 │
         └────────────┬──────────────────────┘
                      │
                      ▼
         ┌────────────────────────────┐
         │ 6. ОПЛАТА                  │
         └────────────┬───────────────┘
                      │
         ┌────────────▼──────────────────────────┐
         │ Payment {                             │
         │   amount: 1400 (400 + 1000 залог)     │
         │   type: CASH | CARD                   │
         │ }                                     │
         └────────────┬──────────────────────────┘
                      │
              ┌───────┴─────────┐
              ▼                 ▼
         RENT платеж      DEPOSIT платеж
         CashTransaction  CashTransaction
         category: RENT   category: RENT_DEPOSIT
         amount: 400      amount: 1000
              │                 │
              └────────┬────────┘
                       │
                       ▼
              Cashbox.balance ↑ 1400
                       │
                       ▼
         ═════════════════════════════════
         КЛИЕНТ ТЕ НЯТЬ ПЛАТЬЕ ДОМ
         Rental.status = ACTIVE
         ═════════════════════════════════
```

---

## 🔐 Безопасность и валидация

### Критические проверки

1. **При создании аренды**:
   - ✓ ProductVariant.canRent = true
   - ✓ startDate < dueDate
   - ✓ getAvailableRentalItems() >= quantity
   - ✓ Нет overlapping Reservations
   - ✓ Staff имеет доступ к Warehouse

2. **При оплате**:
   - ✓ order.totalAmount >= sum(payments)
   - ✓ Cashbox открыта

3. **При возврате**:
   - ✓ Rental.status = ACTIVE
   - ✓ returnedAt <= dueDate + grace period (если нужен)
   - ✓ damageFee >= 0

4. **При продлении**:
   - ✓ Rental.status = ACTIVE
   - ✓ newDueDate > currentDueDate
   - ✓ getAvailableRentalItems(newDueDate, nextBoundary) >= 1

5. **При бронировании**:
   - ✓ CustomerId существует и принадлежит Store
   - ✓ rentalStartDate < rentalEndDate
   - ✓ getAvailableRentalItems() >= 1
   - ✓ Нет других Reservations на эту дату

---

## 🎓 Резюме

Система аренды интегрируется в my-billing через:

1. **OrderItem.itemType** — определяет тип операции (SALE vs RENT)
2. **Rental** — хранит специфичные для аренды данные
3. **RentalRate** — гибкая тарифная сетка
4. **RentalDeposit** — отдельный учет залогов
5. **Reservation** — опциональное бронирование
6. **InventoryItem** — опциональный поштучный учет (для платьев, инструментов)
7. **StockMovement** — отслеживание с новыми reasons (RENT, RENT_RETURN, WRITE_OFF)
8. **CashTransaction** — новые категории (RENT, DAMAGE, RENT_DEPOSIT)

**Главная идея**: не создавать отдельную систему аренды, а расширить существующую Order → OrderItem → Payment → StockMovement архитектуру.

