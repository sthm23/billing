# Quick Start — Быстрый старт для AI моделей

Этот документ предназначен для **новых AI моделей**, начинающих работу с проектом. Здесь собраны ключевые факты, которые нужно знать, чтобы быстро ориентироваться в кодовой базе.

---

## 🎯 Что это за проект?

**Billing System** — это **multi-tenant POS система** (Point of Sale) для управления розничными магазинами.

**Ключевые фичи**:
- Управление складами и инвентарем
- Продажа товаров через POS терминал
- Поддержка долгов клиентов (частичная оплата)
- Возврат товаров с кредитом/дебетом
- Управление кассами (каждый продавец — своя касса)
- Полный аудит всех операций (StockMovement, CashTransaction)

---

## 📋 Структура проекта

```
billing/
├── src/
│   ├── auth/              # JWT авторизация
│   ├── order/             # САМЫЙ ВАЖНЫЙ модуль (создание заказов, оплата, возвраты)
│   ├── cashbox/           # Управление кассами
│   ├── product/           # Товары и варианты (SKU)
│   ├── warehouse/         # Склады, приход товара
│   ├── debt/              # Старые долги (CustomerDebt)
│   ├── payment/           # Платежи (реально используется мало, основная логика в order)
│   ├── user/              # Пользователи (Customer, Staff)
│   ├── store/             # Магазины
│   ├── admin/             # Админ-операции
│   ├── category-attributes/ # Категории, фильтры
│   ├── file/              # Загрузка файлов в S3
│   ├── prisma/            # PrismaService, S3Service
│   └── shared/            # Guards, helpers, decorators
├── prisma/
│   └── schema.prisma      # База данных (READ THIS FIRST!)
├── docs/                  # 📚 ВСЯ ДОКУМЕНТАЦИЯ ЗДЕСЬ
│   ├── QUICK_START.md     # ← ты тут
│   ├── ARCHITECTURE.md    # Общая архитектура
│   ├── BUSINESS_LOGIC.md  # Подробная бизнес-логика (MUST READ!)
│   ├── API_MODULES.md     # Полная документация API
│   ├── WORKFLOWS.md       # Пошаговые сценарии
│   └── CLAUDE.md          # Старая документация (можно игнорировать)
└── generated/prisma/      # Prisma client (НЕ node_modules/.prisma!)
```

---

## 🔑 Ключевые концепции

### 1. Multi-tenancy через Store
- **Store** (магазин) — верхний уровень изоляции
- У каждого магазина свои склады, товары, персонал, клиенты
- Staff работает только в рамках своего магазина
- Товары привязаны к конкретному складу

### 2. Warehouse-centric подход
- Каждый товар (`Product`) принадлежит конкретному складу
- Продавец может работать только на складах, к которым есть доступ (`StaffOnWarehouse`)
- Инвентарь учитывается по связке `warehouseId + variantId`

### 3. Product vs ProductVariant
- **Product** — логический товар ("Футболка Nike")
- **ProductVariant** — конкретный SKU с баркодом ("Футболка Nike M Красная", barcode: "200000000001")
- **Inventory** — остатки по варианту на складе

### 4. Жизненный цикл заказа
```
CREATED → HOLD → [DEBT | COMPLETED] → [REFUNDED | CANCELLED]
```
- **CREATED**: заказ создан, товары не добавлены
- **HOLD**: товары добавлены, готов к оплате (inventory НЕ списан!)
- **DEBT**: частичная оплата
- **COMPLETED**: полностью оплачен
- **REFUNDED**: возвращен

**ВАЖНО**: Inventory списывается ТОЛЬКО при оплате (не при добавлении товаров)!

### 5. Два типа долгов
- **Order Debt**: долг по заказу (Order.status = DEBT)
- **CustomerDebt**: старые долги ДО внедрения системы (отдельная таблица)

### 6. Cashbox (Касса)
- Каждый продавец открывает свою кассу на смену
- Несколько продавцов на одном складе = несколько касс одновременно
- После закрытия нельзя добавлять транзакции

### 7. Аудит всех операций
- **StockMovement**: каждое изменение inventory (IN/OUT, PURCHASE/SALE/RETURN/ADJUSTMENT)
- **CashTransaction**: каждая денежная операция (INCOME/EXPENSE, SALE/DEBT_PAYMENT/RETURN/RENT/...)

---

## 🗂️ База данных (краткая схема)

### Пользователи
```
User (тип: CUSTOMER | STAFF)
  ├─ AuthAccount (login, passwordHash)
  ├─ Customer (связь с Store через M2M)
  └─ Staff (storeId, role: OWNER/MANAGER/SELLER/CASHIER/WAREHOUSE)
       └─ StaffOnWarehouse (M2M: staff ↔ warehouse)
```

### Магазины и склады
```
Store
  └─ Warehouse[]
       └─ Product[]
            └─ ProductVariant[] (SKU, barcode)
                 └─ Inventory (quantity по складу)
```

