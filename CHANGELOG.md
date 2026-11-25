## v97.19.0 (2026-11-25)
- **Умные уведомления Telegram без спама и утренних побудок в 05:47**:
  - Добавлены «Тихие часы» (по умолчанию `07:30 – 23:30`, настраиваются до минуты прямо в дашборде в разделе **Управление → Telegram-бот**).
  - Уведомления «За 15 мин до старта» отключены по умолчанию, а одновременные уведомления по нескольким блокам группируются в **одно аккуратное сообщение** вместо 3–5 подряд.
  - В дашборде (**Управление**) появились понятные галочки включения/выключения каждого типа уведомлений (`За 15 мин до старта`, `При открытии`, `За 15 мин до дедлайна`, `При просрочке`).
- **Устранена ложная просрочка сданных чек-листов**: проверка выполнения в `cronCheckDeadlinesAndDigest` и `checkAndNotifyChecklistWindows_` теперь сверяет и лист `Чек-листы`, и завершённые черновики (`completed: true`) без учёта регистра/пробелов, а также исправлен поиск ручных продлений дедлайнов в `DEADLINE_EXTENSIONS_JSON` (`YYYY-MM-DD:Блок`).

## v97.18.2 (2026-11-25)
- **Защита от обхода rate-limit (критично)**: счётчик неудачных попыток входа в `handleAuthLogin_()` привязан строго к аккаунту (`admin` / `staff_<имя>`), а не к клиентскому `clientId` — подмена `clientId` больше не сбрасывает блокировку; добавлено сравнение хешей за постоянное время `timingSafeEqualStr_()`.
- **Средний приоритет**: `ensureSheets_()` в `doPost` перенесён строго после авторизации (анонимные POST больше не создают нагрузку на таблицу); публичный `get_checklists` отдаёт только имена активных сотрудников; удалён устаревший GET-путь с приёмом токена в URL.
- **Низкий приоритет и CI**: генерация временного PIN переведена с `Math.random()` на `Utilities.getUuid()` + `sha256Hex_()`, все 7 тестовых файлов переведены на прямой путь `gas/Code.gs` без зависимости от внешней папки, `sw.js` использует отказоустойчивый `Promise.allSettled`, синхронизированы `README.md`, `DEPLOY_GAS.md` и `.env.example`.

## v97.18.1 (2026-11-25)
- **Авто-декодирование POS CSV (UTF-8 / Windows-1251)**: добавлены `decodeCsvBuffer()` и `readCsvFile()` в `js/pos-csv-parser.js` и подключены во все точки загрузки выписок кассы (`dashboard.html` и `index.html`) — русские выгрузки из Windows-касс в `Windows-1251` теперь читаются без искажения кириллицы.
- **Content-Security-Policy (CSP)**: добавлен строгий `<meta http-equiv="Content-Security-Policy">` в `dashboard.html` и `index.html`, разрешающий только доверенные источники (`self`, `telegram.org`, Google Fonts, Google Apps Script и Google Drive медиа).
- **Уборка заглушек и авто-подчистка `API_OPERATIONS`**: фиктивный `BKP-...` в `create_server_backup` заменён на реальное создание приватной копии таблицы на Google Drive (`createServerBackup_`), удалена неиспользуемая ветка `submit_writeoff`, а автоочистка `API_OPERATIONS` синхронизирована с окном поиска 1500 строк.

## v97.18.0 (2026-11-25)
- **Полная адаптация Telegram Web App + ПК-веб**: нативная привязка `Telegram.WebApp` (`disableVerticalSwipes`, авто-синхронизация `setHeaderColor`/`setBackgroundColor`/`setBottomBarColor` со светлой и тёмной темами, `viewportStableHeight`, `safeAreaInset` + `contentSafeAreaInset`, нативная кнопка `BackButton` для закрытия модальных окон, `overscroll-behavior-y: none` без случайного сворачивания Mini App) и широкая Bento-сетка для ПК (`1360px` / `1420px`).
- **Полная синхронизация ПК-веб ↔ Telegram Web App**: тихое автоматическое восстановление просроченной сессии сотрудника в Telegram Web App через подписанный `initData` HMAC без вылета в гостевой режим; добавлен сквозной E2E-тест #64 с настоящей HMAC-SHA256 подписью Telegram.

## v97.17.0 (2026-11-25)
- **Однократное разрешение камеры при входе в терминал**: `CoffeeCameraV94.prewarm({ keepAlive: true })` запрашивает доступ к камере один раз при входе в интерфейс и переводит поток в энергосберегающий standby (`track.enabled = false`) между шагами чек-листа — на всех следующих шагах (фото и 15-секундное видео) камера открывается мгновенно без повторных системных запросов разрешения (Android Telegram WebView / iOS Safari / PWA). Полное освобождение камеры выполняется при выходе из смены или закрытии вкладки.
- **Единый Apple iPhone Liquid Glass во всей системе**: интерфейс живой камеры (`js/camera.js`), модальные окна (`.modal-card`), уведомления (`.toast`) и карточки приведены к единому матовому стеклу с монохромными SF-иконками, фирменным двойным затвором iPhone и тактильным откликом.

