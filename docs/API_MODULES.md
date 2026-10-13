# API Modules Reference

## Base URL
```
Development: http://localhost:4000/api
Production: https://your-domain.com/api
```

## Authentication
Все endpoints (кроме `/login`, `/signup`, `/refresh`) требуют JWT токен в header:
```
Authorization: Bearer <access_token>
```

---

## 1. Auth Module (`/api/`)

### POST /login
**Public endpoint**

Авторизация пользователя.

**Request**:
```json
{
  "login": "string",      // email, username, или phone
  "password": "string"
}
```

**Response**:
```json
{
  "accessToken": "eyJhbGc..."
}
```

**Cookies**: `refreshToken` (httpOnly, 7 days)

**Errors**:
- `401 Unauthorized` — неверный login/password

---

### POST /signup
**Public endpoint**

Регистрация нового пользователя.

**Request**:
```json
{
  "fullName": "string",
  "phone": "string",
  "login": "string",
  "password": "string",
  "type": "CUSTOMER" | "STAFF"
}
```

**Response**:
```json
{
  "id": "uuid",
  "fullName": "string",
  "phone": "string",
  "type": "CUSTOMER" | "STAFF",
  "createdAt": "2026-08-15T10:00:00Z"
}
```

---

### GET /refresh
**Public endpoint**

Обновление access токена через refresh токен из cookie.

**Headers**: `Cookie: refreshToken=...`

**Response**:
```json
{
  "accessToken": "eyJhbGc..."
}
```

**Cookies**: новый `refreshToken` (rotation)

**Errors**:
- `401 Unauthorized` — невалидный или истекший refresh token

---

### POST /logout
**Требует JWT**

Выход из системы (отзыв refresh токена).

**Request**:
```json
{
  "refreshToken": "string"  // Из cookie или localStorage
}
```

**Response**:
```json
{
  "accessToken": null
}
```

---

### GET /auth/me
**Требует JWT**

Получение информации о текущем пользователе.

**Response**:
```json
{
  "id": "uuid",
  "fullName": "string",
  "phone": "string",
  "role": "ADMIN" | "OWNER" | "USER",
  "type": "CUSTOMER" | "STAFF",
  "image": "string | null",
  "auth": {
    "id": "uuid",
    "login": "string",
    "isActive": true
  },
  "staff": {
    "id": "uuid",
    "storeId": "uuid",
    "role": "OWNER" | "MANAGER" | "SELLER" | "CASHIER" | "WAREHOUSE",
    "warehouse": [
      { "warehouseId": "uuid" }
    ]
  } | null
}
```

---

## 2. Order Module (`/api/order`)

### POST /order
**Требует JWT + Staff**

Создание нового заказа.

**Request**:
```json
{
  "storeId": "uuid",
  "warehouseId": "uuid",
  "customerId": "uuid | null",
  "channel": "POS" | "ONLINE"
}
```

**Response**:
```json
{
  "id": "uuid",
  "storeId": "uuid",
  "warehouseId": "uuid",
  "cashierId": "uuid",
  "customerId": "uuid | null",
  "channel": "POS",
  "status": "CREATED",
  "totalAmount": 0,
  "paidAmount": 0,
  "createdAt": "2026-08-15T10:00:00Z"
}
```

**Автоматически**: создается или используется существующая открытая касса для продавца.

---

### POST /order/:id/items
**Требует JWT + Staff**

Добавление/обновление товаров в заказ.

**Request**:
```json
{
  "orderId": "uuid",
  "customerId": "uuid | null",
  "items": [
    {
      "itemId": "uuid | undefined",  // Если есть — UPDATE, если нет — CREATE
      "variantId": "uuid",
      "quantity": 1,
      "retailPrice": 100.00,
      "sale": 10.00,                 // Скидка
      "costAtSale": 50.00            // Себестоимость
    }
  ],
  "additionalServices": [
    {
      "id": "uuid | undefined",
      "name": "Доставка",
      "price": 50.00,
      "description": "По городу"
    }
  ]
}
```

**Response**:
```json
{
  "message": "Order items created successfully"
}
```

