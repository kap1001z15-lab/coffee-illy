# Coffee Illy ERP & Checklist (v97.15.6)

Кроссплатформенная система управления кофейней и чек-листами: **Терминал бариста** (`index.html`) + **Дашборд владельца** (`owner.html`), работающая как **PWA** (Android, iOS, macOS, Windows) и **Telegram Mini App** с серверной частью на **Google Apps Script (V8)** и базой в **Google Sheets + Google Drive**.

## Архитектура проекта

```text
coffee-illy/
├── index.html                 # Терминал бариста (PWA + Telegram Mini App)
├── owner.html                 # Дашборд владельца (8 вкладок ERP)
├── config.js                  # Runtime-конфигурация (без секретов)
├── config.example.js          # Шаблон конфигурации
├── version.js                 # Версия сборки (v97.15.6)
├── sw.js                      # Service Worker (офлайн-кэш + автообновление)
├── manifest.webmanifest       # PWA-манифест (Android/iOS/macOS/Windows)
├── css/
│   └── m3-soft.css            # Единая дизайн-система Material 3 Soft
├── js/
│   ├── camera.js              # Единый модуль камеры (фото + видео 15с, мультисъёмка, без галереи)
│   ├── cloud-sync.js          # Синхронизация, офлайн-очередь (exponential backoff), Telegram auth
│   ├── pos-csv-parser.js      # Парсер POS CSV с 3-уровневой дедупликацией
│   └── time-picker.js         # Google Pixel Material 3 24h Time Picker
├── icons/                     # PWA-иконки (192x192, 512x512, maskable)
├── tests/                     # Автотесты Node.js (без внешних зависимостей)
└── .github/workflows/ci.yml   # CI: синтаксис, автотесты, проверка секретов, релизный пакет
```

> Серверная часть (`Code.gs`, `appsscript.json`, `DEPLOY_GAS.md`) поставляется отдельным комплектом `coffee-illy-v97.15.6-gas.zip`.

## Быстрый старт (локально и GitHub Pages)

1. Скопируйте `config.example.js` в `config.js` и укажите URL вашего опубликованного Google Apps Script (`/exec`).
2. Для локального запуска (обязательно через HTTP/HTTPS, не `file://`, чтобы работали Service Worker и камера):
   ```bash
   python3 -m http.server 8080
   ```
   Откройте `http://localhost:8080/index.html` (бариста) или `http://localhost:8080/owner.html` (владелец).
3. Для публикации на **GitHub Pages**:
   - В репозитории откройте **Settings → Pages → Source: Deploy from a branch (`main` / root)**.
   - Опционально задайте GitHub Secret `COFFEE_API_URL`, чтобы workflow автоматически собирал артефакт с подставленным URL.

## Тестирование

Требуется Node.js 18+ (внешние npm-пакеты не требуются):
```bash
npm run lint:syntax
npm test
```

## Кроссплатформенность (Android, iOS, macOS, Windows)

- **PWA (из коробки)**: устанавливается на рабочий стол на Android (Chrome), iOS (Safari → Поделиться → На экран «Домой»), macOS (Safari/Chrome), Windows (Edge/Chrome).
- **Ограничения PWA**: браузерная PWA не имеет прямого доступа к системному Keychain/Keystore/DPAPI, фоновой синхронизации на iOS Safari и публикации в App Store / Google Play без нативной обёртки.
- **Публикация в сторы (опционально)**:
  - **Android / iOS**: обернуть текущий статический фронтенд в [Capacitor](https://capacitorjs.com/) (`npx cap init`, `npx cap add android`, `npx cap add ios`) с плагинами `@capacitor/camera` и `capacitor-secure-storage-plugin` (Keychain/Keystore).
  - **macOS / Windows**: обернуть в [Tauri](https://tauri.app/) или [Electron](https://www.electronjs.org/) с `safeStorage` (DPAPI / macOS Keychain).
