# Docker Setup Guide

## 📦 Структура файлов

```
billing/
├── Dockerfile                 # Multi-stage production образ
├── .dockerignore             # Исключения для Docker build
├── docker-compose.yml        # Production конфигурация
├── docker-compose.dev.yml    # Development override
└── DOCKER.md                 # Это руководство
```

---

## 🚀 Быстрый старт

### Development (разработка с hot reload)

```bash
# Запуск с hot reload и отладчиком
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Или короче (если настроить alias)
docker-compose up --build
```

### Production

```bash
# Запуск production окружения
docker-compose up -d --build

# Проверка логов
docker-compose logs -f nodejs

# Остановка
docker-compose down
```

---

## 🏗️ Архитектура Dockerfile

### Multi-stage Build

Dockerfile использует **3-этапную сборку** для оптимизации размера и безопасности:

```
┌─────────────────────────────────────────┐
│ Stage 1: deps (dependencies)            │
│ - Устанавливает production зависимости   │
│ - Очищает npm cache                      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ Stage 2: builder                        │
│ - Устанавливает все зависимости         │
│ - Генерирует Prisma Client               │
│ - Компилирует TypeScript → JavaScript    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ Stage 3: production                     │
│ - Минимальный образ (Node 22 Alpine)    │
│ - Копирует только production deps        │
│ - Копирует скомпилированный код          │
│ - Запускается от non-root user           │
└─────────────────────────────────────────┘
```

**Результат**:
- ✅ Меньший размер образа (~200MB вместо ~1GB)
- ✅ Безопаснее (нет devDependencies, нет исходного кода)
- ✅ Быстрее деплой

---

## 🔧 Best Practices реализованные в конфигурации

### ✅ Dockerfile

1. **Multi-stage build** — отделение build-time от runtime зависимостей
2. **Alpine Linux** — минимальный размер образа
3. **Non-root user** — безопасность (запуск от `nestjs:nodejs`)
4. **dumb-init** — правильная обработка сигналов (SIGTERM, SIGINT)
5. **Prisma generation** — генерация клиента на этапе build
6. **Health check** — встроенная проверка здоровья контейнера
7. **Layer caching** — `COPY package*.json` перед `COPY . .`
8. **.dockerignore** — исключение ненужных файлов из контекста

### ✅ docker-compose.yml

1. **Health checks** — для всех сервисов
2. **Dependency ordering** — `depends_on.condition: service_healthy`
3. **Resource limits** — ограничение CPU и памяти
4. **Logging configuration** — ротация логов (max 3 файла по 10MB)
5. **Restart policy** — `unless-stopped` (не рестартует после `docker-compose down`)
6. **Explicit environment** — все env переменные явно перечислены
7. **Named volumes** — для персистентных данных
8. **Container names** — удобная идентификация

### ✅ Безопасность

1. **Non-root user** — приложение запускается от `nestjs:1001`
2. **No secrets in image** — `.env` не копируется в образ
3. **Minimal attack surface** — Alpine Linux + только production deps
4. **Explicit ports** — только необходимые порты пробрасываются

---

## 📊 Health Checks

### Эндпоинты

```bash
# Общий health check
GET /health
# → { status: 'ok', database: 'connected', uptime: 123.45 }

# Readiness probe (готовность принимать трафик)
GET /health/ready
# → { status: 'ready' }

# Liveness probe (приложение живо)
GET /health/live
# → { status: 'alive', timestamp: '2026-10-13T12:00:00.000Z' }
```

### Использование в Kubernetes

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 4000
  initialDelaySeconds: 40
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /health/ready
    port: 4000
  initialDelaySeconds: 20
  periodSeconds: 10
```

---

## 🔄 Development Workflow

### Запуск с hot reload

```bash
# Запуск dev окружения
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# Изменения в src/ автоматически перезагружают приложение
# Не нужно пересобирать образ
```

### Отладка

```bash
# Dev окружение экспонирует порт 9229 для Node.js debugger
# VS Code launch.json:
{
  "type": "node",
  "request": "attach",
  "name": "Docker: Attach to Node",
  "port": 9229,
  "restart": true,
  "remoteRoot": "/app"
}
```

### Prisma Migrations

```bash
# Применить миграции
docker-compose exec nodejs npm run prisma:migrate

# Создать новую миграцию
docker-compose exec nodejs npx prisma migrate dev --name add_users

# Открыть Prisma Studio
docker-compose exec nodejs npx prisma studio
```

### Просмотр логов

```bash
# Все сервисы
docker-compose logs -f

# Только Node.js
docker-compose logs -f nodejs

# Только PostgreSQL
docker-compose logs -f postgres

# Последние 100 строк
docker-compose logs --tail=100 nodejs
```

### Очистка

```bash
# Остановить и удалить контейнеры
docker-compose down

# Удалить volume с данными БД (ОСТОРОЖНО!)
docker-compose down -v

