# Карта API-контрактов и структуры данных (`API_CONTRACTS.md`)

**Актуальный статус релиза:** `v78` (совместимость протокола `api: 2`, `serverVersion: 'v86'`)  
**Серверное ядро:** Google Apps Script (`Code.gs`) + Google Sheets (16 основных + 2 служебных листа) + Google Drive (`Coffee_ERP_Photos`)

## 1. Общий протокол обмена данными (`coffeeFetch`)

Клиентский транспорт (`js/sync.js`) взаимодействует с веб-приложением Google Apps Script по следующим правилам:

1. **Формат POST-запросов:** тело передаётся как JSON-строка с заголовком `Content-Type: text/plain;charset=utf-8` (предотвращает избыточный CORS `OPTIONS` preflight в браузерах и Telegram WebView).
2. **Обязательные служебные поля каждого изменяющего POST-запроса:**
   - `action` — строковый идентификатор операции;
   - `operationId` — уникальный идентификатор операции (`op_<timestamp>_<random>`) для серверной идемпотентности;
   - `sessionToken` — подписанный токен сессии владельца (при выполнении операций из Панели владельца);
   - `staffSessionToken` — подписанный токен сессии бариста (при выполнении операций из Терминала).
3. **Формат ответа сервера:** всегда валидный JSON с булевым полем `ok: true | false`. При `ok: false` возвращается код/текст причины в поле `error` (например, `STAFF_AUTH_REQUIRED`, `PIN_REQUIRED`, `RATE_LIMITED`, `VALIDATION_ERROR`) и опциональный флаг `deduped: true`, если операция с данным `operationId` уже была выполнена ранее.

## 2. Полный реестр GET-запросов (`doGet`)

| `action` | Доступ | Входные query-параметры | Возвращаемая структура JSON |
| :--- | :--- | :--- | :--- |
| `get_rev` | Публичный | `action=get_rev` | `{ ok: true, rev: "<monotonic_ms>", serverTime: "<ISO>" }` — сверхбыстрая проверка изменения данных |
| `version` | Публичный | `action=version` | `{ ok: true, serverVersion: "v66", api: 2, actions: [...] }` |
| `get_checklists` | Терминал | `action=get_checklists`, опц. `barista` | `{ ok: true, rev, location, plan, woNorm, minAvgCheck, planChecks, photoAll, initCounter, tasks, checklistBlocks, dailyPlans, announcements, ttk, goodDeeds, staffNames, drafts, completedToday }` *(очищено от PIN-кодов и токенов)* |
| `dashboard` | Владелец (`PIN` / `sessionToken`) | `action=dashboard`, `date`, `from`, `to` | `{ ok: true, rev, location, plan, kpis, checklists, incidents, cash, expenses, inventory, redFlags }` |
| `report` | Владелец (`PIN` / `sessionToken`) | `action=report`, `from`, `to` | `{ ok: true, rev, days, totals, products, ttk, expenses, checklists, incidents, serviceAudits }` |
| `admin` | Владелец (`PIN` / `sessionToken`) | `action=admin`, `nocache=1` | Полный слепок всех справочников и операционных таблиц для Панели владельца (`tasks`, `settings`, `checklistBlocks`, `dailyPlans`, `staff`, `ttk`, `announcements`, `goodDeeds`, `cash`, `expenses`, `incidents`, `serviceAudits`, `inventory`, `expiryItems`) |

## 3. Полный реестр POST-запросов (`doPost`)

### 3.1. Аутентификация и сессии

| `action` | Кто вызывает | Входные поля payload | Назначение и результат |
| :--- | :--- | :--- | :--- |
| `auth_login` | Бариста / Владелец | `role` (`'admin'` \| `'staff'`), `userName`, `pin` | Проверяет хеш PIN (`SHA-256` с солью `coffee_salt_v21:`), применяет лимит 5 попыток / 15 мин и возвращает `{ ok: true, sessionToken, role, userName, expiresAt }` |
| `auth_logout` | Бариста / Владелец | `sessionToken` / `staffSessionToken` | Аннулирует активный токен сессии в `CacheService` / `PropertiesService` |
| `setup_initial_credentials` | Владелец | `newAdminPin`, `staffPins: [{ name, pin }]` | Первичная ротация заводских PIN-кодов с сохранением SHA-256 хешей |
| `bind_telegram_user` | Терминал (TMA) | `userName`, `tgId`, `tgUsername` | Привязывает `initDataUnsafe.user.id` сотрудника к его профилю в листе `Сотрудники` |

### 3.2. Операции Терминала бариста (требуют `requireVerifiedStaffSession_`)

