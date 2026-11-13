# Patch notes — v22 foundation refactor

## Changed

- `coffeeFetch` POST now waits for the Apps Script response and accepts success only for a valid JSON response with `ok: true`.
- Explicit server errors are returned as errors; local state is not falsely marked as confirmed.
- Offline/ambiguous writes receive a stable `operationId`, are stored in a FIFO local outbox, and are applied locally with an explicit `pending` marker.
- Outbox retry runs when the browser fires the `online` event; queued operations are removed only after server confirmation.
- Queue capacity is capped at 250; when full, a new offline write is rejected rather than dropping existing queued work.
- Apps Script now checks `operationId` before dispatch and stores confirmed results in `API_OPERATIONS` plus `CacheService`.
- Legacy cloud-sync writer was removed. The legacy `CLOUD_SYNC_V17` envelope remains readable for backward compatibility.
- Removed extraction of a supposed PIN from the system task `responsible` field.
- Added contract and runtime tests for the shared transport and offline queue.

## Verification

- `node tests/unit-tests.js` — 18/18 passed.
- `node tests/integration-contract-tests.js` — 6/6 passed.
- `node tests/transport-runtime-tests.js` — passed.
- `node --check` for frontend JavaScript and the Apps Script source (copied to `.js`) — passed.

## Not included / still required

This is not a complete rewrite of every business module. Default PIN fallbacks, staff server sessions, real media storage, complete financial model, and live GAS/Spreadsheet acceptance tests remain outstanding. See `ARCHITECTURE_V22.md` and `DEPLOYMENT_MIGRATION_V22.md`.

# v22.1 — fixes after audit of the delivered archive

## Fixed
- `dashboard.html`, `owner.html`, `report.html`: inline script had a `SyntaxError` (CSV export line `lines.join('\r\n')` / `'\uFEFF'` had been written as a literal newline and BOM), so these pages did not run at all. The owner/admin code is now a real source file, `js/page-owner.js`, and the three pages are thin shells (4 KB instead of ~400 KB each; `owner.html` and `dashboard.html` were byte-identical copies). They now load `app.js`, so the PIN gate works on them. Styles live in `css/owner.css`.
- `barista.html` was a stale 400 KB bundle; it is now the same page as `index.html`.
- Auth bypass removed: `js/page-admin.js` silently created an admin session on every load and reset the PIN brute-force limiter; `isPinAuthorized` in `js/sync.js` granted admin when the admin DOM was present or when `localStorage.coffee_active_barista` was set.
- `sw.js`: precache includes `css/owner.css` and `js/page-owner.js`; cache name bumped to `v22.1`.

## Verification
- All tests in `tests/` pass (19 unit, 6 contract/GAS, 12 e2e, transport runtime).
- All six HTML pages load in jsdom with no script errors; owner/admin pages show the PIN gate when unauthenticated, and all three owner sections render after login.

## Still open (unchanged)
Default PIN fallbacks in `Code.gs` / `js/security.js`, server-issued staff sessions, live GAS/Spreadsheet acceptance tests, and a signed-off financial model. See `DEPLOYMENT_MIGRATION_V22.md`.

# v22.2 — automatic delivery of edits to the server

- Fixed: when the server answered with a non-network error (old Apps Script version, expired session, lock/5xx), `coffeeFetch` applied the edit **locally only** and reported success; it was never sent. Such edits are now queued in the outbox and retried automatically until the server confirms.
- Outbox flush: fresh session token on every attempt, exponential backoff (5 s – 2 min), order preserved; operations rejected as `VALIDATION_FAILED` (or after 30 attempts) are parked in `coffee_api_outbox_failed_v1` instead of blocking the whole queue; the badge shows `⚠️ Не отправлено: N` for them.
- Triggers: right after queuing, every 5 s, on `online`, tab focus/visibility and startup. The terminal's legacy queue (`coffee_illy_queue`) now also flushes automatically (startup, every 8 s, visibility) rather than only on the `online` event or button.
- Tests extended (transient error is queued and delivered; invalid op does not block the queue).

# v22.3 — live synchronisation ("single system")

- `Code.gs`: new data revision (`DATA_REV`) bumped on every successful write and on manual edits of the spreadsheet (simple `onEdit` trigger); public cheap `GET ?action=get_rev`; `get_checklists` and every write result carry `rev`. Login/logout do not bump it.
- `js/sync.js`: `coffeeLiveSyncTick` polls `get_rev` (3 s while the user is active, 8 s idle, 30 s in a hidden tab; immediately on focus/online/visibility and after the outbox is delivered). On a change it pulls fresh data and emits `server_sync{live:true}`; terminal, owner panel and admin re-render. Own unsent edits are never overwritten by remote data; open edit dialogs are not re-rendered under the user.
- Same browser (several tabs) stays instantaneous through `coffeeBus`.
- Tests: GAS test 7 (revision), `tests/live-sync-tests.js`.
- Deployment: after replacing `Code.gs` create a new Web App deployment version. The `onEdit` simple trigger works automatically; nothing to install.

# v22.4 — светлый интерфейс и надёжная камера

