# 🚀 План Реализации Системы Аренды

## 📌 Содержание

1. [Общий план](#общий-план)
2. [Phase 1: Database Schema](#phase-1-database-schema)
3. [Phase 2: Core Services](#phase-2-core-services)
4. [Phase 3: Order Integration](#phase-3-order-integration)
5. [Phase 4: Rental Operations](#phase-4-rental-operations)
6. [Phase 5: Controllers & Endpoints](#phase-5-controllers--endpoints)
7. [Phase 6: Validations & Error Handling](#phase-6-validations--error-handling)
8. [Phase 7: Testing](#phase-7-testing)
9. [Файлы для создания](#файлы-для-создания)
10. [Temporary Database Migration](#temporary-database-migration)

---

## 📊 Общий план

```
┌─────────────────────────────────────────────────────────┐
│            TIMELINE: ~4-5 недель (FullStack)            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Week 1: Database + Core Services                      │
│  ├─ Миграция Prisma (новые таблицы)                    │
│  ├─ RentalService + RentalRateService                  │
│  ├─ ReservationService + InventoryService              │
│  └─ Valuation functions (цены, доступность)            │
│                                                         │
│  Week 2: Order Integration                            │
│  ├─ Модификация OrderService.create()                 │
│  ├─ Обработка itemType = RENT                         │
│  ├─ Создание Rental + StockMovement                   │
│  └─ Валидация и тесты                                 │
│                                                         │
│  Week 3: Return & Deposit Logic                       │
│  ├─ ReturnRentalService (основная логика возврата)   │
│  ├─ Обработка ущерба, залога, ранний возврат         │
│  ├─ CashTransaction + Payment                         │
│  └─ Tests                                              │
│                                                         │
│  Week 4: Extension & Reservation                      │
│  ├─ ExtendRentalService                               │
│  ├─ ReservationController                             │
│  ├─ Checking availability                             │
│  └─ Tests                                              │
│                                                         │
│  Week 5: Controllers, DTOs, Documentation             │
│  ├─ RentalController                                  │
│  ├─ RentalTariffController                            │
│  ├─ All DTOs & Validators                             │
│  ├─ API Documentation                                 │
│  └─ Final testing                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 🔷 Phase 1: Database Schema

### 1.1 Создать Prisma Migration

**Файл**: `prisma/migrations/[timestamp]_add_rental_system/migration.sql`

**Действия**:

1. ✅ Создать таблицы:
   - `rental_rates`
   - `rentals`
   - `rental_deposits`
   - `reservations`
   - `inventory_items` (опционально)

2. ✅ Модифицировать таблицы:
   - `product_variants` → добавить `can_sell`, `can_rent`
   - `order_items` → добавить `item_type`, `rental_id`, `allow_early_return_refund`, `early_return_refund_type`, `early_return_refund_amount`
   - `stock_movements` → расширить enum REASON
   - `cash_transactions` → расширить enum CATEGORY

3. ✅ Добавить индексы:
   - RentalRate: (productVariantId, minDays, maxDays)
   - Rental: (orderItemId, status, dueDate)
   - Reservation: (productVariantId, rentalStartDate, rentalEndDate, status)
   - InventoryItem: (variantId, status, serialNumber)

4. ✅ Добавить constraints:
   - Rental.rentalPrice > 0
   - RentalRate.minDays <= maxDays (если maxDays не null)
   - Reservation.rentalStartDate < rentalEndDate

---

### 1.2 Обновить Prisma Schema

**Файл**: `prisma/schema.prisma`

```prisma
// Новые ENUMS
enum OrderItemType {
  SALE
  RENT
}

enum DepositStatus {
  HELD
  RETURNED
  FORFEITED
}

enum DepositType {
  CASH
  GOLD
  DOCUMENT
  OTHER
}

enum ReservationStatus {
  PENDING
  CONFIRMED
  CONVERTED_TO_RENTAL
  CANCELLED
}

enum RentalStatus {
  ACTIVE
  RETURNED
  LATE
  DAMAGED
  LOST
  PURCHASED
}

enum InventoryItemStatus {
  AVAILABLE
  RENTED
  SOLD
  DAMAGED
  LOST
}

enum EarlyReturnRefundType {
  FULL
  CUSTOM
  NONE
}

// Новые модели
model RentalRate { ... }
model Rental { ... }
model RentalDeposit { ... }
model Reservation { ... }
model InventoryItem { ... }

// Модифицированные модели
model ProductVariant { ... }  // + canSell, canRent, rentalRates
model OrderItem { ... }       // + itemType, rentalId, allowEarlyReturnRefund
model StockMovement { ... }   // + новые REASON
model CashTransaction { ... } // + новые CATEGORY
```

---

### 1.3 Запустить миграцию

```bash
cd billing
npx prisma migrate dev --name add_rental_system
npx prisma generate  # Генерируется в generated/prisma
```

---

## 🔷 Phase 2: Core Services

### 2.1 RentalService

**Файл**: `src/rental/rental.service.ts`

**Основные методы**:

```typescript
export class RentalService {
  
  // ✅ Проверка доступности товара на период
  async getAvailableQuantity(
    variantId: string,
    startDate: DateTime,
    endDate: DateTime
  ): Promise<number>
  
  // ✅ Расчет цены по тарифам
  async calculateRentalPrice(
    variantId: string,
    startDate: DateTime,
    endDate: DateTime
  ): Promise<Decimal>
  
  // ✅ Получить все пересекающиеся аренды
  async getOverlappingRentals(
    variantId: string,
    startDate: DateTime,
    endDate: DateTime
  ): Promise<Rental[]>
  
  // ✅ Валидация дат аренды
  validateRentalDates(startDate: DateTime, endDate: DateTime): void
  
  // ✅ Создать Rental (внутренний метод, вызывается из OrderService)
  async createRental(
    orderItemId: string,
    startDate: DateTime,
    endDate: DateTime,
    rentalPrice: Decimal
  ): Promise<Rental>
  
  // ✅ Обновить статус Rental
  async updateRentalStatus(
    rentalId: string,
    status: RentalStatus,
    data?: Partial<Rental>
  ): Promise<Rental>
}
```

---

### 2.2 RentalRateService

**Файл**: `src/rental/rental-rate.service.ts`

**Основные методы**:

```typescript
export class RentalRateService {
  
  // ✅ Получить тариф для варианта и количества дней
  async getTariffForDays(
    variantId: string,
    days: number
  ): Promise<RentalRate>
  
  // ✅ Получить все тарифы для варианта
  async getTariffsByVariant(variantId: string): Promise<RentalRate[]>
  
  // ✅ Создать новый тариф
  async createTariff(data: CreateRentalRateDto): Promise<RentalRate>
  
  // ✅ Обновить тариф
  async updateTariff(id: string, data: UpdateRentalRateDto): Promise<RentalRate>
  
  // ✅ Удалить тариф
  async deleteTariff(id: string): Promise<void>
  
  // ✅ Валидация тарифов (не должно быть перекрытий)
  async validateTariffs(variantId: string): Promise<ValidationResult>
}
```

---

### 2.3 ReservationService

**Файл**: `src/rental/reservation.service.ts`

**Основные методы**:

```typescript
export class ReservationService {
  
  // ✅ Создать бронирование
  async createReservation(data: CreateReservationDto): Promise<Reservation>
  
  // ✅ Подтвердить бронирование
  async confirmReservation(id: string): Promise<Reservation>
  
  // ✅ Отменить бронирование
  async cancelReservation(id: string): Promise<Reservation>
  
  // ✅ Преобразовать бронирование в аренду
  async convertToRental(
    reservationId: string,
    rentalId: string
  ): Promise<Reservation>
  
  // ✅ Получить все активные бронирования на дату
  async getReservationsForPeriod(
    variantId: string,
    startDate: DateTime,
    endDate: DateTime
  ): Promise<Reservation[]>
  
  // ✅ Очистить истекшие бронирования (Job)
  async cleanExpiredReservations(): Promise<number>
}
```

---

### 2.4 ReturnRentalService

**Файл**: `src/rental/return-rental.service.ts`

**Основные методы**:

```typescript
export class ReturnRentalService {
  
  // ✅ Обработка возврата товара
  async processReturn(
    rentalId: string,
    dto: ReturnRentalDto
  ): Promise<{
    rental: Rental,
    refundAmount: Decimal,
    earlyReturnRefund: Decimal | null,
    depositRefund: Decimal | null,
    damageFee: Decimal | null
  }>
  
  // ✅ Расчет возврата за неиспользованные дни
  async calculateEarlyReturnRefund(
    rental: Rental,
    refundType: EarlyReturnRefundType,
    customRefund?: Decimal
  ): Promise<Decimal>
  
  // ✅ Расчет возврата залога
  async calculateDepositRefund(
    rental: Rental,
    damageFee: Decimal
  ): Promise<Decimal>
  
  // ✅ Создать StockMovement для возврата
  async createReturnStockMovement(
    rental: Rental,
    reason: StockMovementReason  // RENT_RETURN или WRITE_OFF
  ): Promise<StockMovement>
}
```

---

### 2.5 ExtendRentalService

**Файл**: `src/rental/extend-rental.service.ts`

**Основные методы**:

```typescript
export class ExtendRentalService {
  
  // ✅ Проверить возможность продления
  async canExtend(
    rentalId: string,
    newDueDate: DateTime
  ): Promise<{
    canExtend: boolean,
    reason?: string
  }>
  
  // ✅ Обработка продления
  async processExtension(
    rentalId: string,
    dto: ExtendRentalDto
  ): Promise<{
    rental: Rental,
    additionalFee: Decimal
  }>
  
  // ✅ Расчет доп стоимости
  async calculateExtensionFee(
    variantId: string,
    currentDueDate: DateTime,
    newDueDate: DateTime
  ): Promise<Decimal>
}
```

---

### 2.6 InventoryService (опционально, если используется InventoryItem)

**Файл**: `src/rental/inventory.service.ts`

**Основные методы**:

```typescript
export class InventoryService {
  
  // ✅ Получить доступный InventoryItem для аренды
  async getAvailableItem(
    variantId: string,
    startDate: DateTime,
    endDate: DateTime
  ): Promise<InventoryItem | null>
  
  // ✅ Обновить статус InventoryItem
  async updateItemStatus(
    itemId: string,
    status: InventoryItemStatus
  ): Promise<InventoryItem>
  
  // ✅ Получить историю аренд для товара
  async getItemHistory(itemId: string): Promise<Rental[]>
}
```

---

## 🔷 Phase 3: Order Integration

### 3.1 Модифицировать OrderService

**Файл**: `src/order/order.service.ts`

**Изменения в методе `create()`**:

```typescript
async create(dto: CreateOrderDto): Promise<Order> {
  
  return await this.prisma.$transaction(async (tx) => {
    
    // 1. Валидация (как раньше)
    // ...
    
    // 2. Для каждого item:
    for (const itemDto of dto.items) {
      
      // Проверяем тип операции
      if (itemDto.itemType === OrderItemType.SALE) {
        // ✅ SALE логика (существующая)
        await this.handleSaleItem(itemDto, tx);
        
      } else if (itemDto.itemType === OrderItemType.RENT) {
        // ✅ RENT логика (НОВАЯ)
        await this.handleRentItem(itemDto, tx);
      }
    }
    
    // 3. Расчет totalAmount (обе позиции)
    const totalAmount = await this.calculateTotalAmount(dto.items, tx);
    
    // 4. Создание Order
    const order = await tx.order.create({
      data: {
        storeId: dto.storeId,
        warehouseId: dto.warehouseId,
        cashierId: dto.staffId,
        customerId: dto.customerId,
        channel: dto.channel,
        status: OrderStatus.HOLD,
        totalAmount: totalAmount,
        paidAmount: 0
      }
    });
    
    return order;
  });
}

// ✅ НОВЫЙ метод для обработки RENT items
private async handleRentItem(
  itemDto: CreateOrderItemDto,
  tx: PrismaTransaction
): Promise<OrderItem> {
  
  // 1. Валидация
  const variant = await tx.productVariant.findUnique({
    where: { id: itemDto.variantId }
  });
  
  if (!variant.canRent) {
    throw new BadRequestException('This product cannot be rented');
  }
  
  // 2. Проверка доступности
  const available = await this.rentalService.getAvailableQuantity(
    itemDto.variantId,
    itemDto.rentalStartDate,
    itemDto.rentalEndDate
  );
  
  if (available < itemDto.quantity) {
    throw new BadRequestException('Not enough items available for rental');
  }
  
  // 3. Расчет цены
  const rentalPrice = await this.rentalRateService.getTariffForDays(
    itemDto.variantId,
    daysBetween(itemDto.rentalStartDate, itemDto.rentalEndDate)
  );
  
  const unitPrice = rentalPrice.pricePerDay
    .mul(daysBetween(itemDto.rentalStartDate, itemDto.rentalEndDate));
  
  // 4. Создание OrderItem
  const orderItem = await tx.orderItem.create({
    data: {
      orderId: order.id,
      variantId: itemDto.variantId,
      quantity: itemDto.quantity,
      retailPrice: unitPrice,
      sale: 0,
      costAtSale: variant.costAtSale,
      itemType: OrderItemType.RENT,
      allowEarlyReturnRefund: itemDto.allowEarlyReturnRefund,
      earlyReturnRefundType: itemDto.earlyReturnRefundType
    }
  });
  
  // 5. Создание Rental
  const rental = await tx.rental.create({
    data: {
      orderItemId: orderItem.id,
      startDate: itemDto.rentalStartDate,
      dueDate: itemDto.rentalEndDate,
      status: RentalStatus.ACTIVE,
      rentalPrice: unitPrice
    }
  });
  
  // 6. Создание StockMovement
  await tx.stockMovement.create({
    data: {
      variantId: itemDto.variantId,
      warehouseId: order.warehouseId,
      type: StockMovementType.OUT,
      reason: StockMovementReason.RENT,  // ← НОВОЕ
      quantity: itemDto.quantity,
      unitCost: variant.costAtSale,
      createdById: order.cashierId
    }
  });
  
  // 7. Обновление Inventory
  await tx.inventory.updateMany({
    where: {
      variantId: itemDto.variantId,
      warehouseId: order.warehouseId
    },
    data: {
      quantity: { decrement: itemDto.quantity }
    }
  });
  
  return orderItem;
}
```

---

### 3.2 Модифицировать PaymentService

**Файл**: `src/payment/payment.service.ts`

**Новый метод для обработки депозита**:

```typescript
async processRentalDeposit(
  rentalId: string,
  dto: RentalDepositDto,
  tx: PrismaTransaction
): Promise<RentalDeposit> {
  
  const rental = await tx.rental.findUnique({
    where: { id: rentalId }
  });
  
  const deposit = await tx.rentalDeposit.create({
    data: {
      rentalId: rentalId,
      amount: dto.depositAmount,
      type: dto.depositType,
      description: dto.depositDescription,
      status: DepositStatus.HELD,
      paidAt: now()
    }
  });
  
  // Обновить Rental с информацией о депозите
  await tx.rental.update({
    where: { id: rentalId },
    data: {
      depositAmount: dto.depositAmount,
      depositStatus: DepositStatus.HELD
    }
  });
  
  return deposit;
}
```

---

## 🔷 Phase 4: Rental Operations

### 4.1 Создать RentalController

**Файл**: `src/rental/rental.controller.ts`

**Endpoints**:

```typescript
@Controller('rental')
export class RentalController {
  
  // ✅ POST /rental - создать аренду (из заказа) — INTERNAL
  @Post()
  async create(@Body() dto: CreateRentalDto) { }
  
  // ✅ GET /rental/:id - получить детали аренды
  @Get(':id')
  async getOne(@Param('id') id: string) { }
  
  // ✅ GET /rental - список аренд с фильтрами
  @Get()
  async getList(@Query() filter: RentalFilterDto) { }
  
  // ✅ POST /rental/:id/return - вернуть товар
  @Post(':id/return')
  async returnRental(
    @Param('id') id: string,
    @Body() dto: ReturnRentalDto
  ) { }
  
  // ✅ POST /rental/:id/extend - продлить аренду
  @Post(':id/extend')
  async extendRental(
    @Param('id') id: string,
    @Body() dto: ExtendRentalDto
  ) { }
  
  // ✅ GET /rental/availability - проверить доступность
  @Get('availability/check')
  async checkAvailability(
    @Query() dto: CheckAvailabilityDto
  ) { }
  
  // ✅ PATCH /rental/:id/status - обновить статус (ADMIN/OWNER)
  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'OWNER')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRentalStatusDto
  ) { }
}
```

---

### 4.2 Создать RentalTariffController

**Файл**: `src/rental/rental-tariff.controller.ts`

**Endpoints** (Admin only):

```typescript
@Controller('product/:variantId/rental-tariff')
export class RentalTariffController {
  
  // ✅ POST - создать тариф
  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'OWNER')
  async create(
    @Param('variantId') variantId: string,
    @Body() dto: CreateRentalRateDto
  ) { }
  
  // ✅ GET - список тарифов для варианта
  @Get()
  async getByVariant(@Param('variantId') variantId: string) { }
  
  // ✅ PATCH - обновить тариф
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'OWNER')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRentalRateDto
  ) { }
  
  // ✅ DELETE - удалить тариф
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'OWNER')
  async delete(@Param('id') id: string) { }
}
```

---

### 4.3 Создать ReservationController

**Файл**: `src/rental/reservation.controller.ts`

**Endpoints**:

```typescript
@Controller('rental/reservation')
export class ReservationController {
  
  // ✅ POST - создать бронирование
  @Post()
  async create(@Body() dto: CreateReservationDto) { }
  
  // ✅ GET - список бронирований
  @Get()
  async getList(@Query() filter: ReservationFilterDto) { }
  
  // ✅ PATCH/:id/confirm - подтвердить
  @Patch(':id/confirm')
  async confirm(@Param('id') id: string) { }
  
  // ✅ PATCH/:id/cancel - отменить
  @Patch(':id/cancel')
  async cancel(@Param('id') id: string) { }
}
```

---

## 🔷 Phase 5: Controllers & Endpoints

### 5.1 Создать DTOs

**Папка**: `src/rental/dto/`

**Файлы**:
- `create-rental.dto.ts`
- `return-rental.dto.ts`
- `extend-rental.dto.ts`
- `create-rental-rate.dto.ts`
- `update-rental-rate.dto.ts`
- `create-reservation.dto.ts`
- `check-availability.dto.ts`
- `rental-filter.dto.ts`
- `rental-deposit.dto.ts`

**Пример**: `create-rental-rate.dto.ts`

```typescript
import { IsNumber, Min, Max, IsOptional } from 'class-validator';

export class CreateRentalRateDto {
  @IsNumber()
  @Min(1)
  minDays: number;
  
  @IsNumber()
  @Min(1)
  @IsOptional()
  maxDays?: number;
  
  @IsNumber()
  @Min(0)
  pricePerDay: Decimal;
}
```

---

### 5.2 Добавить Validators

**Файл**: `src/rental/validators/`

- `IsValidRentalDates.ts` — проверка startDate < dueDate
- `HasAvailableItems.ts` — проверка getAvailableQuantity
- `CanExtend.ts` — проверка возможности продления
- `NoOverlappingTariffs.ts` — проверка перекрытий тарифов

---

## 🔷 Phase 6: Validations & Error Handling

### 6.1 Создать Custom Exceptions

**Файл**: `src/rental/exceptions/`

```typescript
export class RentalNotAvailableException extends BadRequestException {
  constructor(availableQuantity: number) {
    super(`Rental items not available. Available: ${availableQuantity}`);
  }
}

export class RentalCannotBeExtendedException extends BadRequestException {
  constructor(reason: string) {
    super(`Cannot extend rental: ${reason}`);
  }
}

export class InvalidEarlyReturnException extends BadRequestException { }
export class DepositNotHeldException extends BadRequestException { }
export class RentalAlreadyReturnedException extends BadRequestException { }
```

---

### 6.2 Добавить Guards

**Файл**: `src/rental/guards/`

- `RentalOwnerGuard.ts` — проверка, что это аренда юзера
- `CanReturnGuard.ts` — проверка, что можно вернуть
- `CanExtendGuard.ts` — проверка, что можно продлить

---

## 🔷 Phase 7: Testing

### 7.1 Unit Tests

**Папка**: `src/rental/__tests__/`

- `rental.service.spec.ts`
- `rental-rate.service.spec.ts`
- `return-rental.service.spec.ts`
- `extend-rental.service.spec.ts`
- `reservation.service.spec.ts`

---

### 7.2 Integration Tests

**Файл**: `test/rental.e2e-spec.ts`

```typescript
describe('Rental E2E', () => {
  
  it('should create order with RENT item', async () => { })
  it('should fail if no available items', async () => { })
  it('should calculate rental price correctly', async () => { })
  it('should process return and refund deposit', async () => { })
  it('should handle early return with refund', async () => { })
  it('should extend rental successfully', async () => { })
  it('should create and convert reservation', async () => { })
  it('should handle damaged return with fee', async () => { })
})
```

---

## 🔷 Файлы для создания

### Структура папок

```
src/rental/
├── rental.module.ts
├── rental.controller.ts
├── rental.service.ts
├── rental-rate.service.ts
├── return-rental.service.ts
├── extend-rental.service.ts
├── reservation.service.ts
├── inventory.service.ts (опционально)
│
├── dto/
│   ├── create-rental.dto.ts
│   ├── return-rental.dto.ts
│   ├── extend-rental.dto.ts
│   ├── rental-filter.dto.ts
│   ├── create-rental-rate.dto.ts
│   ├── update-rental-rate.dto.ts
│   ├── create-reservation.dto.ts
│   ├── check-availability.dto.ts
│   └── rental-deposit.dto.ts
│
├── controllers/
│   ├── rental.controller.ts
│   ├── rental-tariff.controller.ts
│   └── reservation.controller.ts
│
├── validators/
│   ├── IsValidRentalDates.ts
│   ├── HasAvailableItems.ts
│   ├── CanExtend.ts
│   └── NoOverlappingTariffs.ts
│
├── guards/
│   ├── rental-owner.guard.ts
│   ├── can-return.guard.ts
│   └── can-extend.guard.ts
│
├── exceptions/
│   └── rental.exceptions.ts
│
├── interfaces/
│   ├── rental.interface.ts
│   ├── rental-rate.interface.ts
│   └── reservation.interface.ts
│
├── helpers/
│   ├── rental-calculations.ts
│   ├── availability-checker.ts
│   └── tariff-resolver.ts
│
└── __tests__/
    ├── rental.service.spec.ts
    ├── rental-rate.service.spec.ts
    ├── return-rental.service.spec.ts
    └── extend-rental.service.spec.ts

prisma/
├── schema.prisma (MODIFIED)
└── migrations/
    └── [timestamp]_add_rental_system/
        └── migration.sql

docs/rental/
├── 01_RENTAL_ARCHITECTURE.md ✅
├── 02_RENTAL_BUSINESS_LOGIC.md ✅
├── 03_RENTAL_IMPLEMENTATION_PLAN.md ✅
├── 04_RENTAL_DB_SCHEMA.md (нужен)
└── 05_RENTAL_API_SPECS.md (нужен)
```

---

## 🔷 Temporary Database Migration

### SQL Template для миграции

```sql
-- =====================================================
-- НОВЫЕ ENUMS
-- =====================================================

CREATE TYPE "OrderItemType" AS ENUM ('SALE', 'RENT');
CREATE TYPE "RentalStatus" AS ENUM ('ACTIVE', 'RETURNED', 'LATE', 'DAMAGED', 'LOST', 'PURCHASED');
CREATE TYPE "DepositStatus" AS ENUM ('HELD', 'RETURNED', 'FORFEITED');
CREATE TYPE "DepositType" AS ENUM ('CASH', 'GOLD', 'DOCUMENT', 'OTHER');
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CONVERTED_TO_RENTAL', 'CANCELLED');
CREATE TYPE "InventoryItemStatus" AS ENUM ('AVAILABLE', 'RENTED', 'SOLD', 'DAMAGED', 'LOST');
CREATE TYPE "EarlyReturnRefundType" AS ENUM ('FULL', 'CUSTOM', 'NONE');

-- =====================================================
-- НОВЫЕ ТАБЛИЦЫ
-- =====================================================

-- Тарифы аренды
CREATE TABLE "rental_rates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productVariantId" TEXT NOT NULL,
  "minDays" INTEGER NOT NULL,
  "maxDays" INTEGER,
  "pricePerDay" DECIMAL NOT NULL,
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE CASCADE,
  CONSTRAINT "rental_rates_days_check" CHECK ("minDays" >= 1 AND ("maxDays" IS NULL OR "maxDays" >= "minDays"))
);

-- Аренды
CREATE TABLE "rentals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderItemId" TEXT NOT NULL UNIQUE,
  "startDate" TIMESTAMP NOT NULL,
  "dueDate" TIMESTAMP NOT NULL,
  "returnedAt" TIMESTAMP,
  "status" "RentalStatus" NOT NULL DEFAULT 'ACTIVE',
  "rentalPrice" DECIMAL NOT NULL,
  "depositAmount" DECIMAL,
  "depositStatus" "DepositStatus",
  "depositReturnedAt" TIMESTAMP,
  "damageFee" DECIMAL,
  "damageDescription" TEXT,
  "damagePhotoUrl" TEXT,
  "earlyReturnRefund" DECIMAL,
  "notes" TEXT,
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE
);

-- Залоги
CREATE TABLE "rental_deposits" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "rentalId" TEXT NOT NULL UNIQUE,
  "amount" DECIMAL NOT NULL,
  "type" "DepositType" NOT NULL,
  "description" TEXT,
  "paidAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "returnedAt" TIMESTAMP,
  "status" "DepositStatus" NOT NULL DEFAULT 'HELD',
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("rentalId") REFERENCES "rentals"("id") ON DELETE CASCADE
);

-- Бронирования
CREATE TABLE "reservations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productVariantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "rentalStartDate" TIMESTAMP NOT NULL,
  "rentalEndDate" TIMESTAMP NOT NULL,
  "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
  "convertedToRentalId" TEXT,
  "notes" TEXT,
  "expiresAt" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id"),
  FOREIGN KEY ("customerId") REFERENCES "customers"("id"),
  FOREIGN KEY ("storeId") REFERENCES "stores"("id")
);

