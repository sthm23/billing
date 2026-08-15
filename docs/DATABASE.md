# Database Schema — Детальная схема базы данных

## Содержание
1. [Обзор](#обзор)
2. [Auth & Users](#auth--users)
3. [Stores & Staff](#stores--staff)
4. [Warehouses](#warehouses)
5. [Products & Variants](#products--variants)
6. [Inventory](#inventory)
7. [Orders & Sales](#orders--sales)
8. [Returns](#returns)
9. [Payments](#payments)
10. [Cashbox](#cashbox)
11. [Debts](#debts)
12. [Catalog (Categories, Brands, Attributes)](#catalog)
13. [Enums](#enums)
14. [Индексы и ограничения](#индексы-и-ограничения)

---

## Обзор

**СУБД**: PostgreSQL 17  
**ORM**: Prisma 6  
**Prisma Client**: генерируется в `generated/prisma` (не дефолтный `node_modules/.prisma`)

### Ключевые принципы
- **Soft delete**: товары архивируются (`isArchived`), не удаляются
- **Аудит**: все изменения inventory и денег логируются (StockMovement, CashTransaction)
- **Decimal для денег**: все суммы хранятся как `Decimal` (точность до копеек)
- **UUID для ID**: все первичные ключи — UUID v4

---

## Auth & Users

### User
Базовая таблица пользователей.

```prisma
model User {
  id              String           @id @default(uuid())
  fullName        String
  phone           String           @unique
  role            UserRole         @default(USER)  // ADMIN | OWNER | USER
  type            UserType                          // CUSTOMER | STAFF
  createdAt       DateTime         @default(now())
  image           String?
  
  // Relationships
  auth            AuthAccount?
  customer        Customer?
  refreshSessions RefreshSession[]
  staff           Staff?
  stores          Store[]  // Созданные магазины (для ADMIN)
}
```

**Enums**:
- `UserRole`: ADMIN, OWNER, USER
- `UserType`: CUSTOMER, STAFF

**Ограничения**:
- `phone` — уникален глобально
- Если `type = CUSTOMER` → должна быть запись в `Customer`
- Если `type = STAFF` → должна быть запись в `Staff`

---

### AuthAccount
Учетные данные для авторизации.

```prisma
model AuthAccount {
  id           String   @id @default(uuid())
  userId       String   @unique
  login        String   @unique  // email, username, или phone
  passwordHash String
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  
  user         User     @relation(fields: [userId], references: [id])
}
```

**Логика**:
- `passwordHash` создается через bcrypt (salt rounds: 10)
- `isActive = false` → пользователь не может войти

---

### RefreshSession
JWT refresh токены (для rotation).

```prisma
model RefreshSession {
  id          String   @id @default(uuid())
  userId      String
  refreshHash String        // bcrypt hash токена
  userAgent   String?       // Браузер/устройство
  ip          String?       // IP адрес
  expiresAt   DateTime      // 7 дней от создания
  createdAt   DateTime @default(now())
  isRevoked   Boolean  @default(false)  // Отозван при logout/refresh
  
  user        User     @relation(fields: [userId], references: [id])
}
```

**Индексы**: `@@index([userId])`

**Логика**:
- При каждом refresh — старая сессия помечается `isRevoked: true`
- Создается новая сессия (token rotation)

---

## Stores & Staff

### Store
Магазин (верхний уровень multi-tenancy).

```prisma
model Store {
  id        String   @id @default(uuid())
  name      String
  ownerId   String   // User ID владельца
  createdBy String   // Admin User ID, кто создал
  createdAt DateTime @default(now())
  
  creator       User                @relation(fields: [createdBy], references: [id])
  warehouse     Warehouse[]
  staff         Staff[]
  customers     Customer[]          @relation("CustomerStores")
  orders        Order[]
  categories    CategoriesOnStore[]
  brands        BrandsOnStore[]
  attributes    AttributeOnStore[]
  cashboxes     Cashbox[]
  customerDebts CustomerDebt[]
}
```

**Связи**:
- Один Store → много Warehouse
- Один Store → много Staff
- Один Store ↔ много Customer (M2M через "CustomerStores")

---

### Customer
Клиент магазина.

```prisma
model Customer {
  id            String         @id @default(uuid())
  userId        String         @unique
  createdAt     DateTime       @default(now())
  
  user          User           @relation(fields: [userId], references: [id])
  stores        Store[]        @relation("CustomerStores")  // M2M
  orders        Order[]        @relation("CustomerOrders")
  customerDebts CustomerDebt[]
}
```

**Логика**:
- Один Customer может быть связан с несколькими магазинами
- CustomerDebt привязывается к конкретному магазину (storeId)

---

### Staff
Сотрудник магазина.

```prisma
model Staff {
  id        String    @id @default(uuid())
  userId    String    @unique
  storeId   String
  role      StaffRole  // OWNER | SELLER | MANAGER | CASHIER | WAREHOUSE
  isActive  Boolean   @default(true)
  createdAt DateTime  @default(now())
  
  store            Store              @relation(fields: [storeId], references: [id])
  user             User               @relation(fields: [userId], references: [id])
  warehouse        StaffOnWarehouse[] // M2M со складами
  
  // Связи с операциями
  returnPayments   ReturnPayment[]
  orders           Order[]
  payments         Payment[]
  stockMoves       StockMovement[]
  cashboxes        Cashbox[]
  cashTransactions CashTransaction[]
  debtPayments     DebtPayment[]
}
```

**Индексы**: `@@index([storeId])`

**Enums**:
- `StaffRole`: OWNER, SELLER, MANAGER, CASHIER, WAREHOUSE

**Логика**:
- Один Staff привязан к ОДНОМУ магазину
- Может иметь доступ к НЕСКОЛЬКИМ складам (через `StaffOnWarehouse`)

---

### StaffOnWarehouse
M2M связь между сотрудниками и складами.

```prisma
model StaffOnWarehouse {
  staffId     String
  warehouseId String
  
  staff       Staff     @relation(fields: [staffId], references: [id])
  warehouse   Warehouse @relation(fields: [warehouseId], references: [id])
  
  @@id([staffId, warehouseId])
}
```

**Логика**: Сотрудник может работать только на складах, к которым у него есть доступ.

---

## Warehouses

### Warehouse
Склад (физическое место хранения товаров).

```prisma
model Warehouse {
  id             String             @id @default(uuid())
  storeId        String
  name           String
  isActive       Boolean            @default(true)
  createdAt      DateTime           @default(now())
  
  store          Store              @relation(fields: [storeId], references: [id])
  inventory      Inventory[]
  orders         Order[]
  staffs         StaffOnWarehouse[]
  stockMovements StockMovement[]
  products       Product[]
  cashboxes      Cashbox[]
}
```

**Индексы**: `@@index([storeId])`

**Логика**:
- Один склад принадлежит одному магазину
- Товары (Product) создаются на конкретном складе
- Заказы (Order) создаются в контексте склада

---

## Products & Variants

### Brand
Бренд (общий справочник).

```prisma
model Brand {
  id       String          @id @default(uuid())
  name     String          @unique
  
  stores   BrandsOnStore[]  // M2M: магазины, использующие этот бренд
  products Product[]
}
```

**Уникальность**: `name` уникален глобально

---

### Product
Логический товар (например, "Футболка Nike").

```prisma
model Product {
  id          String   @id @default(uuid())
  warehouseId String
  storeId     String   // Денормализация для быстрого доступа
  name        String
  categoryId  String?
  brandId     String?
  description String?
  isArchived  Boolean  @default(false)
  createdAt   DateTime @default(now())
  
  warehouse  Warehouse          @relation(fields: [warehouseId], references: [id])
  category   Category?          @relation(fields: [categoryId], references: [id])
  brand      Brand?             @relation(fields: [brandId], references: [id])
  
  images     ProductImage[]
  variants   ProductVariant[]
  attributes ProductAttribute[]
  tags       ProductTagValue[]
}
```

**Индексы**:
- `@@index([warehouseId])`
- `@@index([categoryId])`
- `@@index([brandId])`

**Логика**:
- `storeId` берется из `warehouse.storeId` при создании
- `isArchived = true` → скрыт из списков (soft delete)

---

### ProductVariant
Конкретный SKU (например, "Футболка Nike M Красная").

```prisma
model ProductVariant {
  id             String                  @id @default(uuid())
  productId      String
  sku            String  // Уникален в пределах магазина
  barCode        String? // Уникален глобально
  price          Decimal
  storeId        String  // Денормализация для быстрого поиска SKU
  warehouseId    String  // Денормализация для быстрого доступа к складу
  createdAt      DateTime                @default(now())
  
  product        Product                 @relation(fields: [productId], references: [id])
  inventory      Inventory[]
  orderItems     OrderItem[]
  stockMovements StockMovement[]
  attributes     VariantAttributeValue[]
  
  @@unique([storeId, sku])
  @@unique([barCode])
  @@index([productId])
}
```

**Уникальность**:
- `[storeId, sku]` — SKU уникален в рамках магазина
- `barCode` — уникален глобально

**Логика**:
- `sku` генерируется автоматически: `buildSku(productName, category, attributes)`
- `barCode` генерируется через `BarcodeSequence` (автоинкремент с 200000000000)
- `storeId` и `warehouseId` берутся из `product`

---

### ProductImage
Изображения товара.

```prisma
model ProductImage {
  id        String  @id @default(uuid())
  productId String
  url       String  // S3 URL
  isMain    Boolean @default(false)
  order     Int     @default(0)
  
  product   Product @relation(fields: [productId], references: [id])
  
  @@index([productId, isMain])
}
```

**Логика**:
- Первая картинка помечается `isMain: true`

---

### BarcodeSequence
Счетчик для генерации уникальных баркодов.

```prisma
model BarcodeSequence {
  id        Int      @id @default(1)
  nextCode  BigInt   @default(200000000000)
  updatedAt DateTime @updatedAt
}
```

**Логика**:
- Инициализируется с `200000000000`
- При каждом создании варианта инкрементируется
- Используется `BarcodeService.generateUniqueBarcode()`

---

## Inventory

### Inventory
Остатки товара на складе.

```prisma
model Inventory {
  id          String         @id @default(uuid())
  warehouseId String
  variantId   String
  quantity    Int
  
  variant     ProductVariant @relation(fields: [variantId], references: [id])
  warehouse   Warehouse      @relation(fields: [warehouseId], references: [id])
  
  @@unique([warehouseId, variantId])
}
```

**Уникальность**: `[warehouseId, variantId]` — один вариант может быть только на одном складе

**Логика**:
- Создается при создании варианта (`createProductVariant`)
- Обновляется при:
  - Приходе товара (IN, PURCHASE)
  - Продаже (OUT, SALE)
  - Возврате (IN, RETURN)
  - Корректировке (IN/OUT, ADJUSTMENT)

---

### StockMovement
Аудит всех изменений инвентаря.

```prisma
model StockMovement {
  id          String              @id @default(uuid())
  variantId   String
  warehouseId String
  type        StockMovementType    // IN | OUT
  reason      StockMovementReason  // PURCHASE | SALE | ADJUSTMENT | RETURN
  quantity    Int
  unitCost    Decimal?             // Себестоимость (только для IN)
  createdById String
  createdAt   DateTime            @default(now())
  
  variant     ProductVariant      @relation(fields: [variantId], references: [id])
  warehouse   Warehouse           @relation(fields: [warehouseId], references: [id])
  createdBy   Staff               @relation(fields: [createdById], references: [id])
  
  @@index([warehouseId, createdAt])
  @@index([variantId, createdAt])
}
```

**Enums**:
- `StockMovementType`: IN, OUT
- `StockMovementReason`: PURCHASE (приход), SALE (продажа), ADJUSTMENT (корректировка), RETURN (возврат от клиента)

**Индексы**:
- По складу + дате (для отчетов по складу)
- По варианту + дате (для истории движений товара)

---

## Orders & Sales

### Order
Заказ клиента.

```prisma
model Order {
  id          String       @id @default(uuid())
  storeId     String
  warehouseId String
  cashierId   String       // Staff ID
  customerId  String?
  channel     OrderChannel  // POS | ONLINE
  status      OrderStatus   // CREATED | HOLD | DEBT | COMPLETED | CANCELLED | REFUNDED
  totalAmount Decimal
  paidAmount  Decimal      @default(0)
  createdAt   DateTime     @default(now())
  
  // Возврат
  isReturned     Boolean             @default(false)
  returnedAt     DateTime?
  returnedAmount Decimal             @default(0)
  returns        ReturnedOrder?
  
  // Relationships
  store            Store             @relation(fields: [storeId], references: [id])
  warehouse        Warehouse         @relation(fields: [warehouseId], references: [id])
  cashier          Staff             @relation("StaffOrders", fields: [cashierId], references: [id])
  customer         Customer?         @relation("CustomerOrders", fields: [customerId], references: [id])
  
  items            OrderItem[]
  payments         Payment[]
  services         AdditionalService[]
  cashTransactions CashTransaction[]
  
  @@index([storeId, createdAt])
  @@index([warehouseId, createdAt])
}
```

**Enums**:
- `OrderChannel`: POS, ONLINE
- `OrderStatus`: CREATED, HOLD, DEBT, COMPLETED, CANCELLED, REFUNDED

**Индексы**:
- По магазину + дате (для отчетов по магазину)
- По складу + дате (для отчетов по складу)

**Жизненный цикл**:
```
CREATED → HOLD → [DEBT | COMPLETED] → [REFUNDED | CANCELLED]
```

**Поля возврата**:
- `isReturned`: флаг, что заказ возвращен
- `returnedAt`: дата возврата
- `returnedAmount`: сумма возвращенных товаров

---

### OrderItem
Позиция заказа.

```prisma
model OrderItem {
  id          String         @id @default(uuid())
  orderId     String
  variantId   String
  quantity    Int
  retailPrice Decimal        // Розничная цена на момент продажи
  sale        Decimal        @default(0)  // Скидка на момент продажи
  costAtSale  Decimal        // Себестоимость на момент продажи
  createdAt   DateTime       @default(now())
  
  order       Order          @relation(fields: [orderId], references: [id])
  variant     ProductVariant @relation(fields: [variantId], references: [id])
  returnItems ReturnItem?
  
  @@index([orderId])
  @@index([variantId])
}
```

**Логика**:
- `retailPrice` — может отличаться от текущей цены в каталоге (фиксируется на момент продажи)
- `sale` — скидка (итоговая цена = retailPrice - sale)
- `costAtSale` — себестоимость (для расчета прибыли)

**Итоговая сумма позиции**: `(retailPrice - sale) * quantity`

---

### AdditionalService
Дополнительные услуги к заказу.

```prisma
model AdditionalService {
  id          String   @id @default(uuid())
  orderId     String
  name        String
  price       Decimal
  description String?
  createdAt   DateTime @default(now())
  
  order       Order    @relation(fields: [orderId], references: [id])
  
  @@index([orderId])
}
```

**Примеры**: Доставка, нарезка, упаковка, гравировка

**Логика**:
- Включаются в `Order.totalAmount`
- НЕ возвращаются при возврате товара

---

## Returns

### ReturnedOrder
Возврат товара.

```prisma
model ReturnedOrder {
  id          String            @id @default(uuid())
  orderId     String            @unique
  createdAt   DateTime          @default(now())
  createdBy   String            // Staff ID
  status      ReturnOrderStatus  // DEBT | CREDIT | COMPLETED
  totalAmount Decimal           @default(0)
  
  order       Order             @relation(fields: [orderId], references: [id])
  items       ReturnItem[]
  payments    ReturnPayment[]
}
```

**Enums**:
- `ReturnOrderStatus`: DEBT (клиент все еще должен), CREDIT (магазин должен клиенту), COMPLETED (расчет завершен)

**Связь**: один заказ может иметь максимум один возврат (`orderId @unique`)

---

### ReturnItem
Возвращаемая позиция.

```prisma
model ReturnItem {
  id        String        @id @default(uuid())
  returnId  String
  itemId    String        @unique  // ID OrderItem
  quantity  Int
  createdAt DateTime      @default(now())
  
  orderItem OrderItem     @relation(fields: [itemId], references: [id])
  return    ReturnedOrder @relation(fields: [returnId], references: [id])
}
```

**Ограничение**: `itemId @unique` — одна позиция заказа может быть возвращена только один раз

---

### ReturnPayment
Возврат денег клиенту.

```prisma
model ReturnPayment {
  id            String        @id @default(uuid())
  returnOrderId String
  amount        Decimal
  type          PaymentType    // CASH | CARD | ONLINE | TRANSFER
  createdAt     DateTime      @default(now())
  createdBy     String        // Staff ID
  
  cashier       Staff         @relation("ReturnPayments", fields: [createdBy], references: [id])
  return        ReturnedOrder @relation(fields: [returnOrderId], references: [id])
}
```

**Логика**: сколько денег вернул кассир клиенту (может быть меньше, чем стоимость возврата → CREDIT)

---

## Payments

### Payment
Платеж по заказу.

```prisma
model Payment {
  id        String      @id @default(uuid())
  orderId   String
  type      PaymentType  // CASH | CARD | ONLINE | TRANSFER
  amount    Decimal
  paidAt    DateTime?
  createdAt DateTime    @default(now())
  createdBy String      // Staff ID
  
  cashier   Staff       @relation("StaffPayments", fields: [createdBy], references: [id])
  order     Order       @relation(fields: [orderId], references: [id])
  
  @@index([orderId])
}
```

**Enums**:
- `PaymentType`: CASH, CARD, ONLINE, TRANSFER

**Логика**:
- Создается при оплате заказа (`POST /order/:id/pay`)
- Одновременно создается `CashTransaction` для кассы

---

## Cashbox

### Cashbox
Касса продавца.

```prisma
model Cashbox {
  id          String     @id @default(uuid())
  sellerId    String     // Staff ID
  storeId     String
  warehouseId String
  status      CashStatus  // OPEN | CLOSED
  balance     Decimal    @default(0)
  createdAt   DateTime   @default(now())
  
  seller Staff @relation(fields: [sellerId], references: [id])
  store  Store @relation(fields: [storeId], references: [id])
  warehouse Warehouse @relation(fields: [warehouseId], references: [id])
  
  transactions CashTransaction[]
  
  @@index([storeId, createdAt])
  @@index([warehouseId, createdAt])
}
```

**Enums**:
- `CashStatus`: OPEN, CLOSED

**Логика**:
- Один продавец на одном складе может иметь только одну открытую кассу
- `balance` обновляется при каждой транзакции
- После закрытия (`CLOSED`) нельзя добавлять транзакции

---

### CashTransaction
Денежная транзакция в кассе.

```prisma
model CashTransaction {
  id          String                  @id @default(uuid())
  cashboxId   String
  createdById String                  // Staff ID
  type        CashTransactionType     // INCOME | EXPENSE
  category    CashTransactionCategory // SALE | DEBT_PAYMENT | RENT | DELIVERY | SALARY | PURCHASE | RETURN | OTHER
  paymentType PaymentType             // CASH | CARD | ONLINE | TRANSFER
  amount      Decimal
  comment     String?
  
  // Связи
  orderId String?    // Если это платеж по заказу
  debtId  String?    // Если это оплата CustomerDebt
  
  createdAt DateTime @default(now())
  
  cashbox   Cashbox      @relation(fields: [cashboxId], references: [id])
  createdBy Staff        @relation(fields: [createdById], references: [id])
  order     Order?       @relation(fields: [orderId], references: [id])
  debt      DebtPayment? @relation(fields: [debtId], references: [id])
}
```

**Enums**:
- `CashTransactionType`: INCOME (приход), EXPENSE (расход)
- `CashTransactionCategory`: SALE, DEBT_PAYMENT, RENT, DELIVERY, SALARY, PURCHASE, RETURN, OTHER

**Логика**:

**Автоматические транзакции** (создаются системой):
- **Оплата заказа**: `POST /order/:id/pay`
  - Создается: INCOME, SALE, orderId
  - Cashbox.balance увеличивается
- **Возврат товара**: `POST /order/return/:id`
  - Создается: EXPENSE, RETURN, orderId
  - Cashbox.balance уменьшается
- **Оплата старого долга**: `POST /debt/payment`
  - Создается: INCOME, DEBT_PAYMENT, debtId
  - Cashbox.balance увеличивается

**Ручные транзакции** (создает кассир через UI):
- **Неопознанный платеж**: `POST /cashbox/:id/transaction`
  - Кто-то принес деньги, кассир не знает назначение
  - Создается: INCOME, OTHER, comment: "Уточнить назначение"
  - Планируется потом связать с заказом/долгом
- **Возврат клиенту (кредит)**: 
  - Магазин должен клиенту, выдача денег из кассы
  - Создается: EXPENSE, RETURN, orderId (опционально)
- **Личные расходы**: 
  - Купил попить, поесть из кассы
  - Создается: EXPENSE, OTHER, comment: "Купил воду"
- **Зарплата**: 
  - Выдача зарплаты работникам
  - Создается: EXPENSE, SALARY, comment: "Зарплата Петрову"
- **Аренда**: 
  - Оплата аренды помещения
  - Создается: EXPENSE, RENT
- **Доставка**: 
  - Оплата доставки
  - Создается: EXPENSE, DELIVERY
- **Закупка**: 
  - Закупка товара у поставщика наличными
  - Создается: EXPENSE, PURCHASE
  - **Важно**: НЕ создает inventory автоматически!
- **Прочие**: 
  - Любые другие расходы/доходы
  - Создается: INCOME/EXPENSE, OTHER

**Планируемая доработка**:
- Связывание неопознанных платежей (orderId/debtId = null) с конкретными назначениями
- Улучшенная отчетность по категориям

---

## Debts

### CustomerDebt
Старые долги (не связанные с заказами в системе).

```prisma
model CustomerDebt {
  id          String     @id @default(uuid())
  storeId     String
  customerId  String
  description String?
  totalAmount Decimal
  paidAmount  Decimal    @default(0)
  status      DebtStatus  // ACTIVE | PAID
  createdAt   DateTime   @default(now())
  returnedAt  DateTime?   // Дата возникновения долга (можно указать прошлую)
  
  customer Customer      @relation(fields: [customerId], references: [id])
  store    Store         @relation(fields: [storeId], references: [id])
  payments DebtPayment[]
  
  @@index([storeId, createdAt])
  @@index([customerId, createdAt])
  @@index([status])
}
```

**Enums**:
- `DebtStatus`: ACTIVE, PAID

**Логика**:
- Создается вручную (`POST /debt`)
- Используется для переноса старых долгов при миграции на систему

---

### DebtPayment
Платеж по старому долгу.

```prisma
model DebtPayment {
  id        String      @id @default(uuid())
  debtId    String
  amount    Decimal
  type      PaymentType  // CASH | CARD | ONLINE | TRANSFER
  createdBy String      // Staff ID
  createdAt DateTime    @default(now())
  
  debt    CustomerDebt @relation(fields: [debtId], references: [id])
  cashier Staff        @relation(fields: [createdBy], references: [id])
  
  cashTransactions CashTransaction[]
}
```

**Логика**:
- Создается при оплате долга (`POST /debt/payment`)
- Одновременно создается `CashTransaction` (INCOME, DEBT_PAYMENT)

---

## Catalog

### Category
Категория товаров (древовидная структура).

```prisma
model Category {
  id       String              @id @default(uuid())
  name     String              @unique
  parentId String?
  
  parent   Category?           @relation("CategoryTree", fields: [parentId], references: [id])
  children Category[]          @relation("CategoryTree")
  
  store    CategoriesOnStore[]
  products Product[]
  
  @@index([parentId])
}
```

**Логика**:
- Поддерживает вложенность (parent → children)
- Связывается с магазинами через M2M (`CategoriesOnStore`)

---

### Attribute
Атрибут (фильтр) товара.

```prisma
model Attribute {
  id      String             @id @default(uuid())
  name    String             @unique
  type    AttributeType       // STRING | NUMBER | BOOLEAN
  
  values  AttributeValue[]
  store   AttributeOnStore[]
  product ProductAttribute[]
}
```

**Enums**:
- `AttributeType`: STRING, NUMBER, BOOLEAN

**Примеры**: Размер (STRING), Вес (NUMBER), Водонепроницаемость (BOOLEAN)

---

### AttributeValue
Значение атрибута.

```prisma
model AttributeValue {
  id          String                  @id @default(uuid())
  attributeId String
  valueString String?
  valueNumber Decimal?
  valueBool   Boolean?
  
  attribute   Attribute               @relation(fields: [attributeId], references: [id])
  variant     VariantAttributeValue[]
  
  @@unique([attributeId, valueString, valueNumber, valueBool])
}
```

**Логика**:
- Только одно из полей `valueString`, `valueNumber`, `valueBool` заполнено
- Уникальность по комбинации всех значений

---

### Tag & TagValue
Теги товаров (например, "Материал: Хлопок").

```prisma
model Tag {
  id     String     @id @default(uuid())
  name   String     @unique
  values TagValue[]
}

model TagValue {
  id      String            @id @default(uuid())
  tagId   String
  value   String
  
  tag     Tag               @relation(fields: [tagId], references: [id])
  product ProductTagValue[]
  
  @@unique([tagId, value])
}
```

**Логика**:
- Один Tag (например, "Материал") может иметь много TagValue ("Хлопок", "Полиэстер")
- Связь с товаром через `ProductTagValue`

---

### M2M таблицы для каталога

```prisma
// Связь Product ↔ Attribute
model ProductAttribute {
  productId   String
  attributeId String
  
  attribute   Attribute @relation(fields: [attributeId], references: [id])
  product     Product   @relation(fields: [productId], references: [id])
  
  @@id([productId, attributeId])
}

// Связь ProductVariant ↔ AttributeValue
model VariantAttributeValue {
  variantId        String
  attributeValueId String
  
  value            AttributeValue @relation(fields: [attributeValueId], references: [id])
  variant          ProductVariant @relation(fields: [variantId], references: [id])
  
  @@id([variantId, attributeValueId])
}

// Связь Store ↔ Category
model CategoriesOnStore {
  storeId    String
  categoryId String
  
  category   Category @relation(fields: [categoryId], references: [id])
  store      Store    @relation(fields: [storeId], references: [id])
  
  @@id([storeId, categoryId])
}

// Связь Store ↔ Brand
model BrandsOnStore {
  storeId String
  brandId String
  
  brand   Brand  @relation(fields: [brandId], references: [id])
  store   Store  @relation(fields: [storeId], references: [id])
  
  @@id([storeId, brandId])
}

// Связь Store ↔ Attribute
model AttributeOnStore {
  storeId     String
  attributeId String
  
  attribute   Attribute @relation(fields: [attributeId], references: [id])
  store       Store     @relation(fields: [storeId], references: [id])
  
  @@id([storeId, attributeId])
}

// Связь Product ↔ TagValue
model ProductTagValue {
  productId  String
  tagValueId String
  
  product    Product  @relation(fields: [productId], references: [id])
  value      TagValue @relation(fields: [tagValueId], references: [id])
  
  @@id([productId, tagValueId])
}
```

---

## Enums

### UserRole
```prisma
enum UserRole {
  ADMIN   // Супер-администратор системы
  OWNER   // Владелец магазина
  USER    // Обычный пользователь (Customer)
}
```

### UserType
```prisma
enum UserType {
  CUSTOMER  // Клиент
  STAFF     // Сотрудник
}
```

### StaffRole
```prisma
enum StaffRole {
  OWNER      // Владелец (полный доступ + сотрудники + отчеты)
  SELLER     // Продавец (в планах)
  MANAGER    // Менеджер (полный доступ без сотрудников/отчетов)
  CASHIER    // Кассир (в планах)
  WAREHOUSE  // Складской работник (в планах)
}
```

### StockMovementType
```prisma
enum StockMovementType {
  IN   // Приход товара
  OUT  // Расход товара
}
```

### StockMovementReason
```prisma
enum StockMovementReason {
  PURCHASE    // Закупка
  SALE        // Продажа
  ADJUSTMENT  // Корректировка (инвентаризация)
  RETURN      // Возврат от клиента
}
```

### OrderStatus
```prisma
enum OrderStatus {
  CREATED    // Заказ создан, товары не добавлены
  HOLD       // Товары добавлены, готов к оплате
  DEBT       // Частичная оплата
  COMPLETED  // Полностью оплачен
  CANCELLED  // Отменен
  REFUNDED   // Возвращен
}
```

### ReturnOrderStatus
```prisma
enum ReturnOrderStatus {
  DEBT      // Клиент все еще должен
  CREDIT    // Магазин должен клиенту
  COMPLETED // Расчет завершен
}
```

### PaymentType
```prisma
enum PaymentType {
  CASH     // Наличные
  CARD     // Карта
  ONLINE   // Онлайн-платеж
  TRANSFER // Перевод
}
```

### OrderChannel
```prisma
enum OrderChannel {
  POS    // Через POS терминал
  ONLINE // Через сайт/приложение
}
```

### CashStatus
```prisma
enum CashStatus {
  OPEN   // Касса открыта
  CLOSED // Касса закрыта
}
```

### CashTransactionType
```prisma
enum CashTransactionType {
  INCOME  // Приход денег
  EXPENSE // Расход денег
}
```

### CashTransactionCategory
```prisma
enum CashTransactionCategory {
  SALE         // Продажа товара
  DEBT_PAYMENT // Оплата старого долга
  RENT         // Аренда
  DELIVERY     // Доставка
  SALARY       // Зарплата
  PURCHASE     // Закупка товара
  RETURN       // Возврат денег клиенту
  OTHER        // Прочее
}
```

### DebtStatus
```prisma
enum DebtStatus {
  ACTIVE // Активный долг
  PAID   // Погашен
}
```

### AttributeType
```prisma
enum AttributeType {
  STRING  // Строка (например, "M", "L", "XL")
  NUMBER  // Число (например, вес 1.5 кг)
  BOOLEAN // Булево (например, водонепроницаемость)
}
```

---

## Индексы и ограничения

### Уникальные ограничения
```sql
-- User
UNIQUE (phone)

-- AuthAccount
UNIQUE (userId), UNIQUE (login)

-- ProductVariant
UNIQUE ([storeId, sku])  -- SKU уникален в рамках магазина
UNIQUE (barCode)         -- Barcode уникален глобально

-- Inventory
UNIQUE ([warehouseId, variantId])  -- Один вариант на одном складе

-- ReturnedOrder
UNIQUE (orderId)  -- Один возврат на заказ

-- ReturnItem
UNIQUE (itemId)   -- Одна позиция возвращается один раз

-- Brand, Category, Attribute, Tag
UNIQUE (name)     -- Уникальные названия

-- AttributeValue
UNIQUE ([attributeId, valueString, valueNumber, valueBool])

-- TagValue
UNIQUE ([tagId, value])
```

### Индексы для производительности
```sql
-- RefreshSession
INDEX (userId)

-- Staff
INDEX (storeId)

-- Warehouse
INDEX (storeId)

-- Product
INDEX (warehouseId)
INDEX (categoryId)
INDEX (brandId)

-- ProductVariant
INDEX (productId)

-- ProductImage
INDEX (productId, isMain)

-- StockMovement
INDEX (warehouseId, createdAt)
INDEX (variantId, createdAt)

-- Order
INDEX (storeId, createdAt)
INDEX (warehouseId, createdAt)

-- OrderItem
INDEX (orderId)
INDEX (variantId)

-- AdditionalService
INDEX (orderId)

-- Payment
INDEX (orderId)

-- Cashbox
INDEX (storeId, createdAt)
INDEX (warehouseId, createdAt)

-- CustomerDebt
INDEX (storeId, createdAt)
INDEX (customerId, createdAt)
INDEX (status)

-- Category
INDEX (parentId)
```

---

## Полезные SQL запросы

### Выручка за день
```sql
SELECT SUM(amount) as revenue
FROM cash_transactions
WHERE type = 'INCOME'
  AND category = 'SALE'
  AND DATE(created_at) = CURRENT_DATE
  AND cashbox_id IN (
    SELECT id FROM cashboxes WHERE store_id = :storeId
  );
```

### Топ продаваемых товаров
```sql
SELECT 
  p.name,
  SUM(oi.quantity) as total_sold,
  SUM((oi.retail_price - oi.sale) * oi.quantity) as revenue
FROM order_items oi
JOIN product_variants pv ON oi.variant_id = pv.id
JOIN products p ON pv.product_id = p.id
WHERE pv.store_id = :storeId
  AND oi.order_id IN (
    SELECT id FROM orders WHERE status IN ('COMPLETED', 'DEBT')
  )
GROUP BY p.id, p.name
ORDER BY total_sold DESC
LIMIT 10;
```

### Остатки по складу
```sql
SELECT 
  p.name,
  pv.sku,
  pv.bar_code,
  i.quantity,
  pv.price
FROM inventories i
JOIN product_variants pv ON i.variant_id = pv.id
JOIN products p ON pv.product_id = p.id
WHERE i.warehouse_id = :warehouseId
  AND i.quantity > 0
ORDER BY i.quantity ASC;
```

### История движений товара
```sql
SELECT 
  sm.created_at,
  sm.type,
  sm.reason,
  sm.quantity,
  sm.unit_cost,
  s.user_id,
  u.full_name as staff_name
FROM stock_movements sm
JOIN staff s ON sm.created_by_id = s.id
JOIN users u ON s.user_id = u.id
WHERE sm.variant_id = :variantId
ORDER BY sm.created_at DESC;
```

---

**Последнее обновление**: 2026-08-15  
**Версия схемы**: Prisma 6 / PostgreSQL 17