**Что происходит**:
- Order.status → `HOLD`
- Order.totalAmount пересчитывается
- Inventory НЕ списывается (только при оплате)

**Errors**:
- `400 Bad Request` — недостаточно товара на складе
- `400 Bad Request` — товар не принадлежит магазину
- `400 Bad Request` — заказ не в статусе CREATED/HOLD

---

### POST /order/:id/pay
**Требует JWT + Staff**

Оплата заказа.

**Request**:
```json
{
  "customerId": "uuid | null",
  "payments": [
    {
      "type": "CASH" | "CARD" | "ONLINE" | "TRANSFER",
      "amount": 100.00
    }
  ]
}
```

**Response**:
```json
{
  "message": "Payment created successfully"
}
```

**Что происходит**:
- Создаются Payment записи
- Создаются CashTransaction (INCOME, SALE)
- Создаются StockMovement (OUT, SALE)
- Списывается Inventory
- Обновляется Cashbox.balance
- Order.status → `COMPLETED` или `DEBT`

**Errors**:
- `400 Bad Request` — сумма оплаты превышает totalAmount
- `400 Bad Request` — недостаточно товара на складе
- `400 Bad Request` — открытая касса не найдена

---

### POST /order/return/:id
**Требует JWT + Staff**

Возврат товара.

**Request**:
```json
{
  "orderId": "uuid",
  "items": [
    {
      "itemId": "uuid",           // ID OrderItem
      "quantity": 1,
      "retailPrice": 100.00,
      "sale": 10.00,
      "costAtSale": 50.00
    }
  ],
  "returnPayments": [
    {
      "type": "CASH" | "CARD",
      "amount": 90.00             // Сколько вернули клиенту
    }
  ]
}
```

**Response**:
```json
{
  "message": "Order returned successfully"
}
```

**Что происходит**:
- Создается ReturnedOrder
- Создаются ReturnItem
- Создаются StockMovement (IN, RETURN)
- Создаются CashTransaction (EXPENSE, RETURN)
- Создаются ReturnPayment
- Восстанавливается Inventory
- Обновляется Cashbox.balance
- Order.status → `REFUNDED` или `DEBT`

**Errors**:
- `400 Bad Request` — заказ не в статусе COMPLETED/DEBT
- `400 Bad Request` — заказ уже возвращен
- `400 Bad Request` — возвращаемое количество превышает купленное

---

### GET /order
**Требует JWT + Staff**

Список заказов (с пагинацией).

**Query Parameters**:
- `pageSize` (default: 10)
- `currentPage` (default: 1)
- `status` — фильтр по статусу (можно несколько через запятую: `COMPLETED,DEBT`)
- `fromDate` — фильтр от даты (ISO 8601)
- `toDate` — фильтр до даты (ISO 8601)

**Response**:
```json
{
  "currentPage": 1,
  "pageSize": 10,
  "total": 100,
  "data": [
    {
      "id": "uuid",
      "store": { "id": "uuid", "name": "string" },
      "warehouse": { "id": "uuid", "name": "string" },
      "cashier": {
        "id": "uuid",
        "role": "SELLER",
        "user": { "fullName": "string", "phone": "string" }
      },
      "customer": {
        "id": "uuid",
        "user": { "fullName": "string", "phone": "string" }
      } | null,
      "channel": "POS",
      "status": "COMPLETED",
      "totalAmount": 1000.00,
      "paidAmount": 1000.00,
      "createdAt": "2026-08-15T10:00:00Z"
    }
  ]
}
```

**Фильтрация**:
- STAFF видит только заказы своего магазина
- ADMIN видит все заказы

---

### GET /order/search?search=:query
**Требует JWT + Staff**

Поиск заказов по клиенту.

**Query Parameters**:
- `search` — поиск по fullName или phone клиента

**Response**: массив заказов с customer информацией

---

### GET /order/:id
**Требует JWT + Staff**

Детальная информация о заказе.

