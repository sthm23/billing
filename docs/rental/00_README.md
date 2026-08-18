# 📚 Rental System Documentation Index

**Дата создания**: 2026-08-18  
**Статус**: ✅ Полная архитектура готова к реализации  
**Версия**: 1.0

---

## 📖 Структура документации

### 1. **01_RENTAL_ARCHITECTURE.md** 📐
**Архитектура и обзор системы**

Содержит:
- ✅ Ключевые концепции аренды
- ✅ Структуру всех новых таблиц (RentalRate, Rental, RentalDeposit, Reservation, InventoryItem)
- ✅ Модификации существующих таблиц
- ✅ Новые ENUMS
- ✅ Диаграммы связей
- ✅ Интеграция с существующей системой
- ✅ Безопасность и валидация

**Для кого**: Архитекторы, tech leads, разработчики (перед началом работы)

---

### 2. **02_RENTAL_BUSINESS_LOGIC.md** 📖
**Бизнес-процессы и workflow сценарии**

Содержит 9 полных сценариев:
1. ✅ Создание аренды в заказе
2. ✅ Платеж за аренду с залогом
3. ✅ Возврат товара в нормальном состоянии
4. ✅ Возврат поврежденного товара
5. ✅ Ранний возврат товара
6. ✅ Продление аренды
7. ✅ Товар не возвращен (LATE/LOST)
8. ✅ Бронирование товара
9. ✅ Клиент решил купить арендованный товар

**Для каждого сценария**:
- Входные данные
- Пошаговый процесс (Prisma модели)
- Результат
- SQL примеры

**Для кого**: Backend разработчики, QA, product managers

---

### 3. **03_RENTAL_IMPLEMENTATION_PLAN.md** 🚀
**Детальный план реализации**

Содержит:
- ✅ Timeline (4-5 недель)
- ✅ 7 фаз разработки:
  - Phase 1: Database Schema
  - Phase 2: Core Services
  - Phase 3: Order Integration
  - Phase 4: Rental Operations
  - Phase 5: Controllers & Endpoints
  - Phase 6: Validations & Error Handling
  - Phase 7: Testing

**Для каждой фазы**:
- Что нужно создать/модифицировать
- Основные методы services
- DTOs и validators
- Tests

**Для кого**: Project managers, tech leads, разработчики

---

### 4. **04_RENTAL_DB_SCHEMA.md** 🗄️
**Подробная схема БД**

Содержит:
- ✅ Все новые таблицы (со всеми полями)
- ✅ Модификации существующих таблиц
- ✅ Все ENUMS
- ✅ Constraints и проверки
- ✅ Индексы
- ✅ Примеры данных
- ✅ SQL примеры для отчетов

**Для кого**: Database architects, backend разработчики

---

### 5. **05_RENTAL_API_SPECS.md** 📡
**API Specification**

Содержит:
- ✅ 15+ endpoints с полной документацией
- ✅ Request/Response примеры
- ✅ Query параметры и фильтрацию
- ✅ Error коды и сообщения
- ✅ Полный пример сценария

**Endpoints**:
- Rental Management (6 endpoints)
- Rental Tariffs (4 endpoints)
- Reservations (4 endpoints)
- Availability Check (1 endpoint)

**Для кого**: Frontend разработчики, мобильные разработчики, QA

---

## 🎯 Краткое резюме

### Что было реализовано в документации

```
ARCHITECTURE
├── 5 новых таблиц (rental_rates, rentals, rental_deposits, reservations, inventory_items)
├── 4 модифицированные таблицы (product_variants, order_items, stock_movements, cash_transactions)
├── 7 новых ENUMS
└── Полные диаграммы связей

BUSINESS LOGIC
├── 9 полных workflow сценариев
├── Пошаговое описание каждого процесса
├── Примеры данных Prisma
└── Финансовые расчеты

IMPLEMENTATION
├── 7 фаз разработки
├── 35+ файлов для создания
├── 8 core services
├── DTOs и validators
└── Unit & E2E tests

API SPECIFICATION
├── 15+ endpoints
├── Request/Response примеры
├── Error handling
└── Полный пример сценария

DATABASE
├── SQL для всех таблиц
├── Constraints и индексы
├── Примеры данных
└── Запросы для отчетов
```

---

## 🚀 Как использовать эту документацию

### Для Product Manager
1. Прочитать **02_RENTAL_BUSINESS_LOGIC.md** — понять бизнес-процессы
2. Проверить сценарии — могут ли они изменяться
3. Согласовать error cases с командой

### Для Tech Lead
1. Прочитать **01_RENTAL_ARCHITECTURE.md** — обзор системы
2. Прочитать **03_RENTAL_IMPLEMENTATION_PLAN.md** — план работ
3. Спланировать sprint-ы (неделя на фазу)
4. Распределить задачи между разработчиками

### Для Backend Developer
1. Прочитать **01_RENTAL_ARCHITECTURE.md** — как устроено
2. Прочитать **04_RENTAL_DB_SCHEMA.md** — структура БД
3. Прочитать **02_RENTAL_BUSINESS_LOGIC.md** — логика
4. Начать с **Phase 1** из **03_RENTAL_IMPLEMENTATION_PLAN.md**

### Для Frontend Developer
1. Прочитать **05_RENTAL_API_SPECS.md** — все endpoints
2. Прочитать примеры Request/Response
3. Тестировать API во время разработки

