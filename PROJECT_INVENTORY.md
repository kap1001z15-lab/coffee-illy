# PROJECT INVENTORY — Карта репозитория и модулей Coffee Illy (v71)
Актуальная версия: v71

## 1. Точки входа и HTML-страницы
| Файл | Назначение | Роль | Основные зависимости |
|---|---|---|---|
| `index.html` | Мобильный терминал бариста (PWA / Telegram Mini App) | Бариста | `css/terminal.css`, `css/light.css`, `config.js`, `js/defaults.js`, `js/security.js`, `js/storage.js`, `js/analytics.js`, `js/sales-reconciliation.js`, `js/sync.js`, `js/telegram.js`, `js/camera.js`, `js/page-terminal.js`, `app.js` |
| `owner.html` | Объединённое рабочее пространство владельца (9 разделов) и администратора (11 разделов) | Владелец / Администратор | `css/owner.css`, `css/light.css`, `config.js`, `js/defaults.js`, `js/security.js`, `js/storage.js`, `js/analytics.js`, `js/sales-reconciliation.js`, `js/sync.js`, `js/telegram.js`, `tests/unit-tests.js`, `js/page-admin.js`, `js/page-owner.js`, `app.js` |
| `admin.html` | Прямая точка входа в раздел управления (`OWNER_START_SECTION='admin'`) | Администратор | Те же модули, что и `owner.html` |
| `dashboard.html` | Прямая точка входа в оперативный дашборд (`OWNER_START_SECTION='dashboard'`) | Владелец / Администратор | Те же модули, что и `owner.html` |
| `report.html` | Прямая точка входа в финансовые отчёты и P&L (`OWNER_START_SECTION='report'`) | Владелец | Те же модули, что и `owner.html` |
| `diag.html` | Автономная страница диагностики транспорта, ревизий и очереди | Администратор / Владелец | `config.js`, `js/storage.js`, `js/sync.js` |
| `barista.html`, `barista_terminal.html` | Совместимые перенаправления на `index.html` для старых закладок | Бариста | Перенаправление без потери query-параметров |
| `owner_admin_app.html` | Совместимое перенаправление на `owner.html` | Владелец | Перенаправление без потери query-параметров |
| `coffee_illy_v67_live.html` | Автономный интерактивный стенд для тестирования всех 3 ролей в Canvas | Все роли | Включает весь стек `v71` в одном файле |