**Response**:
```json
{
  "id": "uuid",
  "storeId": "uuid",
  "warehouseId": "uuid",
  "cashierId": "uuid",
  "customerId": "uuid | null",
  "channel": "POS",
  "status": "COMPLETED",
  "totalAmount": 1000.00,
  "paidAmount": 1000.00,
  "createdAt": "2026-08-15T10:00:00Z",
  "items": [
    {
      "id": "uuid",
      "variantId": "uuid",
      "quantity": 2,
      "retailPrice": 500.00,
      "sale": 50.00,
      "costAtSale": 300.00,
      "variant": {
        "id": "uuid",
        "sku": "string",
        "barCode": "string",
        "price": 500.00,
        "quantity": 10  // Текущий остаток
      }
    }
  ],
  "customer": {
    "id": "uuid",
    "user": { "fullName": "string", "phone": "string" }
  } | null,
  "payments": [
    {
      "id": "uuid",
      "type": "CASH",
      "amount": 1000.00,
      "createdAt": "2026-08-15T10:00:00Z"
    }
  ],
  "services": [
    {
      "id": "uuid",
      "name": "Доставка",
      "price": 50.00,
      "description": "По городу"
    }
  ]
}
```

**Фильтрация**:
- OWNER/MANAGER видят все заказы магазина
- SELLER/CASHIER видят только свои заказы

---

### PATCH /order/:id/clear-customer
**Требует JWT + Staff**

Удаление клиента из заказа.

**Response**: обновленный заказ

**Errors**:
- `400 Bad Request` — заказ в статусе COMPLETED/DEBT/REFUNDED

---

### DELETE /order/:id
**Требует JWT + Staff**

Отмена заказа.

**Response**: заказ со статусом `CANCELLED`

**Errors**:
- `400 Bad Request` — заказ уже оплачен (есть платежи)
- `400 Bad Request` — заказ в статусе COMPLETED/DEBT/REFUNDED

---

## 3. Cashbox Module (`/api/cashbox`)

### POST /cashbox
**Требует JWT + Staff (OWNER/MANAGER)**

Открытие кассы.

**Request**:
```json
{
  "storeId": "uuid",
  "warehouseId": "uuid",
  "balance": 1000.00  // Начальный баланс (опционально, default: 0)
}
```

**Response**:
```json
{
  "id": "uuid",
  "sellerId": "uuid",
  "storeId": "uuid",
  "warehouseId": "uuid",
  "status": "OPEN",
  "balance": 1000.00,
  "createdAt": "2026-08-15T10:00:00Z"
}
```

**Errors**:
- `400 Bad Request` — у продавца уже есть открытая касса на этом складе

---

### POST /cashbox/:id/close
**Требует JWT + Staff**

Закрытие кассы.

**Response**: касса со статусом `CLOSED`

**Errors**:
- `400 Bad Request` — касса не найдена или уже закрыта
- `403 Forbidden` — нельзя закрыть чужую кассу (только OWNER/MANAGER могут)

---

### POST /cashbox/:id/transaction
**Требует JWT + Staff**

Добавление ручной транзакции в кассу.

**Используется для**:
- **INCOME**: Прием денег (неопознанные платежи, авансы)
- **EXPENSE**: Расход из кассы (возврат клиенту, личные расходы, зарплата, аренда)

#### Пример 1: Неопознанный платеж (кто-то принес деньги)
```json
{
  "type": "INCOME",
  "category": "OTHER",
  "paymentType": "CASH",
  "amount": 5000.00,
  "comment": "Клиент Иванов принес деньги, уточнить назначение",
  "orderId": null
}
```

#### Пример 2: Возврат клиенту (кредит по заказу)
```json
{
  "type": "EXPENSE",
  "category": "RETURN",
  "paymentType": "CASH",
  "amount": 100.00,
  "comment": "Возврат клиенту по заказу #123",
  "orderId": "uuid-order"
}
```

#### Пример 3: Личные расходы (купил попить)
```json
{
  "type": "EXPENSE",
  "category": "OTHER",
  "paymentType": "CASH",
  "amount": 20.00,
  "comment": "Купил воду для магазина"
}
```

#### Пример 4: Зарплата работникам
```json
{
  "type": "EXPENSE",
  "category": "SALARY",
  "paymentType": "CASH",
  "amount": 5000.00,
  "comment": "Зарплата продавцу Петрову за июль"
}
```

