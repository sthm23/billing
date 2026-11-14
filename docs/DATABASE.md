# Database Schema — Детальная схема базы данных

## Содержание
1. [Обзор](#обзор)
2. [Auth & Users](#auth--users)
3. [Stores & Staff](#stores--staff)
4. [Warehouses](#warehouses)
5. [Products & Variants](#products--variants)
6. [Inventory](#inventory)
7. [Orders & Sales](#orders--sales)
8. [Rentals](#rentals)
9. [Returns](#returns)
10. [Payments](#payments)
11. [Cashbox](#cashbox)
12. [Debts](#debts)
13. [Catalog (Categories, Brands, Attributes)](#catalog)
14. [Enums](#enums)
15. [Индексы и ограничения](#индексы-и-ограничения)

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
- `isActive = false` → пользователь не может войти, обновить токен и вызвать API (401 на каждом запросе; с 2026-11-09 проверяется в `POST /login`, `GET /refresh` и JWT-стратегии — `billing/src/auth/account-status.ts`). То же для `Staff.isActive = false`.

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
  
  salesEnabled  Boolean @default(true)  // магазин продаёт товары
  rentalEnabled Boolean @default(false) // магазин сдаёт товары в аренду
  
  // Подписка: TRIAL (первый месяц бесплатно) → ACTIVE (оплачен) → SUSPENDED (приостановлен админом)
  status         StoreStatus         @default(TRIAL)
  trialEndsAt    DateTime?           // конец пробного периода (createdAt + 1 месяц)
  paidUntil      DateTime?           // «Оплачено до» — вводит админ при возобновлении
  suspendedAt    DateTime?
  suspendedById  String?             // User ID админа, приостановившего магазин (без FK)
  suspendReason  StoreSuspendReason?
  suspendComment String?
  
  // Данные заявки (вводит админ)
  address String?
  inn     String?                    // ИНН, ровно 9 цифр
  note    String?
  
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

**Режимы магазина** (миграция `20261105120000_rental_schema`):
- `salesEnabled` — продажи (заказы, оплаты, возвраты продаж); при `false` продажа отклоняется
- `rentalEnabled` — модуль аренды; при `false` все `/rental` эндпоинты отвечают 400 `RENTAL_DISABLED`
- Хотя бы один флаг всегда `true` (проверяется в `PUT /store/:id` и `PATCH /admin/stores/:id`)

**Статус подписки** (миграция `20261110120000_store_subscription`; существующие магазины получили `ACTIVE`):
- `status` (`StoreStatus`): `TRIAL` — новый магазин из `POST /admin/stores`, `trialEndsAt = now + 1 месяц`; `ACTIVE` — оплачен (`paidUntil` вводит админ); `SUSPENDED` — приостановлен админом (`POST /admin/stores/:id/suspend`: `suspendedAt`, `suspendedById`, `suspendReason`, `suspendComment`)
- По окончании пробного периода автоматической приостановки нет — список админа показывает «пробный истёк» (`trialExpired`)
- Возобновление (`POST /admin/stores/:id/resume`) очищает поля приостановки; с `paidUntil` → `ACTIVE`, без — `TRIAL`, пока пробный не истёк, иначе `ACTIVE`
- При `SUSPENDED` любой JWT-запрос пользователя магазина (кроме `GET /auth/me`) → 403 `STORE_SUSPENDED` (`SubscriptionGuard`)
- `address`, `inn`, `note` — данные заявки, заполняются при создании магазина админом
- Правила: `docs/features/stores-warehouses.md`

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
  deactivatedAt      DateTime?                // когда владелец деактивировал; null после восстановления
  deactivatedById    String?                  // User.id того, кто деактивировал (без FK)
  deactivationReason StaffDeactivationReason? // LEFT | TEMPORARY | OTHER
  
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
- `StaffDeactivationReason`: LEFT (увольнение), TEMPORARY, OTHER

**Логика**:
- Один Staff привязан к ОДНОМУ магазину
- Может иметь доступ к НЕСКОЛЬКИМ складам (через `StaffOnWarehouse`)
- Деактивация (`POST /store/staff/:id/deactivate`, миграция `20261109120000_staff_deactivation`): `isActive = false` + `deactivatedAt` / `deactivatedById` / `deactivationReason`, `AuthAccount.isActive = false`, все `RefreshSession` отозваны — одной транзакцией. Восстановление (`…/activate`) очищает эти поля. Продажи, заказы и история кассы сотрудника не трогаются. `DELETE /users/:id` (web) тоже деактивирует, но поля причины/даты не заполняет.

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

**Логика**: Сотрудник может работать только на складах, к которым у него есть доступ. `staffId` — это `Staff.id`, **не** `User.id` (при создании склада `POST /warehouse` бэкенд сам находит Staff владельца магазина). Владелец магазина работает со всеми складами независимо от этих строк.

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

При создании магазина админом (`POST /admin/stores`, `brandNames`) бренд ищется по имени без учёта регистра или создаётся — новый бренд доступен и другим магазинам.

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
  price          Decimal // Цена продажи
  canSell        Boolean  @default(true)  // Можно продавать
  canRent        Boolean  @default(false) // Можно сдавать в аренду
  rentPricePerDay Decimal? // Цена аренды за день (обязательна > 0 при canRent)
  defaultCleaningDays Int @default(1) // Дней химчистки по умолчанию при возврате из аренды (0…30)
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
- `canSell = false` — вариант нельзя добавить/оплатить в обычном заказе
- `canRent = true` требует `rentPricePerDay > 0`; подробнее — [docs/features/rental.md](../../docs/features/rental.md)

---

### ProductImage
Изображения товара.

```prisma
model ProductImage {
  id        String  @id @default(uuid())
  productId String
  key       String  // ключ объекта в хранилище: products/<storeId>/<file>
  isMain    Boolean @default(false)
  order     Int     @default(0)
  
  product   Product @relation(fields: [productId], references: [id])
  
  @@index([productId, isMain])
}
```

**Логика**:
- Первая картинка помечается `isMain: true`, `order` = позиция в `images` запроса `POST /product`
- Хранится **ключ**, не URL (2026-11-13, миграция `20261113150000_product_image_key`: колонка `url` → `key`, все старые строки с AWS-URL удалены). Публичный URL строит backend: `S3_PUBLIC_URL/<key>`; API по-прежнему отдаёт `images: [{ id, isMain, url }]`
- Файлы лежат в Uztelecom Object Storage (S3-совместимое); правила загрузки — [docs/security.md → File Uploads and S3](../../docs/security.md#file-uploads-and-s3)

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
- Для арендуемого варианта `quantity` = сколько единиц принадлежит салону. Аренда **не меняет** Inventory и не создаёт StockMovement; занятость по датам считается из `Rental` (см. [Rentals](#rentals))

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
  soldAt      DateTime?    // момент продажи (COMPLETED/DEBT), ставится один раз
  createdAt   DateTime     @default(now())
  
  // Возврат
  isReturned     Boolean             @default(false)
  returnedAt     DateTime?
  returnedAmount Decimal             @default(0)
  returns        ReturnedOrder?
  
  rental         Rental?            // заказ-аренда (1:1, опционально)
  
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
  @@index([storeId, soldAt])
}
```

**Enums**:
- `OrderChannel`: POS, ONLINE
- `OrderStatus`: CREATED, HOLD, DEBT, COMPLETED, CANCELLED, REFUNDED

**Индексы**:
- По магазину + дате (для отчетов по магазину)
- По складу + дате (для отчетов по складу)
- По магазину + `soldAt` (сводка продаж `GET /orders/summary`)

**`soldAt`**: ставится в `POST /orders/payment/:id`, когда заказ становится COMPLETED или DEBT; последующая оплата долга его не меняет. Нужен, потому что продажа полностью в долг не имеет Payment. Миграция `20261021120000_sales_summaries` заполнила COMPLETED/DEBT/REFUNDED: `createdAt` первого платежа, иначе `createdAt` заказа.

**Жизненный цикл**:
```
CREATED → HOLD → [DEBT | COMPLETED] → [REFUNDED | CANCELLED]
```

**Поля возврата**:
- `isReturned`: флаг, что заказ возвращен
- `returnedAt`: дата возврата
- `returnedAmount`: сумма возвращенных товаров

**Заказ-аренда**: если у заказа есть `rental`, он ведётся только через `/rental` эндпоинты (sale flow его отклоняет). Деньги аренды (позиции, услуги, платежи, `paidAmount`) хранятся в Order; `soldAt` ставится при выдаче.

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
  rentalReturnItems RentalReturnItem[] // возвраты из аренды
  
  @@index([orderId])
  @@index([variantId])
}
```

**Логика**:
- `retailPrice` — может отличаться от текущей цены в каталоге (фиксируется на момент продажи)
- `sale` — скидка (итоговая цена = retailPrice - sale)
- `costAtSale` — себестоимость (для расчета прибыли); у позиций заказа-аренды `costAtSale = 0`

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
  sale        Decimal  @default(0) // Скидка на услугу, sale <= price
  description String?
  createdAt   DateTime @default(now())
  
  order       Order    @relation(fields: [orderId], references: [id])
  
  @@index([orderId])
}
```

**Примеры**: Доставка, нарезка, упаковка, гравировка

**Логика**:
- Включаются в `Order.totalAmount` как `price - sale`
- НЕ возвращаются при возврате товара

---

## Rentals

Аренда (свадебный салон). Деньги живут в Order (позиции, услуги, платежи); `Rental` хранит даты и физическое состояние арендованных вещей. Аренда никогда не меняет Inventory. Полные правила — [docs/features/rental.md](../../docs/features/rental.md).

### Rental
Бронь/аренда, 1:1 с Order.

```prisma
model Rental {
  id          String @id @default(uuid())
  orderId     String @unique
  storeId     String
  warehouseId String
  customerId  String

  startDate   DateTime // плановая дата выдачи
  endDate     DateTime // плановая дата возврата
  plannedDays Int      // дней, на которые посчитана цена

  status   RentalStatus @default(BOOKED)
  issuedAt DateTime?
  issuedBy String?      // staffId
  issuedWithoutCollateral Boolean @default(false) // выдано без залога (нет невозвращённых залогов при выдаче)
  closedAt DateTime?    // все вещи возвращены

  cancelledAt  DateTime?
  cancelledBy  String?  // staffId
  refundAmount Decimal? // возвращённая при отмене предоплата
  cancelReason String?

  notes     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  order       Order              @relation(fields: [orderId], references: [id])
  collaterals RentalCollateral[]
  returns     RentalReturn[]

  @@index([storeId, startDate])
  @@index([warehouseId, status])
  @@map("rentals")
}
```

**Уникальность**: `orderId` — один Rental на заказ

**Жизненный цикл**:
```
BOOKED → ISSUED → [PARTIALLY_RETURNED] → RETURNED
BOOKED → CANCELLED
```

---

### RentalCollateral
Неденежный залог (паспорт, золото). **Никогда не проходит через кассу.**

```prisma
model RentalCollateral {
  id          String         @id @default(uuid())
  rentalId    String
  type        CollateralType // PASSPORT | GOLD | OTHER
  description String
  receivedAt  DateTime       @default(now())
  receivedBy  String         // staffId
  returnedAt  DateTime?
  returnedBy  String?        // staffId

  rental Rental @relation(fields: [rentalId], references: [id])

  @@index([rentalId])
  @@map("rental_collaterals")
}
```

---

### RentalReturn
Одно событие возврата (полного или частичного).

```prisma
model RentalReturn {
  id                String   @id @default(uuid())
  rentalId          String
  returnedAt        DateTime // фактическое время возврата
  penaltyAmount     Decimal  @default(0) // порча / просрочка, вводит продавец
  penaltyComment    String?  // обязателен при penaltyAmount > 0
  earlyReturnRefund Decimal  @default(0) // уменьшение суммы при раннем возврате, только OWNER/MANAGER
  createdBy         String   // staffId
  createdAt         DateTime @default(now())

  rental Rental             @relation(fields: [rentalId], references: [id])
  items  RentalReturnItem[]

  @@index([rentalId])
  @@map("rental_returns")
}
```

---

### RentalReturnItem
Возвращённые единицы позиции заказа.

```prisma
model RentalReturnItem {
  id            String   @id @default(uuid())
  returnId      String
  orderItemId   String
  quantity      Int
  cleaningDays  Int      @default(0) // 0 = без химчистки
  availableFrom DateTime // returnedAt + cleaningDays: с этого момента единица снова свободна

  return    RentalReturn @relation(fields: [returnId], references: [id])
  orderItem OrderItem    @relation(fields: [orderItemId], references: [id])

  @@index([returnId])
  @@index([orderItemId])
  @@map("rental_return_items")
}
```

---

### RentalCleaning
Химчистка, запланированная владельцем/менеджером вне возврата (R13, миграция `20261107120000_rental_cleaning`). Занимает **одну** единицу варианта на `[startDate, endDate)` так же, как бронь; Inventory не меняет.

```prisma
model RentalCleaning {
  id          String               @id @default(uuid())
  storeId     String
  warehouseId String
  variantId   String
  startDate   DateTime // 12:00 первого дня химчистки
  endDate     DateTime // 12:00 после последнего дня: единица снова свободна
  days        Int
  amount      Decimal
  paymentType PaymentType
  comment     String?
  status      RentalCleaningStatus @default(ACTIVE) // ACTIVE | CANCELLED

  expenseTransactionId String  @unique // CashTransaction EXPENSE/DRY_CLEANING
  refundTransactionId  String? @unique // CashTransaction INCOME/DRY_CLEANING при отмене

  createdBy   String // staffId
  createdAt   DateTime  @default(now())
  cancelledBy String? // staffId
  cancelledAt DateTime?

  warehouse          Warehouse        @relation(...)
  variant            ProductVariant   @relation(...)
  expenseTransaction CashTransaction  @relation("RentalCleaningExpense", ...)
  refundTransaction  CashTransaction? @relation("RentalCleaningRefund", ...)

  @@index([warehouseId, variantId, endDate])
  @@index([storeId, startDate])
  @@map("rental_cleanings")
}
```
Состояние для UI (`PLANNED` / `IN_PROGRESS` / `DONE`) вычисляется из дат; хранится только `ACTIVE`/`CANCELLED`. В `CashTransactionCategory` добавлена `DRY_CLEANING`.

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
- Создается при оплате заказа (`POST /orders/payment/:id`)
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
  closedAt    DateTime?  // ставится в PATCH /cashbox/:id/close
  
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
- `balance` обновляется при каждой транзакции — все способы оплаты (CASH, CARD, ONLINE, TRANSFER)
- После закрытия (`CLOSED`) нельзя добавлять транзакции
- `closedAt` — время закрытия; `null` у открытых и у касс, закрытых до миграции `20261021120000_sales_summaries`

---

### CashTransaction
Денежная транзакция в кассе.

```prisma
model CashTransaction {
  id          String                  @id @default(uuid())
  cashboxId   String
  createdById String                  // Staff ID
  type        CashTransactionType     // INCOME | EXPENSE
  category    CashTransactionCategory // SALE | DEBT_PAYMENT | RENT | DELIVERY | SALARY | PURCHASE | RETURN | OTHER | RENTAL | DRY_CLEANING
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
- `CashTransactionCategory`: SALE, DEBT_PAYMENT, RENT, DELIVERY, SALARY, PURCHASE, RETURN, OTHER, RENTAL, DRY_CLEANING (`RENT` — расход на помещение, `RENTAL` — доход от аренды товаров, `DRY_CLEANING` — запланированная химчистка вне возврата: EXPENSE, при отмене INCOME)

**Логика**:

**Автоматические транзакции** (создаются системой):
- **Оплата заказа**: `POST /orders/payment/:id`
  - Создается: INCOME, SALE, orderId
  - Cashbox.balance увеличивается
- **Возврат товара**: `POST /orders/return`
  - Создается: EXPENSE, RETURN, orderId
  - Cashbox.balance уменьшается
- **Оплата старого долга**: `POST /debt/payment`
  - Создается: INCOME, DEBT_PAYMENT, debtId
  - Cashbox.balance увеличивается
- **Оплата аренды** (предоплата/доплата): `POST /rental/:id/payments`, `/rental/:id/issue`, `/rental/:id/returns`
  - Создается: Payment + INCOME, RENTAL, orderId
  - Cashbox.balance увеличивается
- **Выплата по аренде** (переплата при раннем возврате, возврат предоплаты при отмене)
  - Создается: EXPENSE, RETURN, orderId
  - Cashbox.balance уменьшается
- Залог (паспорт, золото) в кассу не попадает

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
  - Создается: EXPENSE, RENT (не путать с RENTAL — доходом от аренды товаров)
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
  id          String              @id @default(uuid())
  name        String              // русское название, основное
  nameUz      String?
  nameEn      String?
  parentId    String?
  parent      Category?           @relation("CategoryTree", fields: [parentId], references: [id])
  children    Category[]          @relation("CategoryTree")
  createdById String?             // кто создал подкатегорию; null у системных (сид)
  createdBy   User?               @relation(fields: [createdById], references: [id], onDelete: SetNull)
  store       CategoriesOnStore[]
  products    Product[]

  @@unique([parentId, name])
  @@index([parentId])
}
```

**Логика**:
- **Ровно 2 уровня** (миграция `20261113120000_category_two_levels` выровняла старое 3–4-уровневое дерево): уровень 1 — направление магазина (`parentId = null`, системные из сида; выбирает админ при создании магазина, `POST /admin/stores` принимает только категорию без `parentId`), уровень 2 — подкатегории товаров. Глубина — правило, не ограничение схемы
- **Названия**: `name` — русский (основной), `nameUz` / `nameEn` — переводы (у системных заполнены сидом, у созданных пользователями могут быть null). Клиент показывает перевод на языке приложения, иначе `name`. Системный список — `prisma/seed/category.seed.ts` (`CATEGORY_TREE`)
- **Уникальность** — внутри родителя без учёта регистра, отдельно для `name`, `nameUz`, `nameEn`. Обеспечивается частичными индексами по выражению `lower(...)` (`categories_root_*_ci_key` для корней, `categories_child_*_ci_key` для подкатегорий), созданными SQL в миграции: в `schema.prisma` их не выразить, `prisma migrate diff` их не трогает
- Справочник общий для всех магазинов: подкатегории направления видят все магазины этого направления. План доработки (API, права, mobile) — `billing/docs/categories/PLAN.md`
- Связывается с магазинами через M2M (`CategoriesOnStore`)

---

### Attribute
Атрибут (фильтр) товара.

```prisma
model Attribute {
  id      String             @id @default(uuid())
  name    String             @unique
  type    AttributeType       // STRING | NUMBER | BOOLEAN
  unit    String?             // единица для NUMBER (м, кг, л): «Длина — 6 м»
  
  values  AttributeValue[]
  store   AttributeOnStore[]
  product ProductAttribute[]
}
```

**Enums**:
- `AttributeType`: STRING, NUMBER, BOOLEAN

**Примеры**: Размер (STRING), Вес (NUMBER), Водонепроницаемость (BOOLEAN)

**Логика**: атрибут — глобальная группа значений (`Attribute` → `AttributeValue`, например Материал → Хлопок / Шёлк), связывается с магазинами через `AttributeOnStore`. При создании магазина админом новый атрибут с уже существующим именем переиспользуется, только если совпадает тип (иначе 400). `unit` добавлен миграцией `20261110120000_store_subscription`.

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
  SELLER     // Продавец (свои заказы и касса; роль по умолчанию при создании сотрудника)
  MANAGER    // Менеджер (полный доступ без сотрудников/отчетов)
  CASHIER    // Кассир (права как у продавца)
  WAREHOUSE  // Складской работник (права как у продавца; отдельных проверок нет)
}
```

### StoreStatus
```prisma
enum StoreStatus {
  TRIAL      // Пробный период (первый месяц бесплатно)
  ACTIVE     // Оплачен
  SUSPENDED  // Приостановлен админом
}
```

### StoreSuspendReason
```prisma
enum StoreSuspendReason {
  UNPAID         // Не оплачен
  OWNER_REQUEST  // По просьбе владельца
  OTHER          // Другое
}
```

### StaffDeactivationReason
```prisma
enum StaffDeactivationReason {
  LEFT       // Увольнение
  TEMPORARY  // Временно
  OTHER      // Другое
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
  RENT         // Аренда помещения (EXPENSE)
  DELIVERY     // Доставка
  SALARY       // Зарплата
  PURCHASE     // Закупка товара
  RETURN       // Возврат денег клиенту
  OTHER        // Прочее
  RENTAL       // Доход от аренды товаров (INCOME)
  DRY_CLEANING // Химчистка вне возврата (EXPENSE; INCOME при отмене), R13
}
```

**Не путать**: `RENT` — расход на аренду помещения, `RENTAL` — доход заказа-аренды.

### RentalStatus
```prisma
enum RentalStatus {
  BOOKED             // Забронировано, вещи в салоне
  ISSUED             // Выдано клиенту
  PARTIALLY_RETURNED // Часть вещей вернули
  RETURNED           // Всё вернули
  CANCELLED          // Бронь отменена до выдачи
}
```

### RentalCleaningStatus
```prisma
enum RentalCleaningStatus {
  ACTIVE    // химчистка запланирована / идёт / прошла
  CANCELLED // отменена до начала, расход возвращён в кассу
}
```

### CollateralType
```prisma
enum CollateralType {
  PASSPORT // Паспорт
  GOLD     // Золото
  OTHER    // Прочее
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

-- Rental
UNIQUE (orderId)  -- Один Rental на заказ

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

-- Rental
INDEX (storeId, startDate)
INDEX (warehouseId, status)

-- RentalCollateral, RentalReturn
INDEX (rentalId)

-- RentalReturnItem
INDEX (returnId)
INDEX (orderItemId)

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

**Последнее обновление**: 2026-11-13  
**Версия схемы**: Prisma 6 / PostgreSQL 17
