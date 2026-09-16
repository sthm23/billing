# Billing Backend — NestJS API

> **Context**: Backend API for my-billing retail POS system

---

## Technology Stack

- **Framework**: NestJS 10+
- **ORM**: Prisma 6
- **Database**: PostgreSQL 17
- **Auth**: JWT (access + refresh tokens) via Passport
- **File Storage**: AWS S3 (LocalStack in dev)
- **Container**: Docker Compose for PostgreSQL

---

## Responsibility

This application is the **source of truth for business logic**.

**What backend does**:
- Enforce business rules (inventory, payments, debt)
- Authenticate and authorize users
- Validate all operations
- Maintain data integrity
- Provide REST API for clients (`billing_ui`, `billing_mobile`)

**What backend does NOT do**:
- UI/UX logic (that's for clients)
- Client-side validation (only server-side validation matters)
- Client state management

---

## Module Structure

```
src/
├── auth/              # JWT authentication (login, refresh, logout)
├── user/              # User management (CUSTOMER, STAFF)
├── admin/             # Admin operations (only ADMIN role)
├── store/             # Store management
├── warehouse/         # Warehouse management, inventory movements
├── product/           # Products and variants (SKU)
├── order/             # Order creation, payment, returns
├── payment/           # Payment to DEBT orders
├── cashbox/           # Cashbox (cash register) operations
├── debt/              # Manual debt tracking (CustomerDebt)
├── category-attributes/ # Categories, brands, attributes, tags
├── file/              # File upload (S3)
├── prisma/            # PrismaService, S3Service
└── shared/            # Guards, decorators, helpers
```

---

## Architecture Layers

### 1. Controller Layer

**Responsibility**:
- HTTP endpoints
- DTO validation via `class-validator`
- Apply guards (`AuthJWTGuard`, `RolesGuard`)
- Extract user context via `@User()` decorator
- Call service methods
- Return responses

**Example**:
```typescript
@Controller('order')
@UseGuards(AuthJWTGuard)
export class OrderController {
  @Post()
  async create(
    @Body() dto: CreateOrderDto,
    @User() user: CurrentUser
  ) {
    return this.orderService.create(dto, user);
  }
}
```

---

### 2. Service Layer

**Responsibility**:
- **Business logic** (calculations, validations, state transitions)
- Database operations via Prisma
- Transaction management (`prisma.$transaction`)
- Error handling (throw `BadRequestException`)

**Example**:
```typescript
@Injectable()
export class OrderService {
  async create(dto: CreateOrderDto, user: CurrentUser) {
    // Business validation
    if (user.staff.storeId !== dto.storeId) {
      throw new BadRequestException('Staff does not belong to store');
    }

    // Database operation
    return this.prisma.order.create({
      data: { ... }
    });
  }
}
```

---

### 3. Data Layer (Prisma)

**Location**: `prisma/schema.prisma`

**Generated client**: `generated/prisma/` (NOT `node_modules/.prisma`)

**Important**:
- Always run `npm run prisma:generate` after schema changes
- Use `@generated/enums` for enum imports (NOT `@prisma/client`)
- Use `Prisma.Decimal` for monetary values

---

## Path Aliases

Configure in `tsconfig.json`:

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

**Always use path aliases** instead of relative imports.

---

## Authentication & Authorization

### CurrentUser Type

Available in controllers via `@User()` decorator:

```typescript
type CurrentUser = User & {
  auth: AuthAccount;
  staff: Staff & {
    warehouse: { warehouseId: string }[];
  };
};
```

**Key Fields**:
- `user.id` — User ID
- `user.role` — ADMIN | OWNER | USER
- `user.type` — CUSTOMER | STAFF
- `user.staff.id` — Staff ID (use as `cashierId`, `createdBy`)
- `user.staff.storeId` — Staff's store
- `user.staff.role` — OWNER | MANAGER | SELLER | CASHIER | WAREHOUSE
- `user.staff.warehouse[]` — Assigned warehouses

---

### Guards

**AuthJWTGuard** — Validates JWT token
```typescript
@UseGuards(AuthJWTGuard)  // All routes protected by default
```

**RolesGuard** — Checks staff role
```typescript
@Roles(StaffRole.OWNER, StaffRole.MANAGER)
@UseGuards(AuthJWTGuard, RolesGuard)
```

**Public Routes**
```typescript
@Public()  // Skip AuthJWTGuard
async login() { ... }
```

---

### Authorization Patterns

**In Controller** (declarative):
```typescript
@Roles(StaffRole.OWNER, StaffRole.MANAGER)
@UseGuards(AuthJWTGuard, RolesGuard)
async updatePrice(@Body() dto: UpdatePriceDto) { ... }
```

**In Service** (imperative):
```typescript
// Check store membership
if (user.staff.storeId !== order.storeId) {
  throw new BadRequestException('Staff does not belong to store');
}

// Check warehouse access
const hasAccess = user.staff.warehouse.some(w => w.warehouseId === dto.warehouseId);
if (!hasAccess) {
  throw new BadRequestException('Staff does not have access to warehouse');
}

// Check role
if (user.role !== UserRole.OWNER && user.staff.role !== StaffRole.MANAGER) {
  throw new ForbiddenException('Insufficient permissions');
}
```

---

## Transaction Safety

**CRITICAL**: Use Prisma transactions for multi-step operations.

### Order Payment Example

```typescript
await this.prisma.$transaction(async (tx) => {
  // 1. Create payments
  await tx.payment.createMany({ data: payments });

  // 2. Create cash transactions
  await tx.cashTransaction.createMany({ data: cashTransactions });

  // 3. Deduct inventory (atomic check)
  for (const [variantId, quantity] of qtyByVariant) {
    const updated = await tx.inventory.updateMany({
      where: {
        warehouseId: order.warehouseId,
        variantId: variantId,
        quantity: { gte: quantity }  // Prevents negative stock
      },
      data: {
        quantity: { decrement: quantity }
      }
    });

    if (updated.count !== 1) {
      throw new BadRequestException('Insufficient stock');
      // Transaction automatically rolls back
    }
  }

  // 4. Create stock movements
  await tx.stockMovement.createMany({ data: movements });

  // 5. Update order
  await tx.order.update({
    where: { id: orderId },
    data: { status: newStatus, paidAmount: totalPaid }
  });

  // 6. Update cashbox
  await tx.cashbox.update({
    where: { id: cashboxId },
    data: { balance: { increment: totalPaid } }
  });
});
```

**Rule**: If ANY step fails, ENTIRE transaction rolls back.

---

## Business Rules (Critical!)

### Inventory

1. ✅ **Inventory is deducted ONLY when payment is processed** (not when items added to order)
2. ✅ **Cannot sell more than available stock** (use `updateMany` with `quantity: { gte: needed }`)
3. ✅ **Every inventory change creates StockMovement** (audit trail)
4. ✅ **Returned items restore inventory** to original warehouse

### Payment

1. ✅ **Total payments cannot exceed order total**
2. ✅ **Order can have multiple payments** (split payment: 500 cash + 300 card)
3. ✅ **Every payment creates CashTransaction** and updates Cashbox
4. ✅ **Payment to CustomerDebt uses DEBT_PAYMENT category** (not SALE)

### CashBox

1. ✅ **Each seller has their own cashbox** (per warehouse + store)
2. ✅ **Multiple cashboxes can be open simultaneously** (different sellers)
3. ✅ **Cannot add transactions to closed cashbox**
4. ✅ **Balance = INCOME - EXPENSE** (calculated automatically)

### SKU & Barcode

1. ✅ **SKU is unique per store** (`@@unique([storeId, sku])`)
2. ✅ **Barcode is globally unique** (`@@unique([barCode])`)
3. ✅ **Barcode is auto-generated** via `BarcodeSequence` table (200000000001, 200000000002, ...)

### Multi-Tenancy

1. ✅ **Staff can only access their own store's data**
2. ✅ **Staff must have warehouse access** via `StaffOnWarehouse`
3. ✅ **Products belong to warehouse** → implicitly to store
4. ✅ **Orders are scoped to store + warehouse**

---

## Common Patterns

### Creating Records with Staff Context

```typescript
async create(dto: CreateDto, user: CurrentUser) {
  // Validate staff belongs to store
  if (user.staff.storeId !== dto.storeId) {
    throw new BadRequestException('Invalid store');
  }

  return this.prisma.entity.create({
    data: {
      ...dto,
      createdById: user.staff.id,  // Use staff.id, not user.id
    }
  });
}
```

---

### Inventory Deduction (Atomic)

```typescript
// Group by variantId
const qtyByVariant = new Map<string, number>();
for (const item of orderItems) {
  const current = qtyByVariant.get(item.variantId) || 0;
  qtyByVariant.set(item.variantId, current + item.quantity);
}

// Deduct atomically
for (const [variantId, quantity] of qtyByVariant) {
  const updated = await tx.inventory.updateMany({
    where: {
      warehouseId: order.warehouseId,
      variantId: variantId,
      quantity: { gte: quantity }  // Atomic check
    },
    data: {
      quantity: { decrement: quantity }
    }
  });

  if (updated.count !== 1) {
    throw new BadRequestException(`Insufficient stock for variant ${variantId}`);
  }
}
```

---

### Error Handling

**Always throw descriptive exceptions**:

```typescript
// ✅ Good
throw new BadRequestException('Insufficient stock for variant: nike-tshirt-m-red');

// ❌ Bad
throw new BadRequestException('Invalid input');
```

**Standard exceptions**:
- `BadRequestException` — Validation errors, business rule violations
- `NotFoundException` — Entity not found
- `ForbiddenException` — Insufficient permissions
- `UnauthorizedException` — Authentication failed

---

## Development Workflow

### 1. Database Schema Changes

```bash
# Edit prisma/schema.prisma
npm run prisma:generate           # Generate Prisma client
npm run prisma:migrate            # Create and run migration
```

---

### 2. Adding New Module

**Example**: Adding a "Reports" module

1. Create module directory:
   ```bash
   mkdir src/reports
   ```

2. Create files:
   ```
   src/reports/
   ├── reports.module.ts
   ├── reports.controller.ts
   ├── reports.service.ts
   └── dto/
       └── create-report.dto.ts
   ```

3. Register in `app.module.ts`:
   ```typescript
   @Module({
     imports: [
       // ...
       ReportsModule,
     ],
   })
   ```

4. Add path alias in `tsconfig.json`:
   ```json
   "@reports/*": ["src/reports/*"]
   ```

---

### 3. Before Creating New Functionality

**Always check existing implementation first**:

1. Search for similar endpoints:
   ```bash
   grep -r "POST /order" src/
   ```

2. Find existing service methods:
   ```bash
   grep -r "createPayment" src/
   ```

3. Check existing DTOs:
   ```bash
   ls src/order/dto/
   ```

4. **Follow existing patterns** — don't introduce new architectural patterns.

---

## API Documentation

All API endpoints are documented in: `../docs/api-map.md`

**When adding/changing endpoints**:
1. Implement in backend
2. Test with Postman/curl
3. Update `../docs/api-map.md`
4. Update clients (web, mobile) if needed

---

## Testing

### Unit Tests

```bash
npm test                          # Run all tests
npm run test:watch                # Watch mode
npm run test:cov                  # Coverage report
```

**Test Files**: `*.spec.ts` co-located with source

---

### E2E Tests

```bash
npm run test:e2e                  # End-to-end tests
```

**Test Files**: `test/*.e2e-spec.ts`

---

## Environment Variables

Required in `.env`:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/billing
JWT_ACCESS_SECRET=your-secret
JWT_ACCESS_EXPIRE=15m
JWT_REFRESH_SECRET=your-refresh-secret
JWT_REFRESH_EXPIRE=7d
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_BUCKET=billing-bucket
PORT=4000
```

---

## Important Notes

### Prisma Client

- **Location**: `generated/prisma/` (not `node_modules/.prisma`)
- **Import enums**: `import { OrderStatus } from '@generated/enums'`
- **Never import from**: `@prisma/client` for enums

### Decimal Type

```typescript
import { Prisma } from '@generated/client';

const price = new Prisma.Decimal('1234.56');
```

### Staff Authorization

Most operations validate:
1. Staff belongs to correct store
2. Staff has access to warehouse (if applicable)
3. AuthAccount is active

### Inventory Safety

```typescript
// ✅ Correct — atomic check
await prisma.inventory.updateMany({
  where: { variantId, quantity: { gte: needed } },
  data: { quantity: { decrement: needed } }
});

// ❌ Wrong — race condition
const current = await prisma.inventory.findFirst({ where: { variantId } });
if (current.quantity >= needed) {
  await prisma.inventory.update({ 
    data: { quantity: current.quantity - needed }
  });
}
```

---

## Related Documentation

- **Root entry point**: `../AGENTS.md`
- **Business concepts**: `../docs/business-domain.md`
- **API map**: `../docs/api-map.md`
- **Database schema**: `../docs/data-model.md`
- **Workflows**: `../docs/workflows/`
- **Detailed backend docs**: `docs/` (legacy, for reference)

---

## Quick Commands

```bash
# Development
npm run start:dev                 # Hot reload

# Database
docker-compose up -d              # Start PostgreSQL
npm run prisma:generate           # Generate client
npm run prisma:migrate            # Run migrations
npm run prisma:seed               # Seed database
npm run prisma:studio             # Open Prisma Studio

# Code Quality
npm run lint                      # ESLint
npm run format                    # Prettier
npm test                          # Tests
```

---

**Remember**: This backend is the **single source of truth**. Clients should never implement business logic that belongs here.
