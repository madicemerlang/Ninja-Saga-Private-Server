#!/usr/bin/env bash
set -e

cd /var/www/html

mkdir -p storage/framework/sessions storage/framework/views storage/framework/cache \
         storage/app/swf_cache storage/app/swf_base storage/logs bootstrap/cache logs
chown -R www-data:www-data storage bootstrap/cache logs 2>/dev/null || true
chmod -R ug+rwx storage bootstrap/cache logs 2>/dev/null || true

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
fi

# Generate APP_KEY if not provided via environment or .env
if [ -z "${APP_KEY:-}" ] && ! grep -qE '^APP_KEY=base64:.+' .env 2>/dev/null; then
  php artisan key:generate --force --no-interaction || true
fi

# Configure Nginx to listen on PaaS $PORT (default 8080)
LISTEN_PORT="${PORT:-8080}"
sed "s/__PORT__/${LISTEN_PORT}/g" /etc/nginx/templates/ninjasage.conf.template > /etc/nginx/sites-enabled/default
rm -f /etc/nginx/conf.d/default.conf

echo "[ninjasage] Starting PHP-FPM + Nginx on port ${LISTEN_PORT}..."
php-fpm -D
exec nginx -g "daemon off;"