# Полная очистка (образы, volume, сети)
docker-compose down --rmi all -v
```

---

## 🌍 Переменные окружения

### Обязательные переменные

```bash
# .env (пример)

# Database
DATABASE_URL=postgresql://postgres:password@postgres:5432/billing
POSTGRES_DB=billing
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_PORT=5432
POSTGRES_OUTPUT_PORT=5432

# Server
PORT=4000
NODE_ENV=production

# JWT
JWT_ACCESS_SECRET=your-secret-key-change-in-production
JWT_ACCESS_EXPIRE=15m
JWT_REFRESH_SECRET=your-refresh-secret-key-change-in-production
JWT_REFRESH_EXPIRE=7d

# AWS/S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_BUCKET=billing-bucket

# Grafana (опционально)
GRAFANA_PASSWORD=admin

# Loki (опционально)
LOKI_URL=http://loki:3100
```

### Значения по умолчанию

- `PORT`: 4000
- `POSTGRES_OUTPUT_PORT`: 5432 (порт на хосте)
- `POSTGRES_PORT`: 5432 (порт в контейнере)

---

## 📈 Мониторинг

### Grafana + Loki

Стек автоматически запускает:
- **Loki** (http://localhost:3100) — сбор логов
- **Grafana** (http://localhost:3000) — визуализация

```bash
# Проверка логов в Loki
curl http://localhost:3100/ready

# Вход в Grafana
# URL: http://localhost:3000
# User: admin
# Password: из .env (GRAFANA_PASSWORD)
```

### Метрики контейнеров

```bash
# Использование ресурсов
docker stats

# Подробная информация о контейнере
docker inspect billing_api
```

---

## 🚨 Troubleshooting

### Проблема: "Cannot connect to PostgreSQL"

```bash
# Проверить, что PostgreSQL готов
docker-compose exec postgres pg_isready -U postgres

# Проверить логи PostgreSQL
docker-compose logs postgres

# Перезапустить с пересозданием volume
docker-compose down -v
docker-compose up -d
```

### Проблема: "Port already in use"

```bash
# Найти процесс на порту 4000
lsof -i :4000  # macOS/Linux
netstat -ano | findstr :4000  # Windows

# Изменить PORT в .env
PORT=4001
```

### Проблема: "Out of memory"

```bash
# Увеличить лимиты в docker-compose.yml
deploy:
  resources:
    limits:
      memory: 2G  # Было: 1G
```

### Проблема: "Prisma Client не найден"

```bash
# Пересобрать образ (Prisma generate выполнится)
docker-compose up --build

# Или вручную внутри контейнера
docker-compose exec nodejs npm run prisma:generate
```

---

## 📦 Production Deployment

### Build и Push в Registry

```bash
# Build production образа
docker build -t myregistry/billing:latest .

# Push в registry
docker push myregistry/billing:latest
```

### Deployment Checklist

- [ ] Использовать secrets для `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`
- [ ] Отключить `POSTGRES_OUTPUT_PORT` (закомментировать в docker-compose.yml)
- [ ] Настроить backup для `postgres_data` volume
- [ ] Настроить мониторинг (Grafana Loki)
- [ ] Настроить reverse proxy (Nginx, Traefik, Caddy)
- [ ] Включить HTTPS
- [ ] Настроить rate limiting
- [ ] Настроить log rotation
- [ ] Проверить resource limits

### Пример nginx reverse proxy

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        proxy_pass http://localhost:4000/health;
        access_log off;
    }
}
```

---

## 🎯 Что НЕ делать

❌ **Не запускать в production с docker-compose.dev.yml**
```bash
# WRONG для production
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

❌ **Не хранить секреты в .env в git**
```bash
# Добавить в .gitignore
.env
.env.local
.env.*.local
```

❌ **Не использовать `latest` tag для production**
```bash
# WRONG
FROM node:latest

# RIGHT
FROM node:22-alpine
```

❌ **Не запускать от root**
```dockerfile
# WRONG
CMD ["node", "dist/main"]

# RIGHT (с non-root user)
USER nestjs
CMD ["node", "dist/main"]
```

❌ **Не игнорировать health checks**
```yaml
# WRONG
depends_on:
  - postgres  # Запустится до готовности БД

# RIGHT
depends_on:
  postgres:
    condition: service_healthy  # Дождется готовности
```

---

## 📚 Дополнительные ресурсы

- [Node.js Docker Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Prisma with Docker](https://www.prisma.io/docs/guides/deployment/deployment-guides/deploying-to-aws-ecs#containerizing-the-application)
- [NestJS Docker](https://docs.nestjs.com/recipes/docker)

---

## 🔄 Обновление версии Node.js

При обновлении Node.js нужно изменить версию в **трех местах** в Dockerfile:

```dockerfile
FROM node:22-alpine AS deps       # ← Изменить
FROM node:22-alpine AS builder    # ← Изменить
FROM node:22-alpine AS production # ← Изменить
```

---

**Версия**: 1.0  
**Последнее обновление**: 2026-10-13
