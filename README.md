# Ninja Saga Private Server + Mobile App (React Native / Expo + Ruffle WASM)

Private server Ninja Saga lengkap dengan **Docker stack** (Laravel + MySQL 8 + Nginx + Live PvP + World Chat), **Unified 36 FPS Ruffle WASM SWF Compiler**, seluruh **7.459+ aset SWF asli game**, serta **aplikasi mobile React Native (Expo)** berorientasi landscape.

---

## ✨ Fitur Utama

### ⚔️ Sistem Pertarungan (36 FPS Unified Battle Engine)
- **Unified 36 FPS Ruffle Stage**: Player, Pet, 1–3 musuh simultan, dan animasi jurus dikompilasi ke satu SWF battle ([swf_builder.py](Database/Laragon/ninjasage/scripts/swf_builder.py)) sehingga halus 36 FPS tanpa flicker.
- **Kontrol Battle Modern**: Kecepatan **1x / 2x**, **AUTO Battle**, **AoE Skills**, **Pet pada ATB Timeline**, **Consumables**, **Flee Modal**, serta **ikon Jutsu 50×50 asli Ninja Saga**.
- **Tap & Hold Inspector**: Tekan & tahan karakter/musuh untuk melihat stat efektif live (termasuk buff/debuff aktif), atau tekan & tahan ikon Jutsu untuk melihat detail damage, CP, cooldown, dan efeknya.
- **Agility Timeline Bar**: Urutan giliran real-time berbasis Agility efektif lengkap dengan animasi token.
- **Formula Combat, Elemen & Buff/Debuff Asli** (`skill-effect.json` & `enemy.json`):
  - **Weapon Attack**: Damage senjata ±20% variance & memulihkan **+5% CP**.
  - **Fire / Thunder / Wind / Water / Earth**: Bonus damage elemen, Combustion, Crit/Crit Damage, Dodge/Agility, Max CP/Healing/Purify, Max HP/Reactive Force.
  - **Buff & Debuff Resmi**: Stun, Sleep, Frozen, Petrify, Prison, Fear, Chaos, Restriction, Meridian Seal, Burn/Blaze, Poison, Bleeding, Strengthen, Protection, Flexible, Concentration, Slow, CP Shield, Lightning Armor, Fire Wall, Bloodfeed, Purify, Disperse, dll.

### 🏘️ Village Hub & UI Mobile (React Native / Expo)
- **Login & Character Select**: Artwork full-screen, Free vs Premium badge, buat karakter baru dengan **live 36 FPS preview** (gender, gaya rambut, warna rambut), hapus karakter, serta **Tokens shared per akun** (`users.tokens`).
- **Village Hub Interaktif**: Peta desa panoramik dengan 8 bangunan yang dapat diklik langsung (**Mission Room**, **Academy**, **PvP Arena**, **Talent Hall**, **Blacksmith**, **Ninja Shop**, **Pet Shop**, **Hunting House**) + **HUD 56×56 Portrait Kepala Karakter 36 FPS**.
- **Menu Utama (Bottom Dock)**:
  - **My Jutsu**: Kelola loadout jurus & live 36 FPS preview animasi jurus.
  - **Stats**: Pedestal karakter 36 FPS live, detail Combat Stats, dan alokasi 5 Elemental Attribute Points.
  - **Inventory**: Tas item milik sendiri (Weapon, Outfit, Back, Accessory, Hair, Material) + live 36 FPS try-on & Equip.
  - **Pet**: Daftar pet milik sendiri, Equip/Unequip, dan **Pelajari Jurus Pet** (`character_pets.learned_skills`).
  - **Chat & Mission**: Akses cepat World Chat (`:3002`) dan Mission Room.
- **Bangunan Lengkap dengan UI Gulungan Perkamen & Bambu**:
  - **Mission Room**: Filter Grade (`All`, `C`, `B`, `A`, `S`) dengan pertarungan 1–3 musuh.
  - **Academy & Advance Academy**: 250+ jurus per elemen + live 36 FPS preview & tier upgrade.
  - **Ninja Shop & Pet Shop**: Katalog gear (live try-on) dan 142 pet asli.
  - **Hunting House**: 5 Zona Boss asli, Daily Kari Badge, Boss Hunt 36 FPS, dan Hunting Market Forge.
  - **Blacksmith (Forge)**: 65 resep tempa senjata menggunakan Gold atau Tokens.
  - **Talent Hall**: Extreme & Secret Talent discovery & upgrade Lv. 1–10.
  - **Live PvP Arena (`:3000`) & World Chat (`:3002`)**.

---

## 📋 Prasyarat Server & Client

### Server (Backend)
- **Linux VPS / PC** (Ubuntu 22.04/24.04 atau Debian 12 direkomendasikan)
- **Docker Engine** & **Docker Compose Plugin** (`docker compose`)
- RAM minimal **2 GB** (disarankan **4 GB** untuk kompilasi SWF & MySQL yang lega)
- Storage minimal **10 GB** kosong

### Client (Mobile App)
- **Node.js 20+** & **npm**
- **Expo Go** di HP Android/iOS (untuk development / testing LAN) atau **EAS CLI / Android SDK** (untuk build APK standalone)

