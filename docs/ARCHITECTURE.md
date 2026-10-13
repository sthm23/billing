# Архитектура Billing System

## Обзор

**Billing System** — это multi-tenant система управления розничными магазинами (POS/Billing система) построенная на NestJS, предназначенная для управления:
- Складами и инвентарем
- Продажами и заказами
- Платежами и кассами
- Возвратами товаров
- Долгами клиентов
- Персоналом и правами доступа

## Технологический стек

### Backend
- **Framework**: NestJS 10+
- **ORM**: Prisma 6
- **Database**: PostgreSQL 17
- **Authentication**: JWT (access + refresh tokens) via Passport
- **File Storage**: AWS S3 (через LocalStack в dev)
- **Container**: Docker Compose для PostgreSQL

### Инструменты разработки
- **TypeScript**: 5.1+
- **Package Manager**: npm
- **Linting**: ESLint
- **Formatting**: Prettier
- **Testing**: Jest

## Архитектурные принципы

### 1. Multi-tenancy на уровне Store
Каждый `Store` (магазин) — изолированная бизнес-единица:
- Имеет собственные склады (`Warehouse`)
- Персонал (`Staff`) работает только в рамках своего магазина
- Товары (`Product`) привязаны к конкретному складу конкретного магазина
- Клиенты (`Customer`) могут быть связаны с несколькими магазинами

### 2. Warehouse-centric подход
- **Каждый товар принадлежит конкретному складу**
- Продавец может работать только на складах, к которым у него есть доступ (`StaffOnWarehouse`)
- Инвентарь (`Inventory`) учитывается по связке `warehouseId + variantId`
- Заказы создаются в контексте конкретного склада

### 3. Транзакционная безопасность
Критические операции обернуты в Prisma transactions:
- **Создание заказа с оплатой**: валидация остатков → создание order items → списание inventory → создание платежей → обновление cashbox
- **Возврат товара**: создание return order → возврат inventory → создание refund → обновление cashbox → изменение статуса заказа
- **Оплата долга**: создание payment → создание cash transaction → обновление cashbox → изменение статуса долга

### 4. Аудит всех операций
Каждое изменение инвентаря логируется через `StockMovement`:
- **IN**: приход товара (PURCHASE), возврат от клиента (RETURN), корректировка (ADJUSTMENT)
- **OUT**: продажа (SALE), корректировка (ADJUSTMENT)

Все денежные операции логируются через `CashTransaction`:
- **INCOME**: продажа (SALE), оплата долга (DEBT_PAYMENT)
- **EXPENSE**: возврат денег (RETURN), аренда (RENT), зарплата (SALARY), закупка (PURCHASE)

