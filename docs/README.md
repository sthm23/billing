# Billing System — Comprehensive Documentation

> **Полная документация** для multi-tenant POS системы управления розничными магазинами

---

## 📖 О документации

Эта папка содержит **comprehensive документацию** для всех участников разработки:
- **AI модели** (Claude, GPT, и др.)
- Разработчики
- Архитекторы
- QA инженеры
- Product owners

Вся документация структурирована и разбита на специализированные файлы для удобства навигации.

---

## 🚀 С чего начать?

### Для AI моделей
**[QUICK_START.md](QUICK_START.md)** — начните отсюда!

Этот документ содержит:
- Краткий обзор проекта
- Структуру кодовой базы
- Ключевые концепции (multi-tenancy, warehouse-centric, Product vs ProductVariant)
- Частые задачи с примерами кода
- Debugging tips
- FAQ для AI моделей
- Checklist для первой задачи

### Для разработчиков
1. Прочитайте **[QUICK_START.md](QUICK_START.md)**
2. Изучите **[ARCHITECTURE.md](ARCHITECTURE.md)**
3. Посмотрите **[WORKFLOWS.md](WORKFLOWS.md)** для понимания бизнес-процессов
4. При работе с API используйте **[API_MODULES.md](API_MODULES.md)**

### Для product owners
1. **[BUSINESS_LOGIC.md](BUSINESS_LOGIC.md)** — подробное описание всех бизнес-процессов
2. **[WORKFLOWS.md](WORKFLOWS.md)** — пошаговые сценарии использования
3. **[API_MODULES.md](API_MODULES.md)** — что может делать система

---

## 📚 Структура документации

### 1️⃣ [QUICK_START.md](QUICK_START.md)
**Быстрый старт для новых участников**

- 🎯 Что это за проект
- 📋 Структура проекта
- 🔑 Ключевые концепции
- 🧩 Path Aliases
- 🔒 Авторизация и права
- 💡 Частые задачи
- ⚠️ Важные правила
- 📚 Куда смотреть дальше
- 🧪 Как запустить проект
- 🐛 Debugging tips
- 📞 FAQ

**Читать время**: 15-20 минут  
**Must read для**: всех новых участников

---

### 2️⃣ [ARCHITECTURE.md](ARCHITECTURE.md)
**Архитектура и технический дизайн**

- 🔍 Обзор системы
- 🛠️ Технологический стек
- 🏛️ Архитектурные принципы
  - Multi-tenancy на уровне Store
  - Warehouse-centric подход
  - Транзакционная безопасность
  - Аудит всех операций
- 📁 Структура модулей
- 🔄 Слои приложения (Controller → Service → Data → Shared)
- 🔐 Authentication Flow
- 🛡️ Authorization via Guards
- ⚙️ Конфигурация
- 🚀 Deployment
- 📈 Масштабирование
- 🔒 Безопасность

**Читать время**: 30-40 минут  
**Must read для**: архитекторов, senior разработчиков

---

### 3️⃣ [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md) ⭐
**Подробная бизнес-логика — MUST READ!**

#### Жизненный цикл заказа
- Создание заказа (CREATED)
- Добавление товаров (HOLD)
- Оплата (DEBT / COMPLETED)
- Отмена заказа

#### Управление кассой (Cashbox)
- Концепция: разделение доходов разных продавцов
- Открытие/закрытие кассы
- Автоматические транзакции (продажа, возврат, оплата долга)
- **Ручные транзакции**:
  - Прием неопознанных платежей (INCOME, OTHER)
  - Расходы из кассы (возврат клиенту, личные расходы, зарплата, аренда)
- Автоматическое создание
- Несколько касс одновременно

#### Возврат товаров
- Концепция (DEBT, CREDIT, COMPLETED)
- Бизнес-сценарии:
  - Частичный возврат (клиент должен)
  - Возврат с кредитом (магазин должен)
  - Возврат с полным расчетом
  - Возврат с выдачей денег
- Что происходит при возврате (транзакция)
- Валидация возврата

#### Управление долгами
- Order Debt vs CustomerDebt
- Создание старого долга
- Оплата старого долга

