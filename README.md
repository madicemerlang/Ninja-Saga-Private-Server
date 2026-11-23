# Ninja Saga Private Server + Mobile App (React Native / Expo + Ruffle WASM)

Framework private server Ninja Saga lengkap dengan **Docker stack** (Laravel + MySQL + Live PvP + World Chat), **Unified 36 FPS Ruffle WASM SWF Compiler**, seluruh **7.459+ aset SWF asli game**, serta **aplikasi mobile React Native (Expo)**.

---

## ✨ Fitur Utama

### ⚔️ Sistem Pertarungan (Battle Engine)
- **Unified 36 FPS Ruffle Stage**: Player, 1–3 musuh simultan, dan animasi jutsu dikompilasi ke satu SWF battle (`Database/Laragon/ninjasage/scripts/swf_builder.py`) sehingga bebas flicker dan tumpang tindih.
- **Agility Timeline Bar**: Urutan giliran real-time berbasis Agility efektif lengkap dengan animasi luncur token yang halus.
- **Formula Combat & Atribut Elemen Asli**:
  - **Weapon Attack**: Damage senjata ±20% variance dan memulihkan **+5% CP** baik kena maupun miss.
  - **Fire**: `+1%` damage Ninjutsu Fire, `+0.4%` semua damage, dan `0.4%/poin` peluang **Combustion (+30% damage, 1 turn)**.
  - **Thunder**: `+1%` damage Ninjutsu Thunder, `+0.4%` Crit Chance, dan `+0.8%` Crit Damage per poin.
  - **Wind**: `+1%` damage Ninjutsu Wind, `+0.4%` Dodge Chance, dan `+1` Agility per poin.
  - **Water**: `+1%` damage Ninjutsu Water, `+30` Max CP, `+1%` Healing Bonus, dan `0.4%/poin` peluang **Purify** di awal giliran.
  - **Earth**: `+1%` damage Ninjutsu Earth, `+30` Max HP, dan `0.4%/poin` peluang **Reactive Force** (memantulkan 30% damage).
- **Sistem Buff & Debuff Resmi** (`skill-effect.json` & `enemy.json`): Stun, Sleep, Frozen, Petrify, Prison, Fear, Chaos, Restriction, Meridian Seal, Burn/Blaze, Poison, Bleeding, Strengthen, Protection, Flexible, Concentration, Slow/Muddy, Agility+, CP Shield, Lightning Armor, Fire Wall, Bloodfeed, Purify, Disperse, dll.
- **Atribut Musuh Asli** (`enemy.json`): HP, CP, Agility, Dodge, Critical, Accuracy, Purify, Reactive Force, Combustion, serta damage & cooldown tiap jurus boss.

### 🏘️ Fitur Village Hub (Mobile App)
- **Missions**: Pertarungan 1–3 musuh dengan reward XP, Gold, dan Level Up.
- **Shop, Gear & Stats**: Beli & equip Weapon, Clothing, Back Item, Jutsu, serta alokasi Attribute Points.
- **Pet House**: 142 pet asli lengkap dengan live preview SWF, Buy, Equip, dan Unequip.
- **Advance Academy**: Upgrade jutsu per elemen (`Fire`, `Wind`, `Thunder`, `Earth`, `Water`, `Genjutsu`).
- **Hunting House**: 5 Zona Boss asli, klaim Daily Kari Badge, Boss Hunt 36 FPS, dan Hunting Market Forge.
- **Forge (Blacksmith)**: 65 resep tempa senjata resmi menggunakan Gold atau Tokens.
- **Talent Hall**: Extreme & Secret Talent discovery serta upgrade skill menggunakan TP (Lv. 1–10).
- **Live PvP Arena (`:3000`) & World Chat (`:3002`)**.
- **All Game Assets Explorer**: Akses langsung ke 7.459+ aset SWF asli (11 kategori) dan audio MP3.

---

## 📋 Prasyarat

- **Docker** & **Docker Compose** (direkomendasikan untuk menjalankan semua server sekaligus)
- **Node.js 20+** & **npm** (untuk menjalankan aplikasi mobile Expo)
- **Expo Go** di HP Android/iOS (terhubung ke jaringan Wi-Fi / LAN yang sama dengan server)

---

## 🚀 Cara Menjalankan Project

### 1. Clone Repository

```bash
git clone https://github.com/madicemerlang/Ninja-Saga-Private-Server.git
cd Ninja-Saga-Private-Server
```

---

### 2. Konfigurasi Environment Docker

Salin file contoh `.env.docker.example` menjadi `.env` di root repository:

```bash
cp .env.docker.example .env
```

Edit `.env` dan ganti `192.168.1.10` dengan **IP LAN komputer/server Anda** (cek via `ip a` di Linux/Mac atau `ipconfig` di Windows):

```env
HTTP_PORT=8080
MYSQL_PORT=3306
PVP_PORT=3000
CHAT_PORT=3002

APP_ENV=local
APP_DEBUG=true
APP_URL=http://<IP_LAN_ANDA>:8080

DB_DATABASE=ninjasage
DB_PASSWORD=ninjasage_secret

PVP_SOCKET_URL=http://<IP_LAN_ANDA>:3000/pvp
CHAT_SOCKET_URL=http://<IP_LAN_ANDA>:3002
CHAT_ADMIN_SECRET=change-me-to-a-random-secret
```