### 5. Path Aliases для чистого кода
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
@generated/*     → generated/prisma
```

## Структура модулей

```
src/
├── auth/              # Аутентификация (JWT, login, refresh, logout)
├── user/              # Управление пользователями (CUSTOMER, STAFF)
├── admin/             # Административные операции (только ADMIN)
├── store/             # Управление магазинами
├── warehouse/         # Управление складами, приход товара
├── product/           # Товары и варианты (SKU)
├── order/             # Создание заказов, возвраты
├── payment/           # Платежи по заказам
├── cashbox/           # Кассы, денежные транзакции
├── debt/              # Ручной учет старых долгов (CustomerDebt)
├── category-attributes/ # Категории и фильтры товаров
├── file/              # Загрузка файлов (S3)
├── prisma/            # PrismaService, S3Service
└── shared/            # Guards, decorators, helpers
```

## Слои приложения

### 1. Controller Layer
- HTTP endpoints
- Validation через DTOs + `class-validator`
- Guards: `AuthJWTGuard`, `RolesGuard`
- Decorators: `@User()` для получения `CurrentUser`

### 2. Service Layer
- Бизнес-логика
- Работа с Prisma
- Транзакции
- Error handling (throw `BadRequestException`)

### 3. Data Layer (Prisma)
- ORM queries
- Transaction management
- Generated types из schema.prisma

### 4. Shared Layer
- Guards: проверка прав доступа
- Decorators: `@User()`, `@Public()`, `@Roles()`
- Helpers: SKU generator, barcode generator, hashing

## Ключевые паттерны

### Authentication Flow
1. **Login** (POST /login):
   - Валидация через `LocalAuthGuard` (username/password)
   - Генерация access + refresh tokens
   - Refresh token сохраняется в `RefreshSession` (с хешем)
   - Refresh token возвращается в httpOnly cookie
   - Access token возвращается в response body

2. **Refresh** (GET /refresh):
   - Извлечение refresh token из cookie
   - Валидация через `TokenService.validateRefreshToken()`
   - Генерация новой пары токенов (rotation)
   - Старая сессия помечается `isRevoked: true`

3. **Protected routes**:
   - `@UseGuards(AuthJWTGuard)` на контроллере/методе
   - `@User()` decorator для получения `CurrentUser`
   - `CurrentUser` включает: `User` + `AuthAccount` + `Staff` (с storeId, role, warehouse)

### Authorization via Guards

**RolesGuard** проверяет роль через `@Roles()` decorator:
```typescript
@Roles(StaffRole.OWNER, StaffRole.MANAGER)
@UseGuards(AuthJWTGuard, RolesGuard)
async updatePrice(@Body() dto: UpdatePriceDto) { ... }
```

**Staff context validation** в сервисах:
```typescript
if (user.staff.storeId !== order.storeId) {
  throw new BadRequestException('Staff does not belong to the store');
}
if (!user.staff.warehouse.find(w => w.warehouseId === warehouseId)) {
  throw new BadRequestException('Staff does not have access to this warehouse');
}
```

### Error Handling
- Сервисы бросают `BadRequestException` с описанием ошибки
- `try/catch` блоки обрабатывают Prisma ошибки
- Все ошибки логируются и возвращаются клиенту в формате:
  ```json
  {
    "statusCode": 400,
    "message": "Insufficient stock for variant: xxx",
    "error": "Bad Request"
  }
  ```

## Конфигурация

### Environment Variables (.env)
```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/billing

# JWT
JWT_ACCESS_SECRET=your-secret-key
JWT_ACCESS_EXPIRE=15m
JWT_REFRESH_SECRET=your-refresh-secret
JWT_REFRESH_EXPIRE=7d

# AWS S3 (LocalStack in dev)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_BUCKET=billing-bucket

# Server
PORT=4000
NODE_ENV=development
```

### Prisma Configuration
- **Output**: `generated/prisma` (не дефолтный `node_modules/.prisma`)
- **Module format**: CommonJS (`moduleFormat = "cjs"`)
- **Enums**: импортируются из `@generated/enums`

## Deployment

### Development
```bash
docker-compose up -d              # PostgreSQL
npm run prisma:generate           # Generate Prisma client
npm run prisma:migrate            # Run migrations
npm run start:dev                 # Hot reload mode
```

### Production
```bash
npm run build                     # Build to dist/
npm run prisma:migrate-prod       # Deploy migrations
npm run start:prod                # Start production server
```

### Scripts
- `deploy.sh` — деплой на VPS
- `backup-db.sh` — бэкап PostgreSQL
- `restore-db.sh` — восстановление из бэкапа

## Масштабирование

### Текущая архитектура
- Monolithic NestJS application
- Single PostgreSQL instance
- S3 для файлов (легко масштабируется)

### Потенциальные улучшения
1. **Read replicas** для PostgreSQL (отчеты, аналитика)
2. **Redis** для кэширования frequently accessed данных (категории, бренды)
3. **Queue system** (Bull/BullMQ) для асинхронных задач (генерация отчетов, отправка уведомлений)
4. **Microservices** разделение на:
   - Auth Service
   - Catalog Service (products, inventory)
   - Order Service
   - Payment Service
   - Reporting Service

## Безопасность

### Реализовано
- ✅ JWT токены (access short-lived, refresh long-lived)
- ✅ Password hashing (bcrypt)
- ✅ Refresh token rotation
- ✅ HttpOnly cookies для refresh token
- ✅ Role-based access control (RBAC)
- ✅ Store/Warehouse isolation
- ✅ SQL injection защита (Prisma parameterized queries)

### Рекомендации для production
- [ ] Rate limiting (express-rate-limit)
- [ ] CORS configuration (whitelist allowed origins)
- [ ] Helmet.js для security headers
- [ ] HTTPS only
- [ ] Audit logging для критических операций
- [ ] Encryption at rest для sensitive данных
