#!/bin/bash
set -euo pipefail

APP_DIR=/var/www/billing
BRANCH=main
PM2_APP=billing-app
DB_CONTAINER=dev_postgres
BACKUP_DIR="$HOME/db-backups"

echo "🚀 Deploying Backend..."

cd "$APP_DIR"

if [[ "$(git branch --show-current)" != "$BRANCH" ]]; then
  echo "❌ Server checkout is not on '$BRANCH'" >&2
  exit 1
fi

echo "📥 Pulling latest changes..."
git fetch origin "$BRANCH"
# Fails instead of overwriting manual edits made on the server.
git merge --ff-only "origin/$BRANCH"

echo "📦 Installing dependencies..."
npm ci

echo "🔨 Building NestJS app..."
npx prisma generate
npm run build

echo "💾 Backing up database before migrations..."
(
  umask 077
  mkdir -p "$BACKUP_DIR"
  BACKUP="$BACKUP_DIR/pre-deploy_$(date +%Y-%m-%d_%H-%M-%S).sql.gz"
  docker exec "$DB_CONTAINER" sh -c \
    'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' \
    | gzip > "$BACKUP"
  gzip -t "$BACKUP"
  find "$BACKUP_DIR" -name 'pre-deploy_*.sql.gz' -mtime +14 -delete
  echo "Backup: $BACKUP"
)

echo "🗄️ Applying database migrations..."
npx prisma migrate deploy

echo "🔄 Restarting PM2..."
pm2 restart "$PM2_APP" --update-env

echo "🩺 Checking health..."
PORT=$(grep -E '^PORT=' .env | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'\r ')
PORT=${PORT:-3000}
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health/ready" > /dev/null; then
    echo "✅ Backend deployment complete!"
    pm2 status "$PM2_APP"
    exit 0
  fi
  sleep 3
done

echo "❌ Health check failed" >&2
pm2 logs "$PM2_APP" --lines 50 --nostream >&2 || true
exit 1