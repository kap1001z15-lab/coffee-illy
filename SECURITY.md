# Security Policy — Coffee Illy ERP & Checklist

## Хранение секретов и конфигурация
- В репозитории **запрещено** хранить реальные токены Telegram-бота, PIN-коды, пароли, ключи подписи приложений и ID приватных таблиц.
- Все серверные секреты (`SPREADSHEET_ID`, `TG_BOT_TOKEN_SECRET`, `TG_CHAT_ID_SECRET`, `ADMIN_PIN_HASH`, `PIN_PEPPER`, `STAFF_PIN_HASH_*`) хранятся исключительно в Google Apps Script `PropertiesService.getScriptProperties()`.
- URL опубликованного Web App GAS передаётся на фронтенд через `config.js` (или через GitHub Secrets `COFFEE_API_URL` на этапе CI/CD).

## Аутентификация и контроль доступа
- Проверка PIN-кодов и ролей (`staff` / `admin`) выполняется на сервере (`Code.gs`).
- Хранение PIN-кодов использует солёный хеш `v2$` с `PIN_PEPPER` (старые SHA-256 хеши автоматически мигрируются при успешном входе).
- Для Telegram Mini App проверяется HMAC-SHA256 подпись `initData` с использованием `TG_BOT_TOKEN_SECRET`.
- Защита от перебора (brute-force): персистентные счётчики в `PropertiesService` с эскалацией блокировки (1 → 5 → 15 → 60 минут).
- Сессии имеют ограниченный срок жизни (`SESS_*`), привязываются к эпохе (`EPOCH_*`) для мгновенного отзыва доступа и автоматически очищаются функцией `cleanupSessions_()`.

## Медиафайлы и логирование
- Фото и видео чек-листов загружаются в Google Drive по умолчанию с приватным доступом (`DriveApp.Access.PRIVATE`), если явно не включён флаг `ALLOW_PUBLIC_PHOTO_LINKS=1`.
- Логи ошибок (`Errors` sheet) автоматически маскируют параметры `token`, `sessionToken`, `pin`, `adminPin`, `botToken` и токены Telegram.

## Сообщение об уязвимостях
Если вы обнаружили проблему безопасности, создайте приватный security advisory в репозитории GitHub или свяжитесь с владельцем проекта напрямую, не публикуя эксплойты в открытых issues.
