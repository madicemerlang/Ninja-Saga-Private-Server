#!/usr/bin/env bash
set -e

cd /var/www/html

mkdir -p storage/framework/{sessions,views,cache} storage/logs bootstrap/cache logs
chown -R www-data:www-data storage bootstrap/cache logs 2>/dev/null || true
chmod -R ug+rwx storage bootstrap/cache logs 2>/dev/null || true

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
fi

if [ ! -d vendor ] || [ ! -f vendor/autoload.php ]; then
  echo "[app] Installing Composer dependencies..."
  composer install --no-interaction --prefer-dist --optimize-autoloader
fi

exec "$@"