### Заказы
```
Order (status, totalAmount, paidAmount)
  ├─ OrderItem[] (variantId, quantity, retailPrice, sale, costAtSale)
  ├─ Payment[] (type, amount)
  ├─ AdditionalService[] (название, цена доп. услуг)
  ├─ CashTransaction[] (INCOME/EXPENSE)
  └─ ReturnedOrder? (если возвращен)
       ├─ ReturnItem[]
       └─ ReturnPayment[]
```

### Кассы
```
Cashbox (sellerId, storeId, warehouseId, status: OPEN/CLOSED, balance)
  └─ CashTransaction[] (type, category, paymentType, amount)
```

### Долги
```
CustomerDebt (totalAmount, paidAmount, status: ACTIVE/PAID)
  └─ DebtPayment[] (amount, type)
       └─ CashTransaction (category: DEBT_PAYMENT)
```

---

## 🧩 Path Aliases (важно для импортов!)

```typescript
@auth/*          → src/auth
@user/*          → src/user
@product/*       → src/product
@warehouse/*     → src/warehouse
@order/*         → src/order
@payment/*       → src/payment
@cashbox/*       → src/cashbox
@debt/*          → src/debt
@admin/*         → src/admin
@shared/*        → src/shared
@prisma/*        → src/prisma
@generated/*     → generated/prisma (Prisma client)
```

**ВАЖНО**: Enums импортируются из `@generated/enums`, НЕ из `@prisma/client`!

```typescript
// ✅ ПРАВИЛЬНО
import { OrderStatus, PaymentType } from '@generated/enums';

// ❌ НЕПРАВИЛЬНО
import { OrderStatus, PaymentType } from '@prisma/client';
```

---

## 🔒 Авторизация и права

### JWT Tokens
- **Access token**: 15 минут, в header `Authorization: Bearer <token>`
- **Refresh token**: 7 дней, в httpOnly cookie

### User Roles (на уровне User)
- **ADMIN**: супер-админ (управление всеми магазинами)
- **OWNER**: владелец магазина
- **USER**: обычный пользователь (Customer)

### Staff Roles (на уровне Staff)
- **OWNER**: создание сотрудников, просмотр отчетов, полный доступ
- **MANAGER**: полный доступ к товарам/складам, но без сотрудников/отчетов
- **SELLER, CASHIER, WAREHOUSE**: в планах, пока не активны

### CurrentUser в контроллерах
```typescript
@Get()
async findAll(@User() user: CurrentUser) {
  // user.id, user.role, user.type
  // user.staff?.id, user.staff?.storeId, user.staff?.role
  // user.staff?.warehouse[] — склады, к которым есть доступ
}
```

### Guards
```typescript
// Требует JWT
@UseGuards(AuthJWTGuard)

// Требует роль
@Roles(StaffRole.OWNER, StaffRole.MANAGER)
@UseGuards(AuthJWTGuard, RolesGuard)

// Публичный endpoint
@Public()
```

---

## 💡 Частые задачи

### Как добавить новый endpoint?

1. **Создать DTO** в `dto/`:
```typescript
export class CreateXDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
```

2. **Добавить метод в сервис**:
```typescript
async create(dto: CreateXDto, user: CurrentUser) {
  // Валидация прав
  if (user.staff.storeId !== dto.storeId) {
    throw new BadRequestException('Staff does not belong to the store');
  }

  // Создание через Prisma
  return await this.prisma.x.create({
    data: { ...dto }
  });
}
```

3. **Добавить endpoint в контроллер**:
```typescript
@Post()
@UseGuards(AuthJWTGuard)
async create(@Body() dto: CreateXDto, @User() user: CurrentUser) {
  return this.service.create(dto, user);
}
```

### Как работать с транзакциями?

```typescript
await this.prisma.$transaction(async (prisma) => {
  // Все операции внутри атомарны
  const order = await prisma.order.create({ data: {...} });
  await prisma.payment.create({ data: {...} });
  await prisma.inventory.update({ where: {...}, data: {...} });
  
  // Если любая операция упадет — весь rollback
});
```

### Как атомарно списать inventory?

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
}
```

### Как проверить доступ к складу?

```typescript
const hasAccess = user.staff.warehouse.some(w => w.warehouseId === dto.warehouseId);
if (!hasAccess) {
  throw new BadRequestException('Staff does not have access to this warehouse');
}
```

---

## ⚠️ Важные правила

1. **Inventory списывается ТОЛЬКО при оплате**, не при добавлении в заказ!
2. **Всегда используй транзакции** для многошаговых операций (order + payment + inventory)
3. **Decimal для денег**: `new Prisma.Decimal(value)` или `+value` для чтения
4. **Enum imports**: только из `@generated/enums`
5. **Error handling**: `throw new BadRequestException(error.message)`
6. **Проверяй права**: staff.storeId, staff.warehouse, staff.role
7. **Логируй всё**: StockMovement для inventory, CashTransaction для денег
8. **Не забывай Cashbox**: при оплате/возврате обновляй balance
9. **Barcode уникален глобально**, SKU — в рамках магазина
10. **После закрытия кассы** нельзя добавлять транзакции

---

## 📚 Куда смотреть дальше?

### Изучаем бизнес-логику
1. **Начни с**: `docs/BUSINESS_LOGIC.md` (MUST READ!)
2. **Затем**: `prisma/schema.prisma` (вся схема БД)
3. **Посмотри**: `src/order/order.service.ts` (самая сложная логика)

### Понимаем API
1. **Полная документация**: `docs/API_MODULES.md`
2. **Пошаговые сценарии**: `docs/WORKFLOWS.md`

### Погружаемся в архитектуру
1. **Общая картина**: `docs/ARCHITECTURE.md`
2. **Deployment**: `VPS_SETUP.md`, `BACKUP_SETUP.md`

---

## 🧪 Как запустить проект?

### Development
```bash
# 1. Запуск PostgreSQL
docker-compose up -d