#### Пример 5: Аренда
```json
{
  "type": "EXPENSE",
  "category": "RENT",
  "paymentType": "CASH",
  "amount": 10000.00,
  "comment": "Аренда помещения за август"
}
```

#### Пример 6: Закупка товара
```json
{
  "type": "EXPENSE",
  "category": "PURCHASE",
  "paymentType": "CASH",
  "amount": 50000.00,
  "comment": "Закупка товара у поставщика Ромашка"
}
```

**Response**:
```json
{
  "message": "Cash transaction added successfully"
}
```

**Что происходит**:
- Создается CashTransaction
- Обновляется Cashbox.balance:
  - `INCOME` → balance увеличивается
  - `EXPENSE` → balance уменьшается

**Категории транзакций**:
- `SALE` — продажа товара (автоматически при оплате заказа)
- `DEBT_PAYMENT` — оплата старого долга (автоматически)
- `RETURN` — возврат денег клиенту
- `RENT` — аренда помещения
- `DELIVERY` — доставка
- `SALARY` — зарплата
- `PURCHASE` — закупка товара
- `OTHER` — прочие операции (неопознанные платежи, личные расходы)

**Errors**:
- `400 Bad Request` — касса не открыта
- `403 Forbidden` — нет доступа к кассе

**Примечание**: 
- Неопознанные платежи (INCOME, OTHER) можно потом связать с заказами/долгами для отчетности
- Автоматические транзакции (SALE, DEBT_PAYMENT) создаются системой, не через этот endpoint

---

### GET /cashbox
**Требует JWT + Staff**

Список касс (с пагинацией).

**Query Parameters**:
- `pageSize` (default: 10)
- `currentPage` (default: 1)

**Response**:
```json
{
  "currentPage": 1,
  "pageSize": 10,
  "total": 50,
  "data": [
    {
      "id": "uuid",
      "status": "OPEN",
      "balance": 5000.00,
      "createdAt": "2026-08-15T10:00:00Z",
      "seller": {
        "id": "uuid",
        "role": "SELLER",
        "user": { "fullName": "string", "phone": "string" }
      },
      "warehouse": { "id": "uuid", "name": "string" },
      "transactions": [
        {
          "id": "uuid",
          "type": "INCOME",
          "category": "SALE",
          "paymentType": "CASH",
          "amount": 1000.00,
          "createdAt": "2026-08-15T10:00:00Z"
        }
      ]
    }
  ]
}
```

**Фильтрация**:
- OWNER/MANAGER видят все кассы магазина
- Другие роли видят только свои кассы

---

### GET /cashbox/:id
**Требует JWT + Staff**

Детальная информация о кассе.

**Response**: та же структура, что и в списке, но одна касса

---

## 4. Product Module (`/api/product`)

### POST /product
**Требует JWT + Staff (OWNER/MANAGER)**

Создание товара.

**Request**:
```json
{
  "name": "string",
  "warehouseId": "uuid",
  "categoryId": "uuid | null",
  "brandId": "uuid | null",
  "description": "string | null",
  "images": ["https://...", "https://..."],
  "attributeIds": ["uuid", "uuid"],  // IDs из Attribute
  "tagIds": ["uuid", "uuid"]         // IDs из TagValue
}
```

**Response**: созданный Product

**Что происходит**:
- storeId берется из warehouse
- Первая картинка становится главной (`isMain: true`)

---

### POST /product/variant
**Требует JWT + Staff (OWNER/MANAGER)**

Создание вариантов товара.

**Request**:
```json
{
  "productId": "uuid",
  "category": "string",  // Для генерации SKU
  "variants": [
    {
      "retailPrice": 500.00,
      "costPrice": 300.00,
      "quantity": 10,
      "attributes": [
        {
          "attributeValueId": "uuid",
          "value": "M"  // Для генерации SKU
        }
      ]
    }
  ]
}
```

**Response**: созданный Product

**Что происходит (для каждого варианта)**:
- Генерируется уникальный barcode
- Генерируется SKU на основе названия, категории, атрибутов
- Создается ProductVariant
- Создается Inventory с quantity
- Создается StockMovement (IN, PURCHASE)
- Связываются атрибуты (VariantAttributeValue)