## v97.16.2 (2026-11-25)
- **Apple iPhone Liquid Glass — объёмная подсветка активных вкладок и иерархия акцентов**: активные вкладки навигации (`Обзор`, `Продажи`, `Финансы`, и т.д. в дашборде и нижняя панель терминала) и выбранный период излучают мягкое объёмное радиальное свечение на матовое стекло позади них (`--lg-dock-ambient-x` / `--lg-bnav-ambient-x`), плавно следующее за выбранной кнопкой; неактивные и второстепенные кнопки визуально приглушены, чтобы фокус оставался на главном действии.
- **Видимая обработка проблемных операций (`getFailedOps`)**: в `dashboard.html` и `index.html` добавлен компактный баннер с кнопкой «Повторить», появляющийся только при отклонённых сервером операциях из очереди.
- **Полный аудит кнопок**: проверены все 43 кнопки дашборда и 26 кнопок терминала — 0 пустых/непривязанных кнопок.

## v97.16.1 (2026-11-25)
- **P0-3 (Защита первичной настройки)**: `setup_initial_credentials` на чистой установке теперь требует одноразовый `INITIAL_SETUP_CODE` из `ScriptProperties` (удаляется сразу после использования), принимает только цифровой PIN (`4–12` цифр, без 64-hex хешей) и проверяет существование сотрудников в листе `Сотрудники`.
- **P2 (Защита от формульных инъекций Google Sheets)**: хелперы `safeCell_()` / `safeRow_()` экранируют ведущие `=`, `+`, `-`, `@` апострофом `'` на всех путях `appendRow` и в `updateExpense_()`.
- **P3 (Очистка одноразовых кодов сброса PIN)**: `consumeStaffResetCode_()` удаляет ключ `RESET_<имя>` из `ScriptProperties` после использования или истечения срока.

## v97.16.0 (2026-11-25)
- **P0-1 (Telegram HMAC Auth)**: `handleAuthLogin_` теперь требует криптографическую проверку `verifyTelegramInitDataHmac_` (окно 2 часа) и сверку `tgUserId` перед автологином; `bind_telegram_user` принимает `initData`/`tgInitData` и передаёт подпись из клиента.
- **P0-2 (Zero Default PIN)**: убрано скрытое автосоздание PIN `1234` на непроинициализированных установках (сервер возвращает `SETUP_REQUIRED` до явного запуска `УСТАНОВИТЬ_ПАРОЛЬ_1234_И_ЗАПУСТИТЬ()` или `setup_initial_credentials`).
- **P1-1 (Green CI/CD)**: единый workflow `.github/workflows/ci-deploy.yml` (Node 20 + Node 22), все тесты читают `gas/Code.gs` напрямую, скан секретов без ложного срабатывания, деплой на GitHub Pages строго из чистой папки `dist/` (без `gas/`, `tests/`, `.github/`).
- **P1-2..P1-10**: блокировка `LockService` вокруг `auth_login`, привязка rate-limit к `clientId`, единая ошибка входа без перебора сотрудников, запрет передачи 64-hex хеша как пароля, ограничение `batch_submit_cash` для роли `staff` (только сегодня/вчера и режим `sum`), привязка очереди outbox к владельцу (`ownerName`), UTF-8 байтовый контроль лимита 9 КБ в `setJsonProp_`, приватные фото Drive по умолчанию (`PRIVATE`), минимальный публичный `get_checklists` без утечки склада/планов/графика и без `ensureSheets_`.
- **P2/P3**: экранирование кавычек в `escapeTgHtml_` + `safeTgHref_`, узкий Drive scope (`drive.file`), совместимость теста камеры с Node 22, `apple-touch-icon`, 4-секундный таймаут и корректный офлайн-фолбэк `dashboard.html` в `sw.js`, валидация `updateExpense_`.

## v97.15.6 (2026-11-24)
- Кросс-ОС синхронизация (Windows, macOS, Android, iOS, Telegram WebView): `fetchWithTimeout` (`AbortController`), `Telegram.WebApp.onEvent('activated')`, `BroadcastChannel` + `storage` для вкладок, `serverDate` для `deadlineExtensions`.

## v97.15.5 (2026-11-24)
- Единый дизайн Apple Liquid Retina, закреплённый док `.dash-sticky-dock` (`#admin-nav` + `#date-filter-bar`, `overflow-x: clip`), прямой ручной ввод времени `ЧЧ:ММ` с клавиатуры.

## v97.15.4 (2026-11-23)
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
