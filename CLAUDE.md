# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **NestJS-based billing/POS system** for managing retail stores, warehouses, inventory, orders, and payments. The application uses:
- **Prisma ORM** with PostgreSQL
- **JWT authentication** with access/refresh tokens
- **AWS S3** for file storage
- **Docker Compose** for PostgreSQL database

## Core Domain Model

The system is organized around these key concepts:

### Multi-tenancy
- **Store**: Top-level entity that owns warehouses, staff, customers, and products
- **Staff**: Users who work at stores with specific roles (OWNER, SELLER, MANAGER, CASHIER, WAREHOUSE)
- **Customer**: Users who make purchases at stores

### Inventory Management
- **Product**: Base product information (name, description, category, brand)
- **ProductVariant**: Specific SKU with price and barcode (unique per store)
- **Inventory**: Tracks quantity of each variant in each warehouse
- **StockMovement**: Audit trail of all inventory changes (IN/OUT with reasons: PURCHASE, SALE, ADJUSTMENT, RETURN)

### Order Flow
Orders follow a multi-stage lifecycle:
1. **CREATED**: New order created by staff
2. **HOLD**: Items added to order, total calculated, ready for payment
3. **DEBT**: Partial payment received (paidAmount < totalAmount)
4. **COMPLETED**: Fully paid (paidAmount >= totalAmount)
5. **CANCELLED**: Order cancelled (only allowed before payment)
6. **REFUNDED**: Order returned

### Returns
- Returns create a **ReturnedOrder** linked to the original Order
- Return status can be DEBT, CREDIT, or COMPLETED depending on payment reconciliation
- Returned items automatically increment inventory and create IN stock movements

## Development Commands

```bash
# Install dependencies
npm install

# Development
npm run start:dev          # Start with hot reload
npm run start:debug        # Start with debugger

# Build & Production
npm run build
npm run start:prod         # Run production build

# Database
npm run prisma:generate    # Generate Prisma client
npm run prisma:migrate     # Run migrations
npm run prisma:seed        # Seed database (if seed script exists)

# Code Quality
npm run lint               # ESLint with auto-fix
npm run format             # Prettier formatting

# Testing
npm test                   # Run unit tests
npm run test:watch         # Run tests in watch mode
npm run test:cov           # Generate coverage report
npm run test:e2e           # Run end-to-end tests
```

## Database Setup

```bash
# Start PostgreSQL via Docker
docker-compose up -d

# Generate Prisma client after schema changes
npm run prisma:generate

# Apply migrations
npm run prisma:migrate
```

The Prisma client is generated to `generated/prisma` (not default `node_modules/.prisma`).

## Architecture Patterns

### Path Aliases
TypeScript paths are configured for clean imports:
```typescript
@auth/*          // src/auth
@user/*          // src/user
@product/*       // src/product
@warehouse/*     // src/warehouse
@order/*         // src/order
@payment/*       // src/payment
@admin/*         // src/admin
@shared/*        // src/shared
@prisma/*        // src/prisma
@generated/*     // generated/prisma (Prisma types & enums)
```

### Authentication & Authorization
- **JWT Strategy**: Access tokens validated via `JwtStrategy` (passport strategy: `jwt-access`)
- **Guards**:
  - `AuthJWTGuard`: Requires valid JWT token
  - `RolesGuard`: Checks user/staff roles via `@Roles()` decorator
  - `PublicGuard`: Bypasses auth with `@Public()` decorator
- **User Context**: Controllers receive `CurrentUser` via `@User()` decorator, which includes:
  - User base info (id, role, type)
  - Staff info (if UserType.STAFF): storeId, role, warehouse assignments
  - Auth account status

### Transaction Safety
Critical operations use Prisma transactions:
- **Order creation with payments**: Validates inventory, creates order items, processes payments, decrements inventory atomically
- **Stock movements**: Ensures inventory updates and movement logs are consistent
- **Returns**: Handles complex refund logic, payment reconciliation, and inventory restoration

### Validation Rules
- **Inventory**: Orders cannot exceed available warehouse stock
- **SKU uniqueness**: ProductVariant SKU must be unique within a store
- **Barcode uniqueness**: Barcodes are globally unique (auto-generated via BarcodeSequence table)
- **Payment validation**: Total payments cannot exceed order total
- **Return validation**: Return quantities cannot exceed original order quantities

## Key Service Logic

### WarehouseService
- `stockIn()`: Receives new inventory, creates/updates Inventory records, logs StockMovement
- Validates that staff belongs to the warehouse

### OrderService
- `create()`: Creates empty order in CREATED status
- `createOrderItems()`: Adds items to order, validates stock availability, transitions to HOLD status
- `createPayment()`: Processes payments, decrements inventory via StockMovement, transitions to COMPLETED or DEBT
- `createReturn()`: Complex return logic that calculates refund status based on original order status (COMPLETED vs DEBT) and payment reconciliation

### ProductService (inferred)
- Manages products with variants
- Variants have unique SKU per store and globally unique barcodes
- Products can have multiple attributes (filters) and tags

## Important Notes

- **Prisma transactions**: Use `prisma.$transaction()` for multi-step operations that must be atomic
- **Enum imports**: Import enums from `@generated/enums` (not from `@prisma/client`)
- **Decimal handling**: Use `Prisma.Decimal` for monetary values (price, amount, cost)
- **Staff authorization**: Most operations check if user is staff and belongs to the correct store/warehouse
- **Inventory decrements**: Use `updateMany` with `where: { quantity: { gte: needed } }` to prevent negative inventory
- **Error handling**: Services throw `BadRequestException` with error messages from try-catch blocks

## Configuration

Environment variables are loaded via `@nestjs/config` (global module). Key variables:
- `DATABASE_URL`: PostgreSQL connection string
- `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRE`: Access token configuration
- `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRE`: Refresh token configuration
- `AWS_*`: AWS S3 credentials and bucket configuration
- `PORT`: Application port (default: 4000)

## Testing Strategy

- Unit tests: `*.spec.ts` files co-located with source files
- E2E tests: `test/app.e2e-spec.ts`
- Jest configuration in `package.json` with `rootDir: "src"`
- Coverage reports generated to `coverage/` directory