---

### GET /product
**Требует JWT + Staff**

Список товаров (с пагинацией).

**Query Parameters**:
- `pageSize` (default: 10)
- `currentPage` (default: 1)

**Response**:
```json
{
  "currentPage": 1,
  "pageSize": 10,
  "total": 200,
  "data": [
    {
      "id": "uuid",
      "name": "string",
      "brand": "string | null",
      "category": "string | null",
      "description": "string | null",
      "images": [
        { "id": "uuid", "url": "https://...", "isMain": true }
      ],
      "warehouseId": "uuid",
      "warehouse": { "id": "uuid", "name": "string" },
      "isArchived": false,
      "createdAt": "2026-08-15T10:00:00Z",
      "priceRange": {
        "min": 100.00,
        "max": 500.00
      },
      "variants": [
        {
          "id": "uuid",
          "price": 500.00,
          "quantity": 10
        }
      ],
      "tags": [
        {
          "id": "uuid",
          "tagId": "uuid",
          "tagName": "Материал",
          "value": "Хлопок"
        }
      ]
    }
  ]
}
```

**Фильтрация**:
- OWNER видит все товары своего магазина
- MANAGER/SELLER видят товары складов, к которым есть доступ

---

### GET /product/:id
**Требует JWT + Staff**

Детальная информация о товаре.

**Response**:
```json
{
  "id": "uuid",
  "name": "string",
  "brand": "string | null",
  "category": "string | null",
  "description": "string | null",
  "images": [...],
  "warehouseId": "uuid",
  "warehouse": { ... },
  "isArchived": false,
  "createdAt": "2026-08-15T10:00:00Z",
  "attributes": [
    { "id": "uuid", "name": "Размер", "type": "STRING" }
  ],
  "tags": [...],
  "variants": [
    {
      "id": "uuid",
      "sku": "string",
      "barCode": "200000000001",
      "price": 500.00,
      "quantity": 10,
      "attributes": [
        {
          "id": "uuid",
          "attributeId": "uuid",
          "value": "M"
        }
      ],
      "stockMovements": [
        {
          "id": "uuid",
          "type": "IN",
          "reason": "PURCHASE",
          "quantity": 10,
          "unitCost": 300.00,
          "warehouseId": "uuid",
          "createdAt": "2026-08-15T10:00:00Z",
          "createdBy": {
            "role": "MANAGER",
            "isActive": true,
            "user": { "fullName": "string" }
          }
        }
      ]
    }
  ]
}
```

---

### GET /product/variants
**Требует JWT + Staff**

Список всех вариантов (с пагинацией).

**Query Parameters**:
- `pageSize` (default: 10)
- `currentPage` (default: 1)

**Response**: список ProductVariant с inventory и stockMovements

---

### GET /product/search
**Требует JWT + Staff**

Поиск товаров по SKU, barcode или названию.

**Query Parameters**:
- `text` — поисковый запрос
- `warehouseId` — склад для поиска
- `pageSize` (default: 20)
- `currentPage` (default: 1)

**Response**: список ProductVariant

---

### PATCH /product/variant/:id
**Требует JWT + Staff (OWNER/MANAGER)**

Обновление цены варианта.

**Request**:
```json
{
  "price": 550.00
}
```

**Response**:
```json
{
  "message": "Product variant price updated successfully"
}
```

**Errors**:
- `403 Forbidden` — нет доступа к складу варианта

---

### DELETE /product/:id
**Требует JWT + Staff (OWNER/MANAGER)**

Архивирование товара.

**Response**:
```json
{
  "message": "Product archived successfully"
}
```

**Что происходит**: Product.isArchived → `true`

---

## 5. Warehouse Module (`/api/warehouse`)

### POST /warehouse
**Требует JWT + Staff (OWNER)**

Создание склада.

**Request**:
```json
{
  "name": "string",
  "storeId": "uuid",
  "ownerId": "uuid"  // Staff ID владельца
}
```

**Response**:
```json
{
  "warehouse": {
    "id": "uuid",
    "name": "string",
    "storeId": "uuid",
    "isActive": true,
    "createdAt": "2026-08-15T10:00:00Z"
  },
  "worker": null
}
```

