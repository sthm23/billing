# Billing Backend — NestJS API

Backend API for **my-billing** retail POS system.

---

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start PostgreSQL (Docker)
docker-compose up -d

# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Start development server
npm run start:dev
```

Server runs at: `http://localhost:4000`

---

## 📚 Documentation

### For AI / Developers

**Start here**: [`AGENTS.md`](./AGENTS.md) — Backend development guide

**Root documentation**:
- [`../AGENTS.md`](../AGENTS.md) — Project overview
- [`../docs/INDEX.md`](../docs/INDEX.md) — Documentation index
- [`../docs/business-domain.md`](../docs/business-domain.md) — Business concepts
- [`../docs/api-map.md`](../docs/api-map.md) — API endpoints
- [`../docs/workflows/`](../docs/workflows/) — Business workflows

**Legacy documentation** (backup reference):
- [`docs/`](./docs/) — Detailed backend documentation (older, but still useful)

---

## 🛠️ Development Commands

```bash
# Development
npm run start:dev              # Hot reload mode
npm run start:debug            # With debugger

# Database
npm run prisma:generate        # Generate Prisma client (after schema changes)
npm run prisma:migrate         # Run migrations
npm run prisma:migrate-prod    # Deploy migrations (production)
npm run prisma:seed            # Seed database
npm run prisma:studio          # Open Prisma Studio (DB GUI)

# Build & Production
npm run build                  # Build to dist/
npm run start:prod             # Start production server

# Code Quality
npm run lint                   # ESLint with auto-fix
npm run format                 # Prettier formatting

# Testing
npm test                       # Unit tests
npm run test:watch             # Tests in watch mode
npm run test:cov               # Coverage report
npm run test:e2e               # End-to-end tests
```

---

## 🏗️ Project Structure

```
src/
├── auth/              # JWT authentication
├── user/              # User management
├── store/             # Store management
├── warehouse/         # Warehouse & inventory
├── product/           # Products & variants
├── order/             # Orders, payments, returns
├── cashbox/           # Cash register operations
├── debt/              # Manual debt tracking
├── category-attributes/ # Catalog (categories, brands)
├── file/              # File upload (S3)
├── prisma/            # PrismaService
└── shared/            # Guards, decorators, helpers
```

---

## 🔑 Environment Variables

Create `.env` file:

```env
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

---

## 📦 Tech Stack

- **NestJS** 10+ — Progressive Node.js framework
- **Prisma** 6 — Modern database toolkit
- **PostgreSQL** 17 — Relational database
- **Passport JWT** — Authentication
- **AWS S3** — File storage

---

## 🔗 Related Projects

- **Web Frontend**: [`../billing_ui/`](../billing_ui/)
- **Mobile App**: [`../billing-mobile/`](../billing-mobile/)

---

## 📖 Learn More

- [NestJS Documentation](https://docs.nestjs.com)
- [Prisma Documentation](https://www.prisma.io/docs)

---

## 📄 License

MIT