---

## 🚀 Panduan Deployment Server (Docker — Direkomendasikan)

### 1. Clone Repository di Server

```bash
git clone https://github.com/madicemerlang/Ninja-Saga-Private-Server.git
cd Ninja-Saga-Private-Server
```

### 2. Siapkan File Environment

#### a. Environment Docker (Root Project)
Salin `.env.docker.example` menjadi `.env`:

```bash
cp .env.docker.example .env
```

Edit `.env` sesuai alamat IP LAN (untuk lokal) atau IP Publik / Domain VPS Anda:

```env
HTTP_PORT=8080
MYSQL_PORT=3306
PVP_PORT=3000
CHAT_PORT=3002

# Untuk VPS / Production ganti APP_ENV=production dan APP_DEBUG=false
APP_ENV=local
APP_DEBUG=true
APP_URL=http://<IP_SERVER_ATAU_DOMAIN>:8080

DB_DATABASE=ninjasage
DB_PASSWORD=ganti_dengan_password_mysql_kuat

PVP_SOCKET_URL=http://<IP_SERVER_ATAU_DOMAIN>:3000/pvp
CHAT_SOCKET_URL=http://<IP_SERVER_ATAU_DOMAIN>:3002
CHAT_ADMIN_SECRET=ganti_dengan_random_secret_panjang
```

#### b. Environment Laravel
Pastikan `Database/Laragon/ninjasage/.env` tersedia:

```bash
cp Database/Laragon/ninjasage/.env.example Database/Laragon/ninjasage/.env
```

> Variabel `APP_*`, `DB_*`, `PVP_SOCKET_URL`, `CHAT_SOCKET_URL`, dan `SWF_ASSETS_PATH` otomatis di-override oleh `docker-compose.yml` di dalam container `ninjasage-app`.

### 3. Build & Jalankan Semua Container

```bash
docker compose up -d --build
```

Perintah ini akan menjalankan 5 container secara otomatis:

| Service | Container | Port | Fungsi |
| :--- | :--- | :--- | :--- |
| `nginx` | `ninjasage-nginx` | `8080` | Web server, REST API Mobile, Ruffle WASM, SWF & Game Data |
| `app` | `ninjasage-app` | internal | PHP-FPM Laravel + Python 3 (`swf_builder.py`) |
| `mysql` | `ninjasage-mysql` | `3306` | Database MySQL 8.0 (volume `mysql_data`) |
| `pvp-server` | `ninjasage-pvp` | `3000` | Node.js Socket.IO Live PvP Server |
| `chat-server` | `ninjasage-chat` | `3002` | Node.js Socket.IO World & Clan Chat Server |

### 4. Inisialisasi Laravel & Database (Pertama Kali Saja)

```bash
docker exec -it ninjasage-app composer install --no-dev --optimize-autoloader
docker exec -it ninjasage-app php artisan key:generate
docker exec -it ninjasage-app php artisan migrate --seed
docker exec -it ninjasage-app chown -R www-data:www-data storage bootstrap/cache
```

### 5. Verifikasi Server Berjalan

```bash
docker compose ps
curl http://127.0.0.1:8080/api/v1/health
curl http://127.0.0.1:8080/api/v1/assets/catalog
```

Pastikan `/api/v1/health` mengembalikan status `ok` dan `swf_assets_ready: true`.

- **Admin Panel**: `http://<IP_SERVER>:8080/admin/login`
  - Email default: `admin@admin.test`
  - Password default: `admin` *(segera ganti di server production!)*

---

## 🌐 Deployment Production di VPS (Ubuntu/Debian + Firewall + HTTPS)

Jika deploy ke VPS publik agar bisa diakses dari mana saja:

### 1. Instal Docker di VPS (Ubuntu/Debian)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Konfigurasi Firewall (UFW)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# Jika belum memakai reverse proxy HTTPS, buka port langsung:
sudo ufw allow 8080/tcp
sudo ufw allow 3000/tcp
sudo ufw allow 3002/tcp
sudo ufw enable
```

> **Catatan Keamanan**: Jangan buka port `3306` (MySQL) ke publik. Anda bisa mengubah binding di `docker-compose.yml` menjadi `127.0.0.1:3306:3306`.

### 3. Hardening Production & Cache Laravel

Di `.env` root:
- Set `APP_ENV=production` dan `APP_DEBUG=false`.
- Gunakan password kuat untuk `DB_PASSWORD` dan `CHAT_ADMIN_SECRET`.

Lalu jalankan optimasi cache Laravel:

```bash
docker exec -it ninjasage-app php artisan config:cache
docker exec -it ninjasage-app php artisan route:cache
docker exec -it ninjasage-app php artisan view:cache
```

### 4. Reverse Proxy HTTPS dengan Nginx (Opsional, Direkomendasikan untuk Domain)

Contoh konfigurasi `/etc/nginx/sites-available/ninjasage` (lanjutkan dengan `sudo certbot --nginx -d api.domainanda.com`):

```nginx
server {
    listen 80;
    server_name api.domainanda.com;

    client_max_body_size 50M;

    # Laravel REST API, Ruffle & SWF Assets
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Socket.IO PvP Server
    location /pvp/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # Socket.IO Chat Server
    location /chat/ {
        proxy_pass http://127.0.0.1:3002/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### 5. Update / Redeploy Server & Backup Database

**Update dari GitHub:**
```bash
git pull origin main
docker compose up -d --build
docker exec -it ninjasage-app php artisan migrate --force
docker exec -it ninjasage-app php artisan optimize:clear
rm -f Database/Laragon/ninjasage/storage/app/swf_cache/*.swf
```

**Backup Database MySQL:**
```bash
docker exec ninjasage-mysql mysqldump -u root -p"$DB_PASSWORD" ninjasage > backup_$(date +%F).sql
```

---

## 📱 Menjalankan Aplikasi Mobile (Expo / React Native)

```bash
cd mobile-app
npm install
```

### Development / Testing via Expo Go
```bash
EXPO_PUBLIC_API_BASE_URL=http://<IP_SERVER_ATAU_DOMAIN>:8080 npx expo start
```

> Anda juga bisa menjalankan `npx expo start` lalu mengubah **Server URL** langsung dari layar Login aplikasi.

1. Buka aplikasi **Expo Go** di HP Android/iOS.
2. Scan QR Code yang muncul di terminal.
3. Register / Login, buat karakter ninja, dan mulai bermain!

### Cek TypeScript
```bash
cd mobile-app
npm run typecheck
```

---

## 🪟 Alternatif: Menjalankan di Windows via Laragon (Tanpa Docker)

1. Salin `Database/Laragon/ninjasage` ke `C:\laragon\www\ninjasage`.
2. Aktifkan **PHP 8.4+** (dengan ekstensi `zip`, `pdo_mysql`) dan pastikan **Python 3** tersedia di `PATH` untuk `swf_builder.py`.
3. Buat database `ninjasage`, sesuaikan `Database/Laragon/ninjasage/.env` (termasuk `SWF_ASSETS_PATH` mengarah ke folder `Custom Client/NS Custom Client V1`).
4. Jalankan:
   ```bash
   composer install
   php artisan key:generate
   php artisan migrate --seed
   ```
5. Jalankan `npm install && npm start` di masing-masing folder `pvp-server` dan `chat-server`.

---

## 📁 Struktur Repository

```text
Ninja-Saga-Private-Server/
├── docker-compose.yml                    # Orkestrasi MySQL, PHP-FPM, Nginx, PvP, Chat
├── .env.docker.example                   # Template environment Docker
├── docker/                               # Dockerfile PHP+Python & konfigurasi Nginx
├── Custom Client/
│   └── NS Custom Client V1/              # 7.459+ aset SWF & audio asli Ninja Saga
├── Database/
│   └── Laragon/ninjasage/                # Backend Laravel, AMF Services, game_data JSON
│       ├── app/Http/Controllers/Api/     # MobileAuth, MobileGame, SwfAssetController
│       ├── database/migrations/          # Migrasi tabel (termasuk pet learned_skills)
│       ├── scripts/swf_builder.py        # Compiler SWF 36 FPS Unified Stage & Portrait
│       ├── public/game_data/             # skills, skill-effect, enemy, pet, talents, library
│       ├── public/ruffle/                # Self-hosted Ruffle WASM runtime
│       ├── public/audio/                 # bgm.mp3, battle.mp3, click.mp3, xmas.mp3
│       ├── pvp-server/                   # Node.js Socket.IO PvP Server (:3000)
│       └── chat-server/                  # Node.js Socket.IO Chat Server (:3002)
└── mobile-app/                           # Aplikasi Mobile React Native (Expo + TypeScript)
    ├── assets/                           # Artwork background (Login, CharSelect, Village, 8 Buildings)
    └── src/
        ├── api/                          # REST/RPC Client & Game Data loader
        ├── components/                   # NinjaScrollWindow, BattleActionIcons, LoadingOverlay, dll.
        ├── engine/battleEngine.ts        # Combat, Agility Timeline, Buff/Debuff, Pet ATB, Enemy AI
        ├── stage/                        # Ruffle WebView bridge & HTML stage
        └── screens/                      # Login, CharSelect, VillageHub, Battle, MyJutsu, Stats,
                                          # MyInventory, Inventory, Pet, Academy, Hunting, Forge, Talent, PvP
```

---

## 🛠️ Troubleshooting

- **HP tidak bisa konek ke Server URL (`http://<IP_SERVER>:8080`)**:
  - Pastikan HP dan server berada di jaringan LAN yang sama (atau VPS sudah membuka firewall port `8080`, `3000`, `3002`).
  - Cek `curl http://<IP_SERVER>:8080/api/v1/health` dari browser HP.
- **Animasi / Portrait SWF masih menampilkan versi lama setelah update `swf_builder.py`**:
  - Bersihkan cache SWF di server:
    ```bash
    rm -f Database/Laragon/ninjasage/storage/app/swf_cache/*.swf
    ```
- **Permission error pada `storage/` di Docker**:
  ```bash
  docker exec -it ninjasage-app chown -R www-data:www-data storage bootstrap/cache
  ```