**Что происходит**: автоматически создается связь StaffOnWarehouse для ownerId

---

### POST /warehouse/:id/inventory-movement
**Требует JWT + Staff (OWNER/MANAGER)**

Приход товара или корректировка остатков.

**Request**:
```json
{
  "variantId": "uuid",
  "type": "IN" | "OUT",
  "reason": "PURCHASE" | "ADJUSTMENT",
  "quantity": 10,
  "costPrice": 300.00,
  "price": 500.00  // Новая розничная цена
}
```

**Response**:
```json
{
  "message": "Inventory added successfully"
}
```

**Что происходит (транзакция)**:
- Inventory обновляется (+ или -)
- StockMovement создается
- ProductVariant.price обновляется

**Errors**:
- `404 Not Found` — variant или warehouse не найден
- `400 Bad Request` — warehouse не принадлежит варианту

---

### GET /warehouse
**Требует JWT + Staff**

Список складов (с пагинацией).

**Query Parameters**:
- `pageSize` (default: 10)
- `currentPage` (default: 1)

**Response**:
```json
{
  "currentPage": 1,
  "pageSize": 10,
  "total": 5,
  "data": [
    {
      "id": "uuid",
      "name": "string",
      "storeId": "uuid",
      "isActive": true,
      "createdAt": "2026-08-15T10:00:00Z"
    }
  ]
}
```

---

### GET /warehouse/:id
**Требует JWT + Staff**

Детальная информация о складе.

**Response**:
```json
{
  "id": "uuid",
  "name": "string",
  "storeId": "uuid",
  "isActive": true,
  "createdAt": "2026-08-15T10:00:00Z",
  "inventory": [
    {
      "id": "uuid",
      "variantId": "uuid",
      "quantity": 10,
      "variant": {
        "id": "uuid",
        "sku": "string",
        "barCode": "string",
        "price": 500.00,
        "product": { "name": "string" }
      }
    }
  ],
  "stockMovements": [...],
  "staffs": [...],
  "orders": [...]
}
```

---

## 6. Debt Module (`/api/debt`)

### POST /debt
**Требует JWT + Staff (OWNER/MANAGER)**

Создание старого долга (не связанного с заказом).

**Request**:
```json
{
  "storeId": "uuid",
  "customerId": "uuid",
  "amount": 5000.00,
  "description": "Долг за товары 2024 года",
  "createdAt": "2024-01-15T10:00:00Z",  // Опционально
  "returnedAt": "2024-12-31T10:00:00Z"  // Опционально
}
```

**Response**:
```json
{
  "id": "uuid",
  "storeId": "uuid",
  "customerId": "uuid",
  "totalAmount": 5000.00,
  "paidAmount": 0,
  "status": "ACTIVE",
  "description": "Долг за товары 2024 года",
  "createdAt": "2024-01-15T10:00:00Z",
  "returnedAt": "2024-12-31T10:00:00Z"
}
```

---

### POST /debt/payment
**Требует JWT + Staff**

Оплата старого долга.

**Request**:
```json
{
  "debtId": "uuid",
  "warehouseId": "uuid",  // Для привязки к кассе
  "payments": [
    {
      "type": "CASH" | "CARD" | "ONLINE" | "TRANSFER",
      "amount": 1000.00
    }
  ]
}
```

**Response**: обновленный CustomerDebt

**Что происходит (транзакция)**:
- Создаются DebtPayment
- Создаются CashTransaction (INCOME, DEBT_PAYMENT)
- Обновляется Cashbox.balance
- Обновляется CustomerDebt.paidAmount
- Если paidAmount >= totalAmount → status: `PAID`

**Errors**:
- `400 Bad Request` — долг не найден
- `400 Bad Request` — открытая касса не найдена
- `400 Bad Request` — нет доступа к складу

---

### GET /debt
**Требует JWT + Staff**

Список долгов (с пагинацией).

**Query Parameters**:
- `pageSize` (default: 10)
- `currentPage` (default: 1)
- `status` — фильтр по статусу (`ACTIVE` | `PAID`)
- `customerId` — фильтр по клиенту
- `fromDate` — фильтр от даты
- `toDate` — фильтр до даты

