## v97.15.3 (2026-11-23)
- Исправлен офлайн-кэш Service Worker (`ignoreSearch: true`, разделение фолбэков HTML и JS/CSS).
- Устранены коллизии DOM ID в модалках `dashboard.html` и убран остаток `s.pin` в модалке сотрудника.
- Офлайн-очередь `outbox` переведена на `IndexedDB` с защитой финансовых операций и очередью проблемных записей; добавлен типизированный `dispatchOperation()`.
- В `Code.gs` добавлена защита от лимита 9 КБ `PropertiesService` и отключены защищённые `GET`-запросы (`admin`, `dashboard`, `report`).
- Подключён `css/m3-soft.css` с адаптивностью для экранов `<= 380px`, сенсорных кнопок `>= 44px` и скелетон-анимацией; `owner.html` переведён в лёгкий редирект на `dashboard.html`.
- Добавлен GitHub Actions CI/CD workflow (`.github/workflows/ci-deploy.yml`).

# Changelog

## [v97.0.0] — 2026-11-20
### Исправлено (Критично)
- **Backend (`Code.gs`)**: удалён жёстко зашитый `TARGET_SPREADSHEET_ID` (теперь берётся из `getActiveSpreadsheet()` или `ScriptProperties.SPREADSHEET_ID`) и плейсхолдер `[suspicious link removed]`.
- **Backend (`Code.gs`)**: исправлен `ReferenceError: shS` в `getStaffList_`, implicit global `ss` в `doGet`, дубликаты обработчиков `upload_photo` и `change_staff_pin` в `doPost`, лишний 5-й аргумент в `idempotentJsonOut_`.
- **Backend (`Code.gs`)**: исправлен Telegram auto-login (`findStaffByTelegramId_` теперь корректно читает и строковый, и объектный формат `{ tgId, staffName }` в `COFFEE_TG_USER_BINDINGS_JSON`), `saveStaff_` теперь сохраняет 7-й столбец `tgId` и вызывает `bumpDataRev_()`.
- **Backend (`Code.gs`)**: исправлен неверный индекс столбца бариста в `sendDailyDigestNow_` (`rows[i][6]` вместо `rows[i][5]`), исправлен баг публичного доступа Drive в `applySecureDriveFileSharingV82_`, исправлено двойное экранирование HTML в `testTelegramAlertV93_`.
- **Backend (`Code.gs`)**: исправлен рассинхрон журнала аудита (`getAdmin_` теперь читает лист `Журнал`, куда пишет `appendAudit_`, с fallback на `Аудит`).
- **Frontend (`js/pos-csv-parser.js`)**: восстановлены 4 повреждённых регулярных выражения разбора дат и имён файлов POS CSV.
- **Frontend (`index.html`)**: удалён зашитый plaintext PIN `'1234'` из клиентского состояния.

### Добавлено и улучшено
- **Безопасность**: персистентный rate-limiter на `PropertiesService` с эскалацией блокировки (1 / 5 / 15 / 60 мин) и Telegram-алертом без сброса активной сессии владельца; автообновление устаревших SHA-256 PIN-хешей до `v2$` с солью; `cleanupSessions_()` для очистки истёкших сессий; централизованный `logError_` в лист `Errors` с маскированием токенов.
- **Синхронизация**: антигоночный счётчик `_localMutationSeq`, экспоненциальная задержка (`computeBackoffMs`) в офлайн-очереди `outbox`, обработка `SERVER_BUSY` при таймауте `LockService`, обновление состояния при `pageshow` (iOS Safari bfcache), `bumpDataRev_()` на всех мутациях.
- **Камера (`js/camera.js`)**: объединён единый модуль (удалён дубликат `camera-v92.js`), добавлен выбор из нескольких камер для Windows/macOS, освобождение/восстановление потока при `visibilitychange`, мультисъёмка фото + видео до 15 сек без галереи.
- **UI/UX**: общий `css/m3-soft.css` с `safe-area-inset-*`, 1-tap radio cards, панелью скрытия клавиатуры «Готово ⌄», компонентом Google Pixel Material 3 Time Picker (`js/time-picker.js`), сохранением фокуса поиска на вкладке «Продажи» в `owner.html`, PWA-манифестом и иконками.
- **Склад**: автозаполнение 24 базовых позиций, действие `delete_inventory`, Telegram-уведомление о низких остатках.
- **Тестирование и CI/CD**: набор автотестов Node.js (`tests/*.test.mjs`), встроенные самотесты `runSelfTests()` в `Code.gs`, workflow `.github/workflows/ci.yml`.