#### Управление инвентарем
- Inventory (остатки)
- StockMovement (аудит)
- Типы движений (PURCHASE, SALE, RETURN, ADJUSTMENT)
- Атомарное списание

#### Роли и права доступа
- User Roles (ADMIN, OWNER, USER)
- Staff Roles (OWNER, MANAGER, SELLER, CASHIER, WAREHOUSE)
- Текущая реализация
- Проверка прав в коде

#### Товары и варианты
- Product vs ProductVariant
- Создание товара
- Создание вариантов
- Уникальность (SKU, Barcode)
- Архивирование, обновление цены, поиск

#### AdditionalService
- Концепция (доп. услуги к заказу)
- Учет в totalAmount
- Влияние на возвраты

#### Ключевые правила бизнес-логики

**Читать время**: 1-1.5 часа  
**Must read для**: всех! Это сердце системы

---

### 4️⃣ [DATABASE.md](DATABASE.md)
**Детальная схема базы данных**

- 🗂️ Обзор (СУБД, ORM, принципы)
- 👤 Auth & Users (User, AuthAccount, RefreshSession)
- 🏢 Stores & Staff (Store, Customer, Staff, StaffOnWarehouse)
- 🏭 Warehouses
- 📦 Products & Variants (Brand, Product, ProductVariant, ProductImage, BarcodeSequence)
- 📊 Inventory (Inventory, StockMovement)
- 🛒 Orders & Sales (Order, OrderItem, AdditionalService)
- ↩️ Returns (ReturnedOrder, ReturnItem, ReturnPayment)
- 💳 Payments (Payment)
- 💰 Cashbox (Cashbox, CashTransaction)
- 📉 Debts (CustomerDebt, DebtPayment)
- 📑 Catalog (Category, Brand, Attribute, Tag)
- 🏷️ Все Enums (14 enums)
- 🔍 Индексы и ограничения
- 📝 Полезные SQL запросы

**Читать время**: 1 час  
**Must read для**: backend разработчиков, DBA

---

### 5️⃣ [API_MODULES.md](API_MODULES.md)
**Полная документация API**

Все endpoints с примерами request/response:

1. **Auth Module** (login, signup, refresh, logout, me)
2. **Order Module** (create, add items, pay, return, search, findOne, cancel)
3. **Cashbox Module** (open, close, transaction, list)
4. **Product Module** (create, variant, list, search, update price, archive)
5. **Warehouse Module** (create, inventory movement, list)
6. **Debt Module** (create debt, payment, list)
7. **User Module** (create, list)
8. **Store Module** (create, list)
9. **Category Attributes Module** (category, attribute, attribute value)
10. **File Module** (upload to S3)

**Формат**: Request → Response → Что происходит → Errors

**Читать время**: 2 часа (справочник)  
**Must read для**: frontend разработчиков, QA, API интеграторов

---

### 6️⃣ [WORKFLOWS.md](WORKFLOWS.md)
**Пошаговые бизнес-процессы**

#### 1. Регистрация и авторизация
- Регистрация клиента
- Создание сотрудника
- Вход в систему
- Обновление токена

#### 2. Настройка магазина
- Создание магазина
- Создание склада
- Назначение сотрудника на склад

#### 3. Управление товарами
- Добавление нового товара
- Приход товара (закупка)
- Корректировка остатков (инвентаризация)

#### 4. Продажа товара
- Полная оплата наличными (простой case)
- Частичная оплата (долг)
- Покупка с доп. услугой

#### 5. Возврат товара
- Полный возврат (заказ был полностью оплачен)
- Частичный возврат (клиент был в долгу)
- Возврат с кредитом (магазин должен клиенту)

#### 6. Управление долгами
- Оплата долга по заказу
- Создание старого долга
- Оплата старого долга

#### 7. Отчеты и аналитика (будущее)

#### 8. Типичные сценарии ошибок

#### 9. Интеграция с внешними системами (будущее)

**Читать время**: 1.5 часа  
**Must read для**: QA, product owners, frontend разработчиков

---

### 7️⃣ [CLAUDE.md](CLAUDE.md)
**Навигация по документации**

Краткая справка со ссылками на все документы.