## 2. JavaScript-модули (`js/` и корень)
| Модуль | Ответственность | Ключевые глобальные функции / объекты |
|---|---|---|
| `version.js` | Единый источник номера релиза и имени кэша PWA | `COFFEE_VERSION = 'v71'`, `COFFEE_CACHE_NAME` |
| `config.js` | Шина событий `BroadcastChannel`, загрузка метаданных, базовый URL GAS API | `window.COFFEE`, `window.coffeeBus`, `window.coffeeNormalizeSettingKey` |
| `js/defaults.js` | Стартовые справочники: 91 задача чек-листов, ТТК, 6 окон таймлайна, планы Пн–Вс, склад, хеши PIN | `COFFEE_DEFAULT_TTK`, `COFFEE_DEFAULT_INVENTORY`, `COFFEE_DEFAULT_DAILY_PLANS` |
| `js/security.js` | SHA-256 с солью `coffee_salt_v21:`, Rate-Limiter (5 попыток / 15 мин), подписанные токены сессии, XSS-санитизация | `window.coffeeSha256Hex`, `window.coffeeRateLimiter`, `window.coffeeAuth`, `window.escapeHtml` |
| `js/storage.js` | Локальное хранилище `Permanent Owner Vault`, `IndexedDB` (`CoffeeIDB`) для медиа, резервный `_memVaultFallback`, авто-бэкапы и единый справочник сотрудников | `getUDB`, `saveUDB`, `window.coffeeVault`, `window.CoffeeIDB`, `window.coffeeSyncStaffDirectory`, `window.coffeeAutoBackupManager` |
| `js/analytics.js` | Расчёт окон таймлайна, планов Пн–Вс, P&L модели (COGS по ТТК, ФОТ, OpEx, чистая прибыль), детектор «Красных флагов», централизованные уведомления P0/P1/P2 | `window.coffeeGetBlockWindow`, `window.coffeeCalculateFinancialModel`, `window.coffeeEvaluateRedFlags`, `window.coffeeCentralNotifier` |
| `js/sales-reconciliation.js` | Парсер CSV/TXT (`Продажи.csv`, `Транзакции.csv`), классификация `coffee / non-coffee / review`, расчёт переходов счётчика `999 -> 0` | `window.CoffeeSalesReconciliation`, `window.coffeeCounterDelta` |
| `js/sync.js` | Надёжный транспорт `coffeeFetch`, персистентная FIFO-очередь `coffee_api_outbox_v1`, дельта-синхронизация по `DATA_REV` | `window.coffeeFetch`, `window.coffeeFlushOutbox`, `window.coffeeGetOutboxStatus`, `window.coffeeLiveSyncNow` |
| `js/telegram.js` | Интеграция с Telegram Bot API и Mini App (`initDataUnsafe.user.id`), отправка фото/видео поломок и сводок | `window.coffeeTelegram`, `window.coffeeTgMiniApp` |
| `js/camera.js` | Живая камера (`getUserMedia`, основная/фронтальная, вспышка, водяной знак даты/точки/сотрудника, сжатие видео) | `window.coffeeCamera` |
| `js/page-terminal.js` | Логика терминала бариста (4 вкладки, 5-шаговая сдача кассы, профиль, блок внимания, офлайн-черновики) | `window.switchBaristaBottomNav`, `window.updateMyShiftSummaryCard` |
| `js/page-admin.js` | Логика панели администратора (таймлайн, задачи + Канбан 5 колонок, касса, персонал, ТТК, склад, расходы, аудит, экран техсостояния) | `load`, `render`, `rChecklists`, `rTasksAndInfo`, `rCash`, `rTtk`, `rStaff`, `rInc`, `rAudit`, `rSet` |
| `js/page-owner.js` | Логика панели владельца (дашборд с SVG-графиками, 3 режима финансов, мастер-деталь продаж, боковая панель событий) | `renderOwnerDashboardSection`, `renderOwnerReportSection`, `switchWorkspaceRole` |
| `Code.gs` | Серверный backend Google Apps Script (42+ API действий, 16 листов Google Sheets, идемпотентность `API_OPERATIONS`, сохранение фото в Google Drive) | `doGet`, `doPost`, `handleAction_` |

## 3. Автоматизированные тестовые наборы (`tests/`)
1. `tests/unit-tests.js` — 19 модульных проверок безопасности, финансов, таймлайна и дельта-синхронизации.
2. `tests/ui-buttons-e2e-tests.js` — 13 сквозных E2E-тестов всех кнопок управления, единого справочника сотрудников, уведомлений P0/P1/P2 и авто-бэкапов.
3. `tests/gas-server-security-tests.js` — 11 серверных тестов `Code.gs` (сессии, идемпотентность, валидация, Google Drive, пакетная касса).
4. `tests/integration-contract-tests.js` — 6 проверок контрактов транспорта и очереди `operationId`.
5. `tests/sales-reconciliation-tests.js` — эталонная проверка парсинга CSV и счётчика кофемашины (`648 -> 735`, `998 -> 2`, `999 -> 0`).
6. `tests/transport-runtime-tests.js` — проверка отказоустойчивости FIFO-очереди при обрывах связи и ошибках сервера.
7. `tests/live-sync-tests.js` — проверка живой синхронизации по `get_rev` без потери несинхронизированных локальных операций.
8. `tests/report-browser-test.js` — проверка рендеринга всех разделов владельца и экспорта 6-листового Excel-отчёта в виртуальном DOM.
