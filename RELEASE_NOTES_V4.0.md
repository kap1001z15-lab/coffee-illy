# Coffee Illy v4.0 (Build v87) — Отчёт об аудите, модернизации и релизе

## 1. Результаты аудита v86 (Этап 1)
При проверке исходного архива `kofeinya-v86-coffee-illy-redesign.zip` по требованиям `Coffee_Illy_Master_TZ_Final_v4.0.md` подтверждены следующие критические дефекты:
- **P0-1 (`get_rev`):** публичный `doGet?action=get_rev` при отличии `sinceRev` возвращал кэшированный `LIVE_ENV_V63` (`env`).
- **P0-2 (`get_checklists`):** публичный `doGet?action=get_checklists` возвращал `dailyPlans`, `plan`, `minAvgCheck`, `planChecks`, `woNorm`, `userDrafts`, `userActiveState`, `personalTasksDone`, `checklists`, `ttk` и `tgId` сотрудников.
- **P0-3 (`doPost` идемпотентность до авторизации):** `getIdempotentResult_` вызывался до проверки сессии/роли и не привязывал `operationId` к `actorId`, `role` и `action`.
- **P0-4 (`delta_sync`):** фильтрация выполнялась по имени коллекции (`STAFF_DELTA_WHITELIST_`), но вложенные поля `PayloadJSON` и принадлежность записи сотруднику не проверялись.
- **P1-1 (`LockService`):** глобальная блокировка удерживалась вокруг всего `doPost`, включая `auth_login`, `auth_logout` и `upload_photo` (создание файла в Drive).
- **P1-2 (сессии):** сессии хранились только в `CacheService`, что приводило к потере сессии при досрочном вытеснении кэша.
- **P1-3 (разделение UI):** `index.html` (терминал бариста) подключал `js/analytics.js` и `js/sales-reconciliation.js`; тема поддерживала только `light`/`dark` без `auto`; `css/components.css` содержал жёсткие HEX-цвета.

## 2. Выполненные изменения (Этапы 2–3)
- **`Code.gs`:**
  - Из `doGet?action=get_rev` полностью удалён `LIVE_ENV_V63` (`env`).
  - `doGet?action=get_checklists` ограничен до минимального pre-login ответа (`location`, `staff` без `tgId`, `serverTime`, `serverDate`, `requiresAuthForDetails: true`).
  - Добавлен авторизованный endpoint `POST action=staff_bootstrap` (`buildStaffBootstrapDto_`) со строгим Barista DTO: изоляция черновиков, активного состояния, персональных задач и чек-листов по `sess.staffName`, без финансовых полей, планов и `tgId`.
  - В `doPost` проверка сессии и роли (`STAFF_OR_ADMIN_ACTIONS_` / `requireAuth_`) перенесена строго ДО `getIdempotentResult_`; журнал `API_OPERATIONS` привязан к `ActorID`, `Role`, `Action`.
  - В `handleDeltaSync_` и `getDeltasSince_` добавлена фильтрация полей `filterDeltaRecordForRole_` и защита от IDOR.
  - `auth_login`, `auth_logout` и загрузка файла в Drive внутри `uploadPhotoToDrive_` вынесены за пределы глобального `LockService`.
  - Добавлено резервное хранение активных сессий в `PropertiesService` (`COFFEE_ACTIVE_SESSIONS_V4`) с автоматической очисткой просроченных записей.
  - В `getDashboard_` добавлены честные метаданные `kpi` и `dataQuality` (`missing` для `cogs` и `netProfit` при отсутствии рецептур и закупочных цен).
- **Frontend (`index.html`, `dashboard.html`, `owner.html`, `admin.html`, `report.html`, `js/theme.js`, `js/sync.js`, `css/components.css`, `version.js`, `sw.js`):**
  - Создан `js/theme.js` (режимы `auto` / `light` / `dark` с живым отслеживанием `prefers-color-scheme`) и подключён в `<head>` всех страниц.
  - Из `index.html` удалены `js/analytics.js` и `js/sales-reconciliation.js`.
  - В `js/sync.js` авторизованный запрос `get_checklists` автоматически переводится в `POST staff_bootstrap`.
  - В `css/components.css` жёсткие HEX-цвета заменены на семантические токены.
  - Версия синхронизирована в `version.js`, `sw.js` и `Code.gs` (`v87` / спецификация `4.0`).

## 3. Результаты тестирования (Этап 4)
- `tests/v4-security-and-isolation-tests.js`: **8/8 PASS**
- `tests/gas-anon-access-tests.js`: **1/1 (66 точек входа) PASS**
- `tests/gas-server-security-tests.js`: **18/18 PASS**
- `tests/unit-tests.js`: **27/27 PASS**
- `tests/integration-contract-tests.js`: **6/6 PASS**
- `tests/transport-runtime-tests.js`: **1/1 PASS**

## 4. Развёртывание, миграция и откат
1. **Резервная копия:** перед обновлением создать копию Google Таблицы и папки `Coffee_ERP_Photos` в Google Drive, а также зафиксировать текущую версию Apps Script Deployment.
2. **Обновление Backend:** скопировать обновлённый `Code.gs` в проект Google Apps Script (сначала на staging-копии таблицы), выполнить `setupAndVerifyCoffeeServer()` и опубликовать новую версию Web App.
3. **Обновление Frontend:** задеплоить статику (GitHub Pages / хостинг); Service Worker `kofeinya-enterprise-v87` автоматически очистит старый кэш.
4. **Откат:** в Google Apps Script переключить Deployment на предыдущую зафиксированную версию (v86), на хостинге — откатить коммит/архив; структура листов Google Таблицы обратно совместима.

## 5. Известные ограничения (требуют решений владельца для P1/P2)
- Нагрузочное тестирование на живом Google Apps Script deployment и проверка фактических квот (выполняется при развёртывании на staging).
- Миграция схемы PIN с фиксированного префикса соли на индивидуальные соли (требует принудительной смены PIN всеми сотрудниками по графику владельца).
- Утверждение владельцем закупочных цен и рецептур ТТК для перехода `cogs` из `dataQuality: 'missing'` в `verified`.