| `action` | Входные поля payload | Изменяемые листы Google Sheets | Описание бизнес-действия |
| :--- | :--- | :--- | :--- |
| `save_checklist_draft` | `block`, `barista`, `idx`, `answers`, `updatedAt` | `ДельтаСинхр` + `PropertiesService` | Сохраняет промежуточный черновик чек-листа для бесшовного продолжения смены с любого устройства |
| `submit_checklist` | `block`, `barista`, `date`, `time`, `answers[]`, `deadline`, `isLate` | `Чек-листы`, `Поломки`, `Медиафайлы`, `Журнал` | Фиксирует завершённый чек-лист; автоматически догружает офлайн `photo_base64` в Google Drive и создаёт записи в `Поломки` для шагов с проблемой |
| `upload_photo` | `dataUrl` (`base64`), `fileName`, `block`, `step`, `barista` | Папка Drive `Coffee_ERP_Photos` + лист `Медиафайлы` | Сохраняет фото/видео в Google Drive и возвращает публичную ссылку просмотра `{ ok: true, fileId, url, viewUrl }` |
| `submit_cash` | `date`, `cash`, `card`, `checks`, `writeoff`, `writeoffShots`, `barista`, `counterStart`, `counterEnd`, `coffeeQty`, `nonCoffeeQty`, `reviewQty`, `unaccountedShots`, `csvHashes`, `products`, `mergeMode` | `Касса`, `Продажи`, `Склад` (автосписание по ТТК), `Журнал` | Записывает или суммирует (`mergeMode: 'sum'`) кассовый отчёт смены, сохраняет позиции продаж и списывает ингредиенты по ТТК |
| `batch_submit_cash` | `days: [ { date, cash, card, ... } ]` | `Касса`, `Продажи`, `Журнал` | Двухфазная атомарная запись пакета кассовых смен за несколько дней (сначала полная валидация всех элементов, затем запись) |
| `report_standalone_incident` | `id`, `step`, `text`, `priority`, `type`, `who`, `photo`, `block` | `Поломки`, `Медиафайлы`, `Журнал` + Telegram API | Регистрирует внеплановую поломку/проблему и мгновенно отправляет карточку с медиа руководителю в Telegram |
| `ack_announcement` | `id`, `userName`, `time` | `Информирование`, `ДельтаСинхр` | Добавляет отметку «Ознакомлен» сотрудника по правилу `Set-Union` (без потери отметок других бариста) |
| `toggle_personal_task` | `id`, `userName`, `done` | `ДельтаСинхр`, `Журнал` | Отмечает выполнение персонального поручения сотрудником |

### 3.3. Операции Панели владельца (требуют `requireAdminAuth_`)

| Категория | `action` | Входные поля payload | Изменяемые листы Google Sheets |
| :--- | :--- | :--- | :--- |
| **Таймлайн и окна** | `save_checklist_blocks`, `add_checklist_block`, `delete_checklist_block`, `save_block_windows`, `extend_deadline`, `simulate_overdue` | `blocks[]` / `name`, `openTime`, `deadline` / `block`, `until`, `reason` | `Таймлайн`, `Настройки`, `Поломки`, `Журнал` |
| **Задачи и КДД** | `save_task`, `delete_task`, `reorder_task`, `save_good_deed`, `delete_good_deed` | `id`, `block`, `title`, `instruction`, `photoMode`, `responsible`, `active`, `dir` | `Задачи`, `Карта добрых дел`, `ДельтаСинхр`, `Журнал` |
| **Поломки** | `update_incident`, `resolve_incident`, `delete_incident` | `id`, `status` (5 статусов), `statusNote`, `owner`, `priority` | `Поломки`, `ДельтаСинхр`, `Журнал` |
| **Касса и Сверка** | `admin_cash`, `delete_cash`, `save_nomenclature_rule` | `date`, `cash`, `card`, `zTotal`, `diffReason`, `correctionHistory` / `itemName`, `category` | `Касса`, `Настройки`, `Журнал` |
| **Расходы OpEx** | `add_expense`, `update_expense`, `delete_expense` | `id`, `date`, `category`, `amount` (`> 0`), `comment` | `Расходы`, `ДельтаСинхр`, `Журнал` |
| **Персонал** | `save_staff`, `delete_staff`, `save_staff_pins`, `save_shift_roster` | `id`, `name`, `role`, `shop`, `active`, `pin`, `tgId` / `roster` | `Сотрудники`, `Планы`, `Журнал` |
| **Стандарты и склад** | `save_ttk`, `delete_ttk`, `save_announcement`, `delete_announcement`, `save_inventory`, `restock_inventory`, `add_expiry_item`, `dispose_expiry_item` | `id`, `name`, `volume`, `price`, `costBeans`, `costMilk`, `costSyrup`, `costCup`, `recipe`, `ttkHistory` | `Техкарты`, `Информирование`, `Настройки`, `ДельтаСинхр`, `Журнал` |
| **Контроль и Аудит** | `save_service_audit`, `delete_service_audit` | `id`, `date`, `barista`, `reviewer`, `greet`, `clarify`, `upsell`, `farewell`, `total`, `comment` | `Аудит сервиса`, `Журнал` |
| **Настройки и Синхр.** | `save_setting`, `save_all_settings`, `save_daily_plans`, `save_shop`, `switch_shop_location`, `save_telegram_credentials`, `send_telegram_alert`, `setup_autonomous_triggers`, `send_daily_digest`, `sync_all_to_sheet`, `delta_sync` | `items[]`, `plans`, `shop`, `collections` | `Настройки`, `Планы`, `ДельтаСинхр`, `Журнал` |

