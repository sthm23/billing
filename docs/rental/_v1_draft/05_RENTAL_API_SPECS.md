# 📡 API Specification: Rental System Endpoints

## 📌 Содержание

1. [Обзор API](#обзор-api)
2. [Authentication & Authorization](#authentication--authorization)
3. [Rental Management](#rental-management)
4. [Rental Tariffs](#rental-tariffs)
5. [Reservations](#reservations)
6. [Availability Check](#availability-check)
7. [Error Responses](#error-responses)

---

## 🎯 Обзор API

```
BASE_URL: /api/v1
Всё требует Authorization Bearer Token
Все цены в Decimal(15,2)
Все даты в ISO 8601 (UTC)
Все ID в формате UUID
```

---

## 🔐 Authentication & Authorization

### Требуемые роли

```
ADMIN          → все операции
OWNER          → операции в своих магазинах
STAFF (SELLER) → создание/возврат аренд в своих складах
STAFF (MANAGER) → управление тарифами
CUSTOMER       → создание бронирований, возврат своих аренд
```

---

## 🔷 Rental Management

### 1. Создать аренду (из заказа)

> ⚠️ **INTERNAL**: вызывается автоматически из `POST /order`

**Endpoint**: `POST /order`

**Что входит в DTO заказа**:

```typescript
POST /order
{
  storeId: string;
  warehouseId: string;
  staffId: string;
  customerId?: string;
  channel: "POS" | "ONLINE";
  
  items: [
    {
      variantId: string;
      quantity: number;
      itemType: "SALE" | "RENT";  // ← НОВОЕ
      
      // Если SALE
      retailPrice?: Decimal;
      sale?: Decimal;
      
      // Если RENT
      rentalStartDate: DateTime;
      rentalEndDate: DateTime;
      allowEarlyReturnRefund?: boolean;
      earlyReturnRefundType?: "FULL" | "CUSTOM" | "NONE";
    }
  ];
}

Response 201:
{
  id: string;
  status: "CREATED" | "HOLD";
  totalAmount: Decimal;
  items: OrderItem[];
}
```

---

### 2. Получить деталь аренды

**Endpoint**: `GET /rental/:rentalId`

**Authorization**: любой (может получить свою аренду)

**Response 200**:
```typescript
{
  id: string;
  orderItemId: string;
  
  startDate: DateTime;
  dueDate: DateTime;
  returnedAt?: DateTime;
  
  status: "ACTIVE" | "RETURNED" | "LATE" | "DAMAGED" | "LOST" | "PURCHASED";
  
  rentalPrice: Decimal;
  
  depositAmount?: Decimal;
  depositStatus?: "HELD" | "RETURNED" | "FORFEITED";
  
  damageFee?: Decimal;
  damageDescription?: string;
  damagePhotoUrl?: string;
  
  earlyReturnRefund?: Decimal;
  
  notes?: string;
  
  createdAt: DateTime;
  updatedAt: DateTime;
  
  // Nested
  orderItem: OrderItem;
  order: Order;
  customer: Customer;
  product: { name: string; sku: string };
}
```

---

### 3. Список аренд (с фильтрами)

**Endpoint**: `GET /rental`

**Query Parameters**:
```typescript
GET /rental?
  storeId=uuid&
  customerId=uuid&
  variantId=uuid&
  status=ACTIVE&
  sortBy=dueDate&
  sortOrder=ASC&
  limit=20&
  offset=0&
  fromDate=2026-08-01T00:00:00Z&
  toDate=2026-08-31T23:59:59Z
```

**Response 200**:
```typescript
{
  data: Rental[];
  total: number;
  limit: number;
  offset: number;
}
```

---

### 4. Вернуть арендованный товар

**Endpoint**: `POST /rental/:rentalId/return`

**Authorization**: STAFF (SELLER) | ADMIN | OWNER

**Request Body**:
```typescript
{
  damageStatus: "NONE" | "DAMAGED" | "LOST";
  
  // Если DAMAGED
  damageFee?: Decimal;
  damageDescription?: string;
  damagePhotoUrl?: string;  // Опционально: S3 URL
  
  // Возврат залога
  shouldRefundDeposit: boolean;
  
  // Для ранних возвратов
  earlyReturnRefundPolicy?: "FULL" | "CUSTOM" | "NONE";
  customRefundAmount?: Decimal;  // Если CUSTOM
}
```

**Response 200**:
```typescript
{
  rental: Rental;
  
  calculations: {
    rentalPrice: Decimal;
    damageFee?: Decimal;
    earlyReturnRefund?: Decimal;
    depositRefund?: Decimal;
    netRefund: Decimal;  // Сумма к возврату клиенту
  };
  
  transactions: {
    stockMovement: StockMovement;
    payments: Payment[];
    cashTransactions: CashTransaction[];
  };
}
```

**Error 400**:
```typescript
// Товар уже возвращен
{
  error: "RENTAL_ALREADY_RETURNED",
  message: "This rental has already been returned"
}

// Нельзя вернуть за штрафом больше чем залог
{
  error: "DAMAGE_FEE_EXCEEDS_DEPOSIT",
  message: "Damage fee (500) exceeds deposit (300)"
}
```

---

### 5. Продлить аренду

**Endpoint**: `POST /rental/:rentalId/extend`

**Authorization**: STAFF (SELLER) | ADMIN | OWNER | CUSTOMER

**Request Body**:
```typescript
{
  newDueDate: DateTime;  // Новая дата возврата
  additionalFee?: Decimal;  // Если НЕ указана, система рассчитает
  notes?: string;
}
```

**Response 200**:
```typescript
{
  rental: {
    id: string;
    dueDate: DateTime;  // Обновлено
    rentalPrice: Decimal;  // Обновлено
  };
  
  extension: {
    originalDueDate: DateTime;
    newDueDate: DateTime;
    additionalDays: number;
    additionalFee: Decimal;
  };
  
  payment: Payment;
  cashTransaction: CashTransaction;
}
```

**Error 400**:
```typescript
// Товар забронирован на эту дату
{
  error: "RESERVATION_CONFLICT",
  message: "Product is reserved for 2026-08-28 to 2026-08-30"
}

// Новая дата в прошлом
{
  error: "INVALID_DATE",
  message: "newDueDate must be in the future"
}

// Аренда уже завершена
{
  error: "RENTAL_NOT_ACTIVE",
  message: "Cannot extend a rental with status: RETURNED"
}
```

---

### 6. Обновить статус (Admin Only)

**Endpoint**: `PATCH /rental/:rentalId/status`

**Authorization**: ADMIN | OWNER

**Request Body**:
```typescript
{
  status: "ACTIVE" | "RETURNED" | "LATE" | "DAMAGED" | "LOST" | "PURCHASED";
  
  // Опциональные данные для перехода в LATE/LOST
  lateFee?: Decimal;
  lateDescription?: string;
}
```

**Response 200**:
```typescript
{
  rental: Rental;
  statusChangedFrom: RentalStatus;
  statusChangedTo: RentalStatus;
  timestamp: DateTime;
}
```

---

### 7. Купить товар вместо возврата

**Endpoint**: `POST /rental/:rentalId/purchase`

**Authorization**: STAFF (SELLER) | ADMIN | OWNER | CUSTOMER

**Request Body**:
```typescript
{
  purchasePrice: Decimal;
  deductFromDeposit: boolean;  // Зачесть залог в цену?
  
  // Опционально: скидка на покупку
  discount?: Decimal;
}
```

**Response 200**:
```typescript
{
  rental: {
    status: "PURCHASED";
    purchasedAt: DateTime;
  };
  
  newOrder: {
    id: string;
    totalAmount: Decimal;  // purchasePrice (минус залог если deductFromDeposit)
    status: "HOLD";
  };
  
  calculations: {
    purchasePrice: Decimal;
    depositDeducted: Decimal;
    remainingToPay: Decimal;
  };
}
```

---

## 🔷 Rental Tariffs

### 1. Создать тариф

**Endpoint**: `POST /product/:variantId/rental-tariff`

**Authorization**: ADMIN | OWNER

**Request Body**:
```typescript
{
  minDays: number;  // >= 1
  maxDays?: number;  // >= minDays, null = без верхнего лимита
  pricePerDay: Decimal;  // > 0
}
```

**Validation**:
- minDays >= 1
- maxDays is null OR maxDays >= minDays
- pricePerDay > 0
- Нет перекрытий с существующими тарифами

**Response 201**:
```typescript
{
  id: string;
  productVariantId: string;
  minDays: number;
  maxDays?: number;
  pricePerDay: Decimal;
  createdAt: DateTime;
}
```

**Error 409**:
```typescript
// Перекрытие с существующим тарифом
{
  error: "TARIFF_OVERLAP",
  message: "Tariff overlaps with existing: 3-7 days (80 sum/day)"
}
```

---

### 2. Получить тарифы варианта

**Endpoint**: `GET /product/:variantId/rental-tariff`

**Response 200**:
```typescript
{
  variantId: string;
  tariffs: [
    {
      id: string;
      minDays: number;
      maxDays?: number;
      pricePerDay: Decimal;
      createdAt: DateTime;
    }
  ];
  count: number;
}
```

---

### 3. Обновить тариф

**Endpoint**: `PATCH /product/:variantId/rental-tariff/:tariffId`

**Authorization**: ADMIN | OWNER

**Request Body**:
```typescript
{
  minDays?: number;
  maxDays?: number;
  pricePerDay?: Decimal;
}
```

**Response 200**:
```typescript
{
  id: string;
  productVariantId: string;
  minDays: number;
  maxDays?: number;
  pricePerDay: Decimal;
  updatedAt: DateTime;
}
```

---

### 4. Удалить тариф

**Endpoint**: `DELETE /product/:variantId/rental-tariff/:tariffId`

**Authorization**: ADMIN | OWNER

**Response 204**: No Content

---

## 🔷 Reservations

### 1. Создать бронирование

**Endpoint**: `POST /rental/reservation`

**Authorization**: CUSTOMER | STAFF | ADMIN

**Request Body**:
```typescript
{
  productVariantId: string;
  customerId: string;
  storeId: string;
  
  rentalStartDate: DateTime;  // Когда клиент хочет взять
  rentalEndDate: DateTime;    // Когда хочет вернуть
  
  notes?: string;
}
```

**Validation**:
- rentalStartDate < rentalEndDate
- rentalStartDate > now() (не в прошлом)
- ProductVariant.canRent = true
- getAvailableRentalItems >= 1
- Customer существует и принадлежит Store

**Response 201**:
```typescript
{
  id: string;
  productVariantId: string;
  customerId: string;
  storeId: string;
  
  rentalStartDate: DateTime;
  rentalEndDate: DateTime;
  
  status: "PENDING";
  expiresAt: DateTime;  // NOW() + 24 hours
  
  product: { name: string; sku: string };
  customer: { fullName: string; phone: string };
  
  createdAt: DateTime;
}
```

**Error 400**:
```typescript
// Товар не доступен на эту дату
{
  error: "NOT_AVAILABLE",
  message: "No available items for 2026-08-20 to 2026-08-25"
}
```

---

### 2. Список бронирований

**Endpoint**: `GET /rental/reservation`

**Query Parameters**:
```
storeId=uuid&
status=PENDING&
customerId=uuid&
sortBy=rentalStartDate&
limit=20
```

**Response 200**:
```typescript
{
  data: Reservation[];
  total: number;
  limit: number;
  offset: number;
}
```

---

### 3. Подтвердить бронирование

**Endpoint**: `PATCH /rental/reservation/:reservationId/confirm`

**Authorization**: CUSTOMER | STAFF | ADMIN

**Response 200**:
```typescript
{
  id: string;
  status: "CONFIRMED";
  updatedAt: DateTime;
}
```

---

### 4. Отменить бронирование

**Endpoint**: `PATCH /rental/reservation/:reservationId/cancel`

**Authorization**: CUSTOMER | STAFF | ADMIN

**Response 200**:
```typescript
{
  id: string;
  status: "CANCELLED";
  cancelledAt: DateTime;
}
```

---

## 🔷 Availability Check

### Проверить доступность товара на период

**Endpoint**: `GET /rental/availability/check`

**Query Parameters**:
```
variantId=uuid&
storeId=uuid&
startDate=2026-08-20T10:00:00Z&
endDate=2026-08-25T10:00:00Z
```

**Response 200**:
```typescript
{
  variantId: string;
  storeId: string;
  
  requestedPeriod: {
    startDate: DateTime;
    endDate: DateTime;
    days: number;
  };
  
  inventory: {
    totalStock: number;
    activeRentals: number;
    reservations: number;
    available: number;
  };
  
  isAvailable: boolean;
  
  appliedTariff?: {
    id: string;
    minDays: number;
    maxDays?: number;
    pricePerDay: Decimal;
    estimatedPrice: Decimal;  // days * pricePerDay
  };
  
  nextAvailableDate?: DateTime;  // Если не доступна сейчас
  
  overlappingRentals?: [
    {
      rentalId: string;
      customer: string;
      startDate: DateTime;
      dueDate: DateTime;
      status: RentalStatus;
    }
  ];
}
```

**Error 400**:
```typescript
// Неверные даты
{
  error: "INVALID_DATES",
  message: "startDate must be before endDate"
}
```

---

## 🔷 Error Responses

### Стандартные HTTP Status Codes

| Code | Meaning              | Пример                        |
| ---- | -------------------- | ----------------------------- |
| 200  | OK                   | GET запрос успешен            |
| 201  | Created              | Создан новый ресурс           |
| 204  | No Content           | Удаление успешно              |
| 400  | Bad Request          | Неверные данные в запросе     |
| 401  | Unauthorized         | Нет токена                    |
| 403  | Forbidden            | Нет прав доступа              |
| 404  | Not Found            | Ресурс не найден              |
| 409  | Conflict             | Конфликт (перекрытие тарифов) |
| 422  | Unprocessable Entity | Ошибка валидации              |
| 500  | Server Error         | Ошибка сервера                |

### Формат Error Response

```typescript
400 Bad Request
{
  statusCode: 400;
  error: "RENTAL_NOT_AVAILABLE";
  message: "No available items for rental";
  details?: {
    availableQuantity: 0;
    requestedQuantity: 1;
  };
  timestamp: "2026-08-18T12:34:56Z";
}
```

### Частые ошибки аренды

```typescript
// Товар не доступен
400 | RENTAL_NOT_AVAILABLE
"No available items for rental. Requested: 1, Available: 0"

// Товар не может быть сдан в аренду
400 | PRODUCT_NOT_RENTABLE
"This product cannot be rented. canRent: false"

// Аренда уже возвращена
400 | RENTAL_ALREADY_RETURNED
"This rental has already been returned. Status: RETURNED"

// Невозможно продлить
400 | CANNOT_EXTEND_RENTAL
"Cannot extend rental. Conflicting reservation on 2026-08-28"

// Штраф больше залога
400 | DAMAGE_FEE_EXCEEDS_DEPOSIT
"Damage fee (500) exceeds deposit (300). Need additional payment."

// Перекрытие тарифов
409 | TARIFF_OVERLAP
"Tariff overlaps with existing: 3-7 days (80 sum/day)"

// Нет прав доступа
403 | FORBIDDEN
"You can only access your own rentals"

// Ресурс не найден
404 | NOT_FOUND
"Rental not found: rental-uuid"

// Неверная дата
422 | VALIDATION_ERROR
"Dates validation failed. startDate must be before dueDate"
```

---

## 📊 Полный пример: Сценарий создания аренды

### Шаг 1: Проверить доступность

```http
GET /rental/availability/check?variantId=dress-M&storeId=store-uuid&startDate=2026-08-20&endDate=2026-08-25

Response 200:
{
  isAvailable: true,
  available: 2,
  appliedTariff: {
    pricePerDay: 80,
    estimatedPrice: 400
  }
}
```

### Шаг 2: Создать заказ с арендой

```http
POST /order
{
  "storeId": "store-uuid",
  "warehouseId": "warehouse-uuid",
  "staffId": "staff-uuid",
  "customerId": "customer-uuid",
  "items": [
    {
      "variantId": "dress-M",
      "quantity": 1,
      "itemType": "RENT",
      "rentalStartDate": "2026-08-20T10:00:00Z",
      "rentalEndDate": "2026-08-25T10:00:00Z",
      "allowEarlyReturnRefund": true,
      "earlyReturnRefundType": "FULL"
    }
  ]
}

Response 201:
{
  "id": "order-uuid",
  "status": "HOLD",
  "totalAmount": 400,
  "items": [
    {
      "id": "orderitem-uuid",
      "itemType": "RENT",
      "rentalId": "rental-uuid",
      "retailPrice": 400
    }
  ]
}
```

### Шаг 3: Добавить залог и оплатить

```http
POST /order/order-uuid/pay
{
  "payments": [
    {
      "type": "CASH",
      "amount": 1400  // 400 (аренда) + 1000 (залог)
    }
  ],
  "rentals": [
    {
      "orderItemId": "orderitem-uuid",
      "depositAmount": 1000,
      "depositType": "CASH"
    }
  ]
}

Response 200:
{
  "order": {
    "id": "order-uuid",
    "status": "COMPLETED",
    "paidAmount": 1400
  },
  "rental": {
    "depositAmount": 1000,
    "depositStatus": "HELD"
  }
}
```

### Шаг 4: Вернуть товар в нормальном состоянии

```http
POST /rental/rental-uuid/return
{
  "damageStatus": "NONE",
  "shouldRefundDeposit": true,
  "earlyReturnRefundPolicy": "FULL"  // Клиент вернул раньше
}

Response 200:
{
  "calculations": {
    "rentalPrice": 400,
    "earlyReturnRefund": 160,  // Вернул на день 3 вместо 5
    "depositRefund": 1000,
    "netRefund": 1160
  }
}
```

---

## 📝 Резюме API

**Total Endpoints**: 15+  
**Auth Required**: Yes (all endpoints)  
**Pagination**: Supported (limit, offset)  
**Filtering**: Supported (storeId, status, customerId, dates)  
**Sorting**: Supported (sortBy, sortOrder)  