**Читать время**: 5 минут  
**Must read для**: всех (как оглавление)

---

## 🎓 Рекомендуемый порядок изучения

### Для AI моделей
1. **QUICK_START.md** (обязательно)
2. **BUSINESS_LOGIC.md** (обязательно)
3. `prisma/schema.prisma` (просмотр)
4. **API_MODULES.md** (по необходимости)
5. **WORKFLOWS.md** (по необходимости)

### Для новых разработчиков
1. **QUICK_START.md**
2. **ARCHITECTURE.md**
3. **BUSINESS_LOGIC.md** (ключевые части)
4. `src/order/order.service.ts` (код)
5. **WORKFLOWS.md** (основные сценарии)

### Для архитекторов
1. **ARCHITECTURE.md**
2. **DATABASE.md**
3. **BUSINESS_LOGIC.md**
4. **API_MODULES.md**

### Для QA
1. **QUICK_START.md**
2. **WORKFLOWS.md**
3. **API_MODULES.md**
4. **BUSINESS_LOGIC.md** (по необходимости)

### Для product owners
1. **BUSINESS_LOGIC.md**
2. **WORKFLOWS.md**
3. **API_MODULES.md** (что может система)

---

## 📊 Метрики документации

| Документ | Размер | Время чтения | Категория |
|----------|--------|--------------|-----------|
| QUICK_START.md | ~10 KB | 15-20 мин | Must read |
| ARCHITECTURE.md | ~15 KB | 30-40 мин | Must read |
| BUSINESS_LOGIC.md | ~40 KB | 1-1.5 часа | **Must read** |
| DATABASE.md | ~35 KB | 1 час | Reference |
| API_MODULES.md | ~30 KB | 2 часа | Reference |
| WORKFLOWS.md | ~25 KB | 1.5 часа | Tutorial |
| CLAUDE.md | ~5 KB | 5 мин | Navigation |

**Всего**: ~160 KB текста, ~6.5 часов для полного изучения

---

## 🔄 Обновление документации

### Когда обновлять?
- При добавлении новых фич
- При изменении бизнес-логики
- При рефакторинге архитектуры
- При обнаружении неточностей

### Как обновлять?
1. Определите, какой документ затронут
2. Обновите соответствующий раздел
3. Проверьте связанные документы (могут быть перекрестные ссылки)
4. Обновите дату "Последнее обновление" в конце документа

### Правила написания
- **Ясность**: пишите простым языком, избегайте жаргона
- **Структура**: используйте заголовки, списки, таблицы
- **Примеры**: всегда добавляйте примеры кода/JSON
- **Актуальность**: проверяйте код перед документированием
- **Полнота**: объясняйте "почему", а не только "как"

---

## 🆘 Поддержка

### Нашли ошибку в документации?
1. Создайте issue в репозитории
2. Укажите название документа и раздел
3. Опишите, что неверно и как должно быть

### Нужна дополнительная документация?
1. Создайте issue с пометкой "documentation"
2. Опишите, какой раздел не хватает
3. Укажите, для кого эта документация (AI, разработчики, QA)

---

## 📜 История изменений

### 2026-08-15 — Initial Release
**Автор**: AI Assistant (Claude)

Создана comprehensive документация:
- ✅ QUICK_START.md — быстрый старт для новых участников
- ✅ ARCHITECTURE.md — архитектура и технический дизайн
- ✅ BUSINESS_LOGIC.md — подробная бизнес-логика
- ✅ DATABASE.md — детальная схема БД
- ✅ API_MODULES.md — полная документация API
- ✅ WORKFLOWS.md — пошаговые бизнес-процессы
- ✅ CLAUDE.md — навигация по документации
- ✅ README.md — этот файл

**Покрытие**: 100% существующего функционала

---

## 🙏 Благодарности

Эта документация создана с помощью:
- Claude (Anthropic) — AI Assistant
- Команды разработки billing system
- Бизнес-аналитиков, описавших требования

---

**Последнее обновление**: 2026-08-15  
**Версия документации**: 1.0  
**Версия системы**: 1.0  
**Автор**: AI Assistant (Claude)

---

**[⬆ Вернуться к началу](#billing-system--comprehensive-documentation)**