## 4. Полная схема листов и колонок Google Таблицы (`ensureSheets_`)

| № | Имя листа | Точный состав колонок (слева направо) |
| :-: | :--- | :--- |
| 1 | **`Настройки`** | `Параметр` · `Значение` · `Описание` |
| 2 | **`Таймлайн`** | `ID` · `Название чек-листа` · `Открытие (ЧЧ:ММ)` · `Дедлайн (ЧЧ:ММ)` · `Касса (да/нет)` · `Активен (да/нет)` |
| 3 | **`Планы`** | `День недели` · `План выручки, руб.` · `План ср. чека, руб.` · `План чеков` · `График смен (Бариста)` |
| 4 | **`Задачи`** | `Код` · `Блок` · `Подгруппа` · `Название` · `Инструкция` · `Нужно фото` · `Ответственный` · `Активна` |
| 5 | **`Карта добрых дел`** | `ID` · `Название задачи` · `Периодичность` · `Окно времени` · `Исполнитель` · `Проверяющий` · `Инструкция` |
| 6 | **`Сотрудники`** | `ID` · `Имя` · `Роль` · `Кофейня` · `Активен` · `Код входа (PIN)` |
| 7 | **`Техкарты`** | `ID` · `Название` · `Объём` · `Категория` · `Цена, руб.` · `Зерно, руб.` · `Молоко, руб.` · `Сироп, руб.` · `Тара, руб.` · `Рецептура` · `Подача` |
| 8 | **`Информирование`** | `ID` · `Заголовок` · `Категория` · `Описание` · `Дата публикации` · `Актуально до` · `Дата календаря` · `Событие календаря` · `Кому назначено` · `Ознакомились JSON` |
| 9 | **`Касса`** | `Дата` · `Наличные` · `Безнал` · `Чеков` · `Списания` · `Хиты` · `Бариста` · `Счётчик начало` · `Счётчик конец` · `Списания порций` · `Кофе шт` · `Не кофе шт` · `На проверку шт` · `Необъясн. разница` · `Хэши CSV` · `Смены JSON` |
| 10 | **`Продажи`** | `Дата` · `Смена` · `Бариста` · `Номенклатура` · `Категория` · `Цена` · `Количество` · `Сумма` · `Хэш CSV` |
| 11 | **`Расходы`** | `ID` · `Дата` · `Статья` · `Сумма` · `Комментарий` |
| 12 | **`Поломки`** | `ID` · `Дата` · `Время` · `Шаг` · `Описание` · `Срочность` · `Статус` · `Кто` · `Ответственный` · `Фото` · `Тип` · `История JSON` |
| 13 | **`Аудит сервиса`** | `ID` · `Дата` · `Бариста` · `Проверяющий` · `Приветствие %` · `Уточнение %` · `Upsell %` · `Прощание %` · `Итог %` · `Комментарий` |
| 14 | **`Чек-листы`** | `Дата` · `Время` · `Блок` · `Бариста` · `Проблем` · `Фото JSON` · `Дедлайн` · `Статус срока` |
| 15 | **`Журнал`** | `Дата` · `Время` · `Пользователь` · `Действие` · `Детали` |
| 16 | **`ДельтаСинхр`** | `Collection` · `RecordID` · `UpdatedAt` · `Deleted` · `Actor` · `PayloadJSON` |
| 17 | **`API_OPERATIONS`** *(служ.)* | `OperationID` · `Timestamp` · `Action` · `Actor` · `ResponseJSON` (журнал идемпотентности до 5 000 записей) |
| 18 | **`Медиафайлы`** *(служ.)* | `Дата` · `Время` · `Бариста` · `Блок` · `Шаг` · `Имя файла` · `FileID` · `URL` (реестр фото/видео в Google Drive) |
