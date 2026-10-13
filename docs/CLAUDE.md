# CLAUDE.md — Legacy Documentation Index

> ⚠️ **DEPRECATED**: This documentation is kept for reference only.
> 
> **New documentation structure** (2026-09-16):
> - **Start here**: [`../../AGENTS.md`](../../AGENTS.md) — Project entry point
> - **Documentation**: [`../../docs/`](../../docs/) — Workflows, API map, business domain
> - **Backend guide**: [`../AGENTS.md`](../AGENTS.md) — Backend development

This folder contains **legacy detailed documentation** that may still be useful for reference.

---

## 📚 Legacy Documentation Files

## 📚 Полная документация проекта

Этот файл служит **оглавлением** для comprehensive документации billing system. Все детали вынесены в отдельные специализированные документы.

### 🎯 Быстрый старт
**[QUICK_START.md](QUICK_START.md)** — начните отсюда!
- Что это за проект
- Структура кодовой базы
- Ключевые концепции
- Частые задачи
- Checklist для первой задачи

### 🏗️ Архитектура
**[ARCHITECTURE.md](ARCHITECTURE.md)** — общая картина системы
- Технологический стек
- Архитектурные принципы (multi-tenancy, warehouse-centric)
- Структура модулей
- Слои приложения (Controller → Service → Data)
- Path aliases
- Конфигурация и deployment
- Масштабирование и безопасность

### 💼 Бизнес-логика
**[BUSINESS_LOGIC.md](BUSINESS_LOGIC.md)** — **MUST READ!**
- Жизненный цикл заказа (CREATED → HOLD → DEBT/COMPLETED → REFUNDED)
- Управление кассой (Cashbox)
- Возврат товаров (DEBT, CREDIT, COMPLETED статусы)
- Управление долгами (Order Debt vs CustomerDebt)
- Управление инвентарем (StockMovement, Inventory)
- Роли и права доступа
- Товары и варианты (Product vs ProductVariant)
- AdditionalService (доп. услуги)
- Ключевые правила бизнес-логики

### 🗂️ База данных
**[DATABASE.md](DATABASE.md)** — детальная схема
- Auth & Users
- Stores & Staff
- Warehouses
- Products & Variants
- Inventory & StockMovement
- Orders & Sales
- Returns (ReturnedOrder, ReturnItem, ReturnPayment)
- Payments & Cashbox
- Debts (CustomerDebt, DebtPayment)
- Catalog (Category, Brand, Attribute, Tag)
- Все Enums
- Индексы и ограничения
- Полезные SQL запросы

### 🌐 API Reference
**[API_MODULES.md](API_MODULES.md)** — полная документация API
- Auth Module (login, signup, refresh, logout, me)
- Order Module (create, add items, pay, return, search)
- Cashbox Module (open, close, transactions)
- Product Module (create, variants, search, update price)
- Warehouse Module (create, inventory movement)
- Debt Module (create debt, payment)
- User Module, Store Module
- Category Attributes Module
- File Module (S3 upload)

### 📋 Workflows
**[WORKFLOWS.md](WORKFLOWS.md)** — пошаговые сценарии
- Регистрация и авторизация
- Настройка магазина (store, warehouse, staff)
- Управление товарами (создание, приход, корректировка)
- Продажа товара (основной flow)
- Продажа с частичной оплатой (долг)
- Продажа с доп. услугами
- Возврат товара (полный, частичный, с кредитом)
- Управление долгами
- Типичные ошибки

---

## ⚡ Краткая справка

### Project Overview
**Billing System** — multi-tenant POS система для управления розничными магазинами.

**Ключевые фичи**:
- Управление складами и инвентарем
- Продажа товаров через POS
- Поддержка долгов (частичная оплата)
- Возврат товаров с кредитом/дебетом
- Управление кассами (каждый продавец — своя касса)
- Полный аудит операций (StockMovement, CashTransaction)

### Tech Stack
- **Backend**: NestJS 10+ + Prisma 6 + PostgreSQL 17
- **Auth**: JWT (access + refresh tokens) via Passport
- **Storage**: AWS S3 (LocalStack в dev)
- **Container**: Docker Compose

### Path Aliases
```typescript
@auth/*       → src/auth
@order/*      → src/order      // САМЫЙ ВАЖНЫЙ модуль!
@cashbox/*    → src/cashbox
@product/*    → src/product
@warehouse/*  → src/warehouse
@debt/*       → src/debt
@shared/*     → src/shared
@prisma/*     → src/prisma
@generated/*  → generated/prisma
```

### Development Commands
```bash
# Setup
docker-compose up -d              # PostgreSQL
npm install
npm run prisma:generate           # Generate Prisma client
npm run prisma:migrate            # Run migrations

# Development
npm run start:dev                 # Hot reload mode

# Build & Production
npm run build
npm run start:prod

# Testing
npm test                          # Unit tests
npm run test:e2e                  # E2E tests
npm run test:cov                  # Coverage
```

### Key Concepts

**Multi-tenancy через Store**:
- Каждый Store имеет свои Warehouse, Staff, Product, Customer
- Staff работает только в своем Store
- Товары привязаны к конкретному Warehouse

**Product vs ProductVariant**:
- Product — логический товар ("Футболка Nike")
- ProductVariant — конкретный SKU ("Футболка Nike M Красная", barcode: "200000000001")

**Order Lifecycle**:
```
CREATED → HOLD → [DEBT | COMPLETED] → [REFUNDED | CANCELLED]
```

**ВАЖНО**: Inventory списывается ТОЛЬКО при оплате (не при добавлении товаров)!

**Два типа долгов**:
- Order Debt — долг по заказу (Order.status = DEBT)
- CustomerDebt — старые долги ДО внедрения системы

**Cashbox**:
- Каждый продавец открывает свою кассу
- Несколько касс могут быть открыты одновременно
- После закрытия нельзя добавлять транзакции

### Important Rules
1. Inventory списывается ТОЛЬКО при оплате
2. Всегда используй транзакции для многошаговых операций
3. Decimal для денег: `new Prisma.Decimal(value)`
4. Enum imports: только из `@generated/enums`
5. Проверяй права: staff.storeId, staff.warehouse
6. Логируй всё: StockMovement, CashTransaction
7. Barcode уникален глобально, SKU — в рамках магазина

---

## 📞 Support

- **NestJS Docs**: https://docs.nestjs.com/
- **Prisma Docs**: https://www.prisma.io/docs
- **Issues**: Создавайте issue в репозитории

---

**Последнее обновление**: 2026-08-15  
**Версия системы**: 1.0  
**Автор документации**: AI Assistant (Claude)