- Тема по умолчанию светлая на всех страницах; тема ОС и Telegram больше не переключают её. Тёмная — кнопкой 🌙 (выбор сохраняется).
- Новый `css/light.css`: светлая палитра, лёгкая шапка, блоки чек-листов в 3 колонки, читаемая навигация владельца, вкладки админки, статусы, окна.
- `js/camera.js`: камера — модальный `<dialog>` (всегда поверх формы поломки), закрывается по Escape и при сворачивании приложения.
- Кнопка 🚨 «Сообщить о поломке» в шапке терминала (доступна с любого экрана).
- Окно уведомления владельца: без пустого блока фото для системных событий, заголовок «Что произошло».
- `sw.js`: кэш v22.4, в предзагрузке `css/light.css`.

Проверено: все автотесты проходят; в браузере с эмулятором камеры пройден путь «форма → 2 фото + видео → отправка → окно у владельца».

- Удалена кнопка «📸 Контрольный снимок со штампом» и генератор кадра без камеры. Раньше при недоступной камере такой кадр прикреплялся автоматически. Теперь фото можно получить только живой съёмкой; если камера недоступна, показывается сообщение с причиной.

# v50 — отчёты и проверка сервера

- **Отчёты были пустыми:** `renderOwnerReportSection()` собирала HTML, но не вставляла его в `#ownerSecReport`. Теперь вставляется (с защитой от лишней перерисовки).
- **Блок «Сотрудники»:** читался `rep.staff` (массив анкет) как карта «имя → цифры» — строки «0», «1», `undefined`. Теперь берётся `rep.staffSummary`.
- Выручка сотрудника при единственной смене без записанных сумм берётся из итогов дня; без смен за период выплата 0 (а не ставка 250).
- «Продажи по позициям» учитывают позиции, сохранённые в кассовой смене, если нет загрузки «Продажи.csv».
- «-0 руб.» в посуточной ведомости заменено на «0 руб.».
- Баннер «сервер устарел / нет доступа» (`coffeeCheckServer`) больше не перекрывает шапку; `Code.gs` отвечает на `action=version` с `api: 2`.

# v51 — улучшения отчётов
- Сравнение с прошлым периодом такой же длины (▲/▼ %) на карточках выручки, себестоимости, ФОТ+OpEx, прибыли и чеков.
- Строка «Главное за период» (лучший/слабый день, топ позиция, план, расхождения Z, открытые поломки).
- Закреплённая панель: период, оглавление (P&L, По дням, Продажи, Сотрудники, Чек-листы, Поломки), Excel / CSV / печать. Для работы sticky `html, body` переведены на `overflow-x: clip`.
- «Продажи по позициям»: если в данных нет суммы, выручка считается по цене из техкарты и помечается «≈».
- Экспорт в Excel (.xls, 6 листов: Сводка, По дням, Сотрудники, Расходы, Продажи по позициям, Поломки) без внешних библиотек.
- Печать скрывает навигацию и кнопки. Новый тест `tests/report-browser-test.js`. Кэш sw.js v51.

# v52 — скорость и синхронизация
- Замер `getUDB()` на базе в 365 дней и 400 чек-листов с фото (фото лежат в IndexedDB, в localStorage 3 копии по ~160 КБ): ~2 мс на вызов, расчёт отчёта за 30 дней ~10 мс. Узким местом это не является, переписывать не стали.
- `js/sync.js`: опрос `get_rev` замедляется в простое ступенями (4 с → 10 с через 3 мин → 20 с через 15 мин → 30 с через час; скрытая вкладка 60 с), при ошибках — экспоненциальная пауза до 2 мин, плюс небольшой разброс между устройствами.
- `Code.gs`: `ensureSheets_` берёт список листов одним вызовом `getSheets()` и выполняется не чаще раза в 10 минут (флаг в CacheService), а не на каждый запрос. Поиск повтора в `API_OPERATIONS` идёт по последним 1500 операциям вместо 5000. После замены `Code.gs` нужна новая версия развёртывания Web App.
- Тест мока Code.gs дополнен `getSheets()`. Кэш sw.js v52.

# v52 — чистка проекта
- Новый `version.js` — единственное место с номером версии (`COFFEE_VERSION`, имя кэша `COFFEE_CACHE_NAME`). Менять командой `node tools/bump-version.js 53` (обновляет `version.js` и все `?v=` в страницах).
- Исправлена очистка кэша: встроенные скрипты и `app.js` при каждой загрузке удаляли все кэши, кроме устаревшего имени `kofeinya-enterprise-v48-tg-sync`, то есть и актуальный кэш сервис-воркера. Теперь очистка выполняется один раз при смене версии (в `version.js`), а `sw.js` берёт имя кэша из той же константы.
- `barista.html`, `barista_terminal.html`, `owner_admin_app.html` теперь заглушки-перенаправления на `index.html` / `owner.html` (старые ссылки и закладки работают, параметры адреса сохраняются). Дубликатов по 400 КБ больше нет.
- Удалён неподключённый код: `js/page-report.js`, `js/page-dashboard.js`, `css/report.css`, `css/dashboard.css` (и из предзагрузки `sw.js`). Контрактный тест обновлён.