# 2. Генерация Prisma client
npm run prisma:generate

# 3. Применение миграций
npm run prisma:migrate

# 4. Запуск dev сервера
npm run start:dev
```

### Production
```bash
npm run build
npm run prisma:migrate-prod
npm run start:prod
```

### Тесты
```bash
npm test              # Unit tests
npm run test:e2e      # E2E tests
npm run test:cov      # Coverage
```

---

## 🐛 Debugging tips

### Не можешь найти, где создается что-то?
1. `grep -r "prisma.order.create" src/` — найти все создания Order
2. `grep -r "OrderStatus.COMPLETED" src/` — найти все использования статуса
3. Смотри в `*.service.ts` файлы — вся логика там

### Prisma query не работает?
1. Проверь, сгенерирован ли Prisma client: `npm run prisma:generate`
2. Смотри в `generated/prisma/index.d.ts` — там все типы
3. Включи логи: `prisma: { log: ['query', 'info', 'warn', 'error'] }`

### JWT не работает?
1. Проверь `.env`: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
2. Проверь, что токен в header: `Authorization: Bearer <token>`
3. Смотри `auth.service.ts` и `jwt.strategy.ts`

---

## 🎓 Полезные ссылки

- **NestJS Docs**: https://docs.nestjs.com/
- **Prisma Docs**: https://www.prisma.io/docs
- **Passport JWT**: http://www.passportjs.org/packages/passport-jwt/

---

## 📞 FAQ для AI моделей

### Q: Где основная бизнес-логика?
**A**: В `src/order/order.service.ts` (создание заказов, оплата, возвраты) и `src/cashbox/cashbox.service.ts` (кассовые операции).

### Q: Как понять, какой статус возврата будет?
**A**: Читай метод `validateReturnPayments()` в `order.service.ts` — там вся логика.

### Q: В чем разница между Payment и CashTransaction?
**A**: 
- **Payment** — связь между заказом и платежом (orderId → Payment)
- **CashTransaction** — запись в кассе (orderId → CashTransaction → Cashbox)

### Q: Почему SKU генерируется автоматически?
**A**: Для уникальности в рамках магазина. Формат: `"название-категория-атрибуты"`. См. `shared/helper/sku-generator.helper.ts`.

### Q: Можно ли продать товар со склада, к которому нет доступа?
**A**: Нет! Проверка в `order.service.ts` → `create()`: `!warehouseIds.includes(dto.warehouseId)`.

### Q: Как работает возврат с CREDIT?
**A**: Магазин фиксирует, что должен клиенту, но деньги не выданы сразу. ReturnedOrder.status = CREDIT. Когда выдадут — вручную обновляют статус на COMPLETED.

### Q: Почему AdditionalService не возвращается при возврате товара?
**A**: Бизнес-логика: доставка/упаковка уже оказана, не возвращается. См. `validateReturnPayments()` → `servicesAmount` исключается из расчета.

### Q: Как работают ручные операции с кассой?
**A**: Кассир может добавлять транзакции через `POST /cashbox/:id/transaction`:
- **INCOME**: Кто-то принес деньги, назначение неизвестно (потом связываем с заказом/долгом)
- **EXPENSE**: Расходы из кассы (возврат клиенту, личные расходы, зарплата, аренда, закупка)

**Пример**: Купил воду из кассы → EXPENSE, OTHER, amount: 20

### Q: Чем отличаются автоматические и ручные транзакции?
**A**: 
- **Автоматические**: создаются системой (оплата заказа, возврат товара, оплата долга)
- **Ручные**: создает кассир вручную через UI (неопознанные платежи, расходы)

См. `cashbox.service.ts` → `createCashTransaction()`

---

## ✅ Checklist для первой задачи

- [ ] Прочитал `QUICK_START.md` (этот файл)
- [ ] Открыл `prisma/schema.prisma` и понял схему БД
- [ ] Прочитал ключевые части `BUSINESS_LOGIC.md`
- [ ] Посмотрел `order.service.ts` — как создается заказ
- [ ] Понял разницу между Product и ProductVariant
- [ ] Понял жизненный цикл заказа (CREATED → HOLD → DEBT/COMPLETED → REFUNDED)
- [ ] Понял, что inventory списывается при оплате, а не при добавлении товаров
- [ ] Запустил проект локально и сделал тестовый запрос

**Готов к работе!** 🚀

---

**Последнее обновление**: 2026-08-15  
**Версия системы**: 1.0  
**Автор документации**: AI Assistant (Claude)