> Juga pastikan `Database/Laragon/ninjasage/.env` sudah ada (jika belum, jalankan `cp Database/Laragon/ninjasage/.env.example Database/Laragon/ninjasage/.env`).

---

### 3. Jalankan Semua Server Backend via Docker

```bash
docker compose up -d --build
```

Perintah ini otomatis menyalakan 5 container:

| Service | Container | Port | Fungsi |
| :--- | :--- | :--- | :--- |
| `nginx` | `ninjasage-nginx` | `8080` | Web server, REST API Mobile, Ruffle WASM, SWF & Game Data |
| `app` | `ninjasage-app` | internal | PHP-FPM Laravel + Python `swf_builder.py` |
| `mysql` | `ninjasage-mysql` | `3306` | Database MySQL 8.0 |
| `pvp-server` | `ninjasage-pvp` | `3000` | Socket.IO Live PvP Server |
| `chat-server` | `ninjasage-chat` | `3002` | Socket.IO World & Clan Chat Server |

#### Inisialisasi Laravel & Database (Pertama Kali Saja)

```bash
docker exec -it ninjasage-app composer install
docker exec -it ninjasage-app php artisan key:generate
docker exec -it ninjasage-app php artisan migrate --seed
```

#### Verifikasi Server Berjalan

```bash
curl http://127.0.0.1:8080/api/v1/health
curl http://127.0.0.1:8080/api/v1/assets/catalog
```

**Admin Panel**: `http://<IP_LAN_ANDA>:8080/admin/login`
- Email default: `admin@admin.test`
- Password default: `admin`

---

### 4. Jalankan Aplikasi Mobile (Expo)

Buka terminal baru dan masuk ke folder `mobile-app`:

```bash
cd mobile-app
npm install
```

Jalankan Expo Metro Bundler dengan alamat IP server Anda:

```bash
EXPO_PUBLIC_API_BASE_URL=http://<IP_LAN_ANDA>:8080 npx expo start
```

> Atau Anda bisa langsung menjalankan `npx expo start` lalu mengubah **Server URL** di layar Login aplikasi.

1. Buka aplikasi **Expo Go** di HP Android/iOS (pastikan 1 jaringan Wi-Fi dengan server).
2. Scan QR Code yang muncul di terminal.
3. Login / Register akun baru, buat karakter ninja, dan mulai bermain!

#### Cek TypeScript (Opsional untuk Development)

```bash
cd mobile-app
npm run typecheck
```

---

## 📁 Struktur Repository

```text
Ninja-Saga-Private-Server/
├── docker-compose.yml              # Orkestrasi MySQL, PHP-FPM, Nginx, PvP, Chat
├── .env.docker.example             # Template environment Docker
├── docker/                         # Dockerfile PHP+Python & konfigurasi Nginx
├── Custom Client/
│   └── NS Custom Client V1/        # 7.459+ aset SWF & audio asli Ninja Saga
├── Database/
│   └── Laragon/ninjasage/          # Backend Laravel, AMF Services, game_data JSON,
│       ├── app/Http/Controllers/Api/   # MobileAuth, MobileGame, SwfAssetController
│       ├── scripts/swf_builder.py      # Compiler SWF 36 FPS Unified Battle Stage
│       ├── public/game_data/           # skills, skill-effect, enemy, pet, talents, library
│       ├── public/ruffle/              # Self-hosted Ruffle WASM runtime
│       ├── public/audio/               # bgm.mp3, battle.mp3, click.mp3, xmas.mp3
│       ├── pvp-server/                 # Node.js Socket.IO PvP Server (:3000)
│       └── chat-server/                # Node.js Socket.IO Chat Server (:3002)
└── mobile-app/                     # Aplikasi Mobile React Native (Expo + TypeScript)
    └── src/
        ├── api/                    # REST/RPC Client & Game Data loader
        ├── engine/battleEngine.ts  # Combat, Agility Timeline, Buff/Debuff, Enemy stats
        ├── stage/                  # Ruffle WebView bridge
        └── screens/                # Battle, VillageHub, Pet, Academy, Hunting, Forge, Talent, PvP, Chat
```

---

## 🛠️ Troubleshooting

- **HP tidak bisa konek ke Server URL (`http://<IP_LAN>:8080`)**:
  - Pastikan HP dan PC/server berada di jaringan Wi-Fi/LAN yang sama.
  - Pastikan firewall mengizinkan port `8080`, `3000`, dan `3002`.
- **Animasi SWF masih menampilkan versi lama setelah update `swf_builder.py`**:
  - Bersihkan cache SWF di server:
    ```bash
    rm -f Database/Laragon/ninjasage/storage/app/swf_cache/battle_*.swf
    ```
- **Menjalankan dengan Laragon (Windows tanpa Docker)**:
  - Salin `Database/Laragon/ninjasage` ke `C:\laragon\www\ninjasage`, aktifkan PHP 8.4+ dan ekstensi `zip`, jalankan `composer install`, `php artisan key:generate`, `php artisan migrate --seed`, lalu jalankan `npm start` di folder `chat-server` dan `pvp-server`.
