# Single-container production Dockerfile for PaaS platforms (SnapDeploy, Railway, Render, Fly.io)
# Bundles Nginx + PHP 8.4-FPM + Python 3 (swf_builder.py) + Laravel backend + SWF assets
FROM php:8.4-fpm-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    git \
    curl \
    unzip \
    python3 \
    libzip-dev \
    libicu-dev \
    libpng-dev \
    libjpeg62-turbo-dev \
    libfreetype6-dev \
    libonig-dev \
    libpq-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
        pdo_mysql \
        pdo_pgsql \
        pgsql \
        zip \
        intl \
        bcmath \
        gd \
        exif \
        pcntl \
        opcache \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# Install Composer dependencies first for better layer caching
COPY Database/Laragon/ninjasage/composer.json Database/Laragon/ninjasage/composer.lock ./
RUN composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader --no-scripts

# Copy Laravel application and authentic Ninja Saga SWF assets
COPY Database/Laragon/ninjasage/ /var/www/html/
COPY ["Custom Client/NS Custom Client V1/", "/var/www/swf-assets/"]

RUN composer dump-autoload --optimize \
    && mkdir -p storage/framework/sessions storage/framework/views storage/framework/cache \
                storage/app/swf_cache storage/app/swf_base storage/logs bootstrap/cache logs \
    && chown -R www-data:www-data storage bootstrap/cache logs

# Copy PaaS Nginx template and startup script
COPY docker/paas/nginx.conf.template /etc/nginx/templates/ninjasage.conf.template
COPY docker/paas/start.sh /usr/local/bin/paas-start.sh
RUN chmod +x /usr/local/bin/paas-start.sh

ENV PORT=8080 \
    APP_ENV=production \
    APP_DEBUG=false \
    SWF_ASSETS_PATH=/var/www/swf-assets \
    ENEMY_SWF_PATH=/var/www/swf-assets/enemy \
    SKILL_SWF_PATH=/var/www/swf-assets/skills

EXPOSE 8080

CMD ["/usr/local/bin/paas-start.sh"]