-- Поштучный учет товаров (опционально)
CREATE TABLE "inventory_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "variantId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "sku" TEXT,
  "serialNumber" TEXT UNIQUE,
  "status" "InventoryItemStatus" NOT NULL DEFAULT 'AVAILABLE',
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("variantId") REFERENCES "product_variants"("id"),
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id")
);

-- =====================================================
-- ИЗМЕНЕНИЯ В СУЩЕСТВУЮЩИХ ТАБЛИЦАХ
-- =====================================================

-- ProductVariant
ALTER TABLE "product_variants" ADD COLUMN "canSell" BOOLEAN DEFAULT true;
ALTER TABLE "product_variants" ADD COLUMN "canRent" BOOLEAN DEFAULT false;

-- OrderItem
ALTER TABLE "order_items" ADD COLUMN "itemType" "OrderItemType" DEFAULT 'SALE';
ALTER TABLE "order_items" ADD COLUMN "rentalId" TEXT UNIQUE;
ALTER TABLE "order_items" ADD COLUMN "allowEarlyReturnRefund" BOOLEAN DEFAULT false;
ALTER TABLE "order_items" ADD COLUMN "earlyReturnRefundType" "EarlyReturnRefundType";
ALTER TABLE "order_items" ADD COLUMN "earlyReturnRefundAmount" DECIMAL;
ALTER TABLE "order_items" ADD FOREIGN KEY ("rentalId") REFERENCES "rentals"("id");