**Response**:
```json
{
  "currentPage": 1,
  "pageSize": 10,
  "total": 20,
  "data": [
    {
      "id": "uuid",
      "totalAmount": 5000.00,
      "paidAmount": 2000.00,
      "status": "ACTIVE",
      "description": "Долг за товары 2024 года",
      "createdAt": "2024-01-15T10:00:00Z",
      "customer": {
        "id": "uuid",
        "user": { "fullName": "string", "phone": "string" }
      },
      "payments": [
        {
          "id": "uuid",
          "amount": 1000.00,
          "type": "CASH",
          "createdAt": "2026-08-15T10:00:00Z"
        }
      ]
    }
  ]
}
```

---

### GET /debt/:id
**Требует JWT + Staff**

Детальная информация о долге.

**Response**: та же структура, что и в списке

---

## 7. User Module (`/api/user`)

### POST /user
**Требует JWT + ADMIN/OWNER**

Создание пользователя (Customer или Staff).

**Request**:
```json
{
  "fullName": "string",
  "phone": "string",
  "type": "CUSTOMER" | "STAFF",
  "login": "string",
  "password": "string",
  // Если type = STAFF:
  "storeId": "uuid",
  "role": "OWNER" | "MANAGER" | "SELLER" | "CASHIER" | "WAREHOUSE"
}
```

**Response**: созданный User

---

### GET /user
**Требует JWT + Staff**

Список пользователей.

**Response**: массив User

---

### GET /user/:id
**Требует JWT + Staff**

Детальная информация о пользователе.

**Response**: User с auth, staff, customer

---

## 8. Store Module (`/api/store`)

### POST /store
**Требует JWT + ADMIN**

Создание магазина.

**Request**:
```json
{
  "name": "string",
  "ownerId": "uuid"
}
```

**Response**: созданный Store

---

### GET /store
**Требует JWT + Staff**

Список магазинов.

**Response**: массив Store

---

### GET /store/:id
**Требует JWT + Staff**

Детальная информация о магазине.

**Response**: Store с warehouses, staff, customers

---

## 9. Category Attributes Module (`/api/category-attributes`)

### POST /category-attributes/category
**Требует JWT + ADMIN/OWNER**

Создание категории.

**Request**:
```json
{
  "name": "string",
  "parentId": "uuid | null"
}
```

**Response**: созданная Category

---

### POST /category-attributes/attribute
**Требует JWT + ADMIN/OWNER**

Создание атрибута (фильтра).

**Request**:
```json
{
  "name": "string",
  "type": "STRING" | "NUMBER" | "BOOLEAN"
}
```

**Response**: созданный Attribute

---

### POST /category-attributes/attribute-value
**Требует JWT + ADMIN/OWNER**

Создание значения атрибута.

**Request**:
```json
{
  "attributeId": "uuid",
  "valueString": "string | null",
  "valueNumber": "number | null",
  "valueBool": "boolean | null"
}
```

**Response**: созданный AttributeValue

---

### GET /category-attributes/category
**Public endpoint**

Список категорий.

**Response**: массив Category (древовидная структура)

---

### GET /category-attributes/attribute
**Public endpoint**

Список атрибутов.

**Response**: массив Attribute с values

---

## 10. File Module (`/api/file`)

### POST /file/upload
**Требует JWT + Staff**

Загрузка файла в S3.

**Request**: multipart/form-data с полем `file`

**Response**:
```json
{
  "url": "https://s3.amazonaws.com/bucket/file.jpg"
}
```

---

## Общие замечания

### Pagination
Все endpoints с пагинацией возвращают:
```json
{
  "currentPage": 1,
  "pageSize": 10,
  "total": 100,
  "data": [...]
}
```

### Errors
Все ошибки возвращаются в формате:
```json
{
  "statusCode": 400,
  "message": "Detailed error message",
  "error": "Bad Request"
}
```

### Date Format
Все даты в ISO 8601: `2026-08-15T10:00:00Z`

### Decimal Format
Все денежные суммы в Decimal (строка с точностью до 2 знаков): `"1000.00"`