### Для QA Engineer
1. Прочитать **02_RENTAL_BUSINESS_LOGIC.md** — сценарии
2. Прочитать **05_RENTAL_API_SPECS.md** — error cases
3. Создать test cases для всех 9 сценариев
4. Тестировать edge cases

---

## ✅ Checklist перед разработкой

- [ ] Все stakeholders прочитали документацию
- [ ] Одобрены все 9 бизнес-сценариев
- [ ] Обсуждены edge cases
- [ ] Определены owner'ы для каждой фазы
- [ ] Создан Prisma migration (Phase 1)
- [ ] Спланированы sprint-ы
- [ ] Настроена CI/CD для тестирования

---

## 📊 Статистика документации

| Раздел              | Строк     | Таблиц | Примеров | Диаграмм |
| ------------------- | --------- | ------ | -------- | -------- |
| Architecture        | 800+      | 2      | 15       | 5        |
| Business Logic      | 1200+     | 2      | 50       | 10       |
| Implementation Plan | 600+      | 3      | 20       | 3        |
| DB Schema           | 900+      | 1      | 25       | 2        |
| API Specs           | 700+      | 2      | 40       | 1        |
| **ИТОГО**           | **4200+** | **10** | **150**  | **21**   |

---

## 🔗 Связи между документами

```
START HERE
    ↓
01_RENTAL_ARCHITECTURE.md (понять что это)
    ↓
02_RENTAL_BUSINESS_LOGIC.md (понять как это работает)
    ↓
03_RENTAL_IMPLEMENTATION_PLAN.md (понять как это делать)
    ↓
Выбирайте путь:
    │
    ├─→ Backend Dev → 04_RENTAL_DB_SCHEMA.md
    │
    ├─→ Frontend Dev → 05_RENTAL_API_SPECS.md
    │
    └─→ QA → 02_RENTAL_BUSINESS_LOGIC.md + 05_RENTAL_API_SPECS.md
```

---

## 💡 Ключевые решения архитектуры

### ✅ ПОЧЕМУ OrderItemType на уровне OrderItem?
- Позволяет смешивать SALE и RENT в одном заказе
- Не усложняет Order таблицу
- Гибко для будущих типов операций

### ✅ ПОЧЕМУ отдельная таблица Rental?
- Не загромождает OrderItem специфичными для аренды полями
- Легко добавлять новые функции (продление, штрафы, продление)
- Явная связь OrderItem ↔ Rental

### ✅ ПОЧЕМУ RentalDeposit отдельно?
- Залог может быть CASH, GOLD, DOCUMENT, OTHER
- Ясное разделение: доход vs временный платеж
- Правильно отражается в Cashbox

### ✅ ПОЧЕМУ StockMovement с новыми REASON?
- Полная история: RENT vs OUT/SALE
- Полный аудит всех операций
- Правильный расчет себестоимости

### ✅ ПОЧЕМУ InventoryItem опциональный?
- Не усложняет систему для обычных товаров
- Нужен только для поштучного учета (платья, инструменты)
- Легко добавить позже

---

## 🎓 Используемые паттерны

1. **Transactional Operations** — все критические операции обёрнуты в `prisma.$transaction()`
2. **Event Sourcing** — полная история через StockMovement и CashTransaction
3. **Soft Deletes** — товары архивируются, не удаляются
4. **Audit Trail** — каждая операция логируется с createdBy
5. **Business Rules Validation** — все правила на уровне Service
6. **Money Handling** — Decimal(15,2) для всех сумм

---

## ❓ Ответы на частые вопросы

### Q: Почему не использовать OrderType на Order уровне?
A: Потому что нужны смешанные заказы (продажа + аренда одновременно)

### Q: Как проверить доступность товара?
A: `getAvailableRentalItems(variantId, startDate, endDate)` учитывает:
- Active аренды (пересечение дат)
- Confirmed бронирования
- Итого: available = total - rentals - reservations

### Q: Что происходит при повреждении товара?
A: 
- Rental.status = DAMAGED
- Rental.damageFee = определяет staff
- StockMovement OUT/WRITE_OFF (товар списан)
- RentalDeposit = FORFEITED (залог конфискован)
- CashTransaction INCOME/DAMAGE

### Q: Можно ли продлить если есть резервирование?
A: Нет, система проверит getAvailableRentalItems() и откажет если кто-то другой забронировал

### Q: Что если ранний возврат не разрешен?
A: OrderItem.earlyReturnRefundType = NONE → возврата нет

### Q: Когда вернулось в LATE?
A: Job который запускается каждый день проверяет due_date < NOW() и обновляет status

---

## 🔐 Безопасность

- ✅ Все операции требуют Authorization
- ✅ Guards проверяют принадлежность ресурсов
- ✅ StaffOnWarehouse валидируется
- ✅ Decimal для денег (без floating point ошибок)
- ✅ Транзакции для consistency
- ✅ Полный аудит через StockMovement + CashTransaction

---

## 📞 Контакты для вопросов

Если при реализации возникнут вопросы:
1. Перечитайте соответствующий раздел документации
2. Проверьте примеры в Business Logic
3. Посмотрите примеры SQL в DB Schema

---

## 🎉 Резюме

Документация полностью описывает систему аренды товаров для my-billing:
- 🏗️ Архитектура готова
- 📖 Бизнес-логика определена
- 🗄️ База данных спроектирована
- 📡 API специфицирована
- 🚀 План реализации готов

**Система готова к разработке!** 🚀