-- StockMovement (добавить новые REASON)
-- (Зависит от текущей реализации enum)

-- CashTransaction (добавить новые CATEGORY)
-- (Зависит от текущей реализации enum)

-- =====================================================
-- ИНДЕКСЫ
-- =====================================================

CREATE INDEX "idx_rental_rates_variant" ON "rental_rates"("productVariantId");
CREATE INDEX "idx_rental_rates_days" ON "rental_rates"("minDays", "maxDays");
CREATE INDEX "idx_rentals_orderitem" ON "rentals"("orderItemId");
CREATE INDEX "idx_rentals_status_duedate" ON "rentals"("status", "dueDate");
CREATE INDEX "idx_reservations_variant_dates" ON "reservations"("productVariantId", "rentalStartDate", "rentalEndDate");
CREATE INDEX "idx_reservations_status" ON "reservations"("status");
CREATE INDEX "idx_inventory_items_variant" ON "inventory_items"("variantId");
CREATE INDEX "idx_inventory_items_status" ON "inventory_items"("status");
```

---

## 📝 Резюме Plan

**Общее время**: ~4-5 недель  
**Точек интеграции**: 5 основных (OrderService, PaymentService, Cashbox, Inventory, StockMovement)  
**Критических компонентов**: 8 (Services + Controllers + Validators + Exceptions)  
**Тестовых сценариев**: 15+  
**Новых Endpoints**: 12+  

**Успешность зависит от**:
✅ Правильной валидации доступности товара  
✅ Транзакционности всех операций  
✅ Правильного расчета цен и возвратов  
✅ Полного тестирования edge cases  

