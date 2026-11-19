# Coffee Illy v91.0 — Material 3 Soft Production Release

Полная боевая версия в новом минималистичном дизайне Material 3 Soft (автотема ОС и Telegram, живая синхронизация с Google Apps Script + офлайн-очередь + `BroadcastChannel`).

## Состав релиза
- `index.html` (`barista.html`, `barista_terminal.html`) — Терминал бариста и Telegram Mini App.
- `owner.html` (`admin.html`, `dashboard.html`, `owner_admin_app.html`) — Дашборд владельца.
- `config.js` — URL вашего веб-приложения Google Apps Script (`/exec`).
- `js/cloud-sync-v91.js` — облачная синхронизация `get_rev`, очередь офлайн-записей и интеграция Telegram WebApp.
- `sw.js` + `manifest.webmanifest` — PWA Service Worker (автоматически удаляет старый кэш `v87–v90`).
- `Code.gs` — серверный скрипт Google Apps Script для таблицы `Coffee_illy`.

## Установка на GitHub Pages
```bash
cd /c/Users/COMP/Documents/GitHub/coffee-illy
git rm -rf .
```
Распакуйте содержимое `coffee-illy-v91.0-m3soft-production.zip` в `C:\Users\COMP\Documents\GitHub\coffee-illy` и выполните:
```bash
git add -A
git commit -m "Deploy M3 Soft Production v91.0"
git push
```
