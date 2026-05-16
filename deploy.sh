#!/bin/bash
set -e

echo "🚀 Deploying Backend..."

cd /var/www/billing

echo "📥 Pulling latest changes..."
git pull origin main

echo "📦 Installing dependencies..."
npm install

echo "🔨 Building NestJS app..."
npm run build

echo "🔄 Restarting PM2..."
pm2 restart billing-app

echo "✅ Backend deployment complete!"
pm2 status